import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
  type SessionUser,
} from '@/lib/auth';
import { cleanText } from '@/lib/validation';

const SOCKET_TIMEOUT_MS = 2000;

/**
 * Where the Socket.IO side-car lives. The emit used to be hard-coded to
 * `http://localhost:3002`, so real-time chat silently died in production while
 * every send paid the cost of a doomed request.
 */
function socketServerUrl(): string | null {
  const configured = process.env.SOCKET_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  // No URL configured: guessing localhost is only ever right in development.
  if (process.env.NODE_ENV === 'production') return null;
  return `http://localhost:${process.env.SOCKET_SERVER_PORT || 3002}`;
}

/**
 * Best-effort push to the socket server. Every failure is swallowed on purpose:
 * the message is already persisted, and the client polls/refetches anyway, so a
 * flaky side-car must never turn a successful send into a 500.
 */
async function emitToSocketServer(conversationId: string, message: unknown): Promise<void> {
  const baseUrl = socketServerUrl();
  if (!baseUrl) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.SOCKET_EMIT_SECRET;
  if (secret) headers['x-socket-secret'] = secret;

  try {
    await fetch(`${baseUrl}/emit-message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversationId, message }),
      signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS),
    });
  } catch {
    // Deliberately silent — see above.
  }
}

type ConversationParticipants = { id: string; userId: string; companyId: string };

/** A thread is readable by the seeker it belongs to and by that company's staff. */
function isParticipant(conversation: ConversationParticipants, session: SessionUser): boolean {
  if (conversation.userId === session.id) return true;
  if (session.companyId && conversation.companyId === session.companyId) return true;
  return session.role === 'ADMIN';
}

/**
 * GET /api/messages?conversationId=… — one thread, for its participants only.
 *
 * The conversation id is now mandatory: without it the old handler returned
 * every message in the database, and with it there was no membership check at all.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) return badRequest('A conversation id is required');
    if (!isUuid(conversationId)) return badRequest('Invalid conversation id');

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, companyId: true },
    });

    if (!conversation) return notFound('Conversation not found');
    if (!isParticipant(conversation, session)) {
      return forbidden('You do not have access to this conversation');
    }

    // Opening the thread is what "reading" means here. Marked before the read so
    // the payload the client renders already reflects the new state.
    await prisma.message.updateMany({
      where: { conversationId, senderId: { not: session.id }, readAt: null },
      data: { readAt: new Date() },
    });

    const messages = await prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('GET /api/messages failed:', error);
    return serverError('Could not load the conversation');
  }
}

/** POST /api/messages — send a message into a thread the caller belongs to. */
export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.conversationId)) return badRequest('Invalid conversation id');
  const conversationId = body.conversationId;

  const content = cleanText(body.content, 5000);
  if (!content) return badRequest('Please write a message before sending');

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        companyId: true,
        user: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });

    if (!conversation) return notFound('Conversation not found');
    if (!isParticipant(conversation, session)) {
      return forbidden('You do not have access to this conversation');
    }

    // The sender is always the signed-in user. The old handler spread the raw
    // body into `create`, so a caller could post as anybody.
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: session.id,
        content,
      },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // Notify whichever side didn't send it. Non-fatal: the message is saved.
    try {
      const preview = content.length > 60 ? `${content.slice(0, 60)}…` : content;
      const sentBySeeker = conversation.userId === session.id;

      if (sentBySeeker) {
        const senderName = conversation.user.name || session.name || 'A candidate';
        const recipients = await prisma.user.findMany({
          where: { companyId: conversation.companyId, role: 'COMPANY' },
          select: { id: true },
        });

        if (recipients.length > 0) {
          await prisma.notification.createMany({
            data: recipients.map((recipient) => ({
              userId: recipient.id,
              content: `New message from ${senderName}: ${preview}`,
              link: '/conversations',
            })),
          });
        }
      } else {
        const senderName = conversation.company.name || session.name || 'the employer';
        await prisma.notification.create({
          data: {
            userId: conversation.userId,
            content: `New message from ${senderName}: ${preview}`,
            link: '/seeker/conversations',
          },
        });
      }
    } catch (notifyError) {
      console.error('POST /api/messages notification failed:', notifyError);
    }

    await emitToSocketServer(conversation.id, message);

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error('POST /api/messages failed:', error);
    return serverError('Could not send your message');
  }
}

/**
 * DELETE /api/messages — a sender may remove their own message.
 * There is no update handler: editing history in a hiring thread is not something
 * either side should be able to do, and the old `PUT` was unauthenticated anyway.
 */
export async function DELETE(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.id)) return badRequest('Invalid message id');
  const messageId = body.id;

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true },
    });

    if (!message) return notFound('Message not found');
    if (message.senderId !== session.id && session.role !== 'ADMIN') {
      return forbidden('You can only delete messages you sent');
    }

    await prisma.message.delete({ where: { id: messageId } });

    return NextResponse.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('DELETE /api/messages failed:', error);
    return serverError('Could not delete the message');
  }
}

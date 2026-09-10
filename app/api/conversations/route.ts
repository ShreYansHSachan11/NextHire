import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';

/** Both sides of a thread, for the response body. */
const CONVERSATION_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  company: { select: { id: true, name: true } },
} as const;

/**
 * Unread messages per conversation, from the caller's point of view: anything
 * they didn't send that hasn't been opened yet. Grouped in one query so a long
 * inbox doesn't turn into one COUNT per row.
 */
async function unreadCounts(
  conversationIds: string[],
  viewerId: string
): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();

  const rows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: viewerId },
      readAt: null,
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.conversationId, row._count._all]));
}

/**
 * GET /api/conversations — the caller's own threads.
 *
 * No ids are accepted from the query string any more: `?userId=`/`?companyId=`
 * previously let anyone enumerate somebody else's inbox. Both sides are derived
 * from the session.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    if (session.role === 'COMPANY') {
      if (!session.companyId) {
        return badRequest('Your account is not linked to a company yet');
      }
      const companyId = session.companyId;

      // The company inbox is driven by applications rather than by existing
      // threads, so an employer can start a conversation with anyone who applied.
      const applications = await prisma.application.findMany({
        where: { job: { companyId } },
        include: {
          job: { select: { id: true, title: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const conversations = await prisma.conversation.findMany({
        where: { companyId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      });

      const unread = await unreadCounts(
        conversations.map((conversation) => conversation.id),
        session.id
      );

      const conversationsByUser = new Map(
        conversations.map((conversation) => [conversation.userId, conversation])
      );

      // How many roles each applicant has applied for. The old handler emitted
      // one row per application, so somebody who applied to three jobs appeared
      // three times, with all three rows pointing at the same thread.
      const applicationCounts = new Map<string, number>();
      for (const application of applications) {
        applicationCounts.set(
          application.userId,
          (applicationCounts.get(application.userId) ?? 0) + 1
        );
      }

      type CompanyInboxRow = {
        application: (typeof applications)[number];
        conversation: ((typeof conversations)[number] & { unreadCount: number }) | null;
        hasConversation: boolean;
        applicationCount: number;
      };

      const rows: CompanyInboxRow[] = [];
      const seen = new Set<string>();

      for (const application of applications) {
        // Applications are ordered newest first, so the first row we meet for an
        // applicant is the one worth showing.
        if (seen.has(application.userId)) continue;
        seen.add(application.userId);

        const conversation = conversationsByUser.get(application.userId) ?? null;
        rows.push({
          application,
          conversation: conversation
            ? { ...conversation, unreadCount: unread.get(conversation.id) ?? 0 }
            : null,
          hasConversation: !!conversation,
          applicationCount: applicationCounts.get(application.userId) ?? 1,
        });
      }

      return NextResponse.json(rows);
    }

    // Seekers (and admins, who have no company of their own) get the threads
    // hanging off their own user record.
    const conversations = await prisma.conversation.findMany({
      where: { userId: session.id },
      include: {
        company: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const unread = await unreadCounts(
      conversations.map((conversation) => conversation.id),
      session.id
    );

    return NextResponse.json(
      conversations.map((conversation) => ({
        ...conversation,
        unreadCount: unread.get(conversation.id) ?? 0,
      }))
    );
  } catch (error) {
    console.error('GET /api/conversations failed:', error);
    return serverError('Could not load your conversations');
  }
}

/**
 * POST /api/conversations — open (or re-open) the thread between a seeker and a
 * company. The caller only ever names the *other* party; their own side comes
 * from the session, so a conversation can no longer be created between two
 * arbitrary strangers.
 */
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

  let userId: string;
  let companyId: string;

  if (session.role === 'SEEKER') {
    if (!isUuid(body.companyId)) return badRequest('Invalid company id');
    userId = session.id;
    companyId = body.companyId;
  } else if (session.role === 'COMPANY') {
    if (!session.companyId) {
      return badRequest('Your account is not linked to a company yet');
    }
    if (!isUuid(body.userId)) return badRequest('Invalid user id');
    userId = body.userId;
    companyId = session.companyId;
  } else {
    // An admin belongs to neither side, so they have to name both explicitly.
    if (!isUuid(body.userId) || !isUuid(body.companyId)) {
      return badRequest('Both a user id and a company id are required');
    }
    userId = body.userId;
    companyId = body.companyId;
  }

  try {
    const [user, company] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }),
    ]);

    if (!user) return notFound('That user could not be found');
    if (!company) return notFound('That company could not be found');

    // Messaging is not a cold-outreach channel: there has to be an application
    // linking the two parties. The same check works in both directions.
    if (session.role !== 'ADMIN') {
      const applicationCount = await prisma.application.count({
        where: { userId, job: { companyId } },
      });

      if (applicationCount === 0) {
        return forbidden(
          session.role === 'SEEKER'
            ? 'You can only message companies you have applied to'
            : 'You can only message candidates who have applied to your jobs'
        );
      }
    }

    const existing = await prisma.conversation.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: CONVERSATION_INCLUDE,
    });
    if (existing) return NextResponse.json(existing);

    // Upsert rather than create: two clicks in quick succession would otherwise
    // race on the (userId, companyId) unique and surface as a 500.
    const conversation = await prisma.conversation.upsert({
      where: { userId_companyId: { userId, companyId } },
      create: { userId, companyId },
      update: {},
      include: CONVERSATION_INCLUDE,
    });

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error('POST /api/conversations failed:', error);
    return serverError('Could not start the conversation');
  }
}

/** DELETE /api/conversations — either participant may remove a thread. */
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

  if (!isUuid(body.id)) return badRequest('Invalid conversation id');
  const conversationId = body.id;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true, companyId: true },
    });

    if (!conversation) return notFound('Conversation not found');

    const isParticipant =
      session.role === 'ADMIN' ||
      conversation.userId === session.id ||
      (!!session.companyId && conversation.companyId === session.companyId);

    if (!isParticipant) {
      return forbidden('You can only delete your own conversations');
    }

    // Messages cascade with the thread.
    await prisma.conversation.delete({ where: { id: conversationId } });

    return NextResponse.json({ message: 'Conversation deleted' });
  } catch (error) {
    console.error('DELETE /api/conversations failed:', error);
    return serverError('Could not delete the conversation');
  }
}

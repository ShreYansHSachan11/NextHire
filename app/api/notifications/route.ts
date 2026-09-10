import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  requireRole,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';
import { cleanText } from '@/lib/validation';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** Everything the bell needs, and nothing about the recipient. */
const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  content: true,
  link: true,
  read: true,
  createdAt: true,
} as const;

/**
 * GET /api/notifications
 *   ?unread=true  only the unread ones
 *   ?limit=n      1–100, default 30
 *
 * Always scoped to the signed-in user: `?userId=` used to be taken at face value,
 * so anyone could read anyone else's bell. Still returns a plain array, which is
 * what the client expects.
 */
export async function GET(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  try {
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get('unread') === 'true';

    const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const notifications = await prisma.notification.findMany({
      where: { userId: session.id, ...(unreadOnly ? { read: false } : {}) },
      select: NOTIFICATION_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(notifications);
  } catch (error) {
    console.error('GET /api/notifications failed:', error);
    return serverError('Could not load your notifications');
  }
}

/**
 * POST /api/notifications — admin only.
 *
 * Notifications are raised server-side by the routes that cause them
 * (applications, status changes, messages). This export is kept purely as an
 * operational escape hatch; it used to be open to the public, which made the
 * bell trivially spammable.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  if (!isUuid(body.userId)) return badRequest('Invalid user id');
  const content = cleanText(body.content, 500);
  if (!content) return badRequest('Notification content is required');

  const link = typeof body.link === 'string' && body.link.startsWith('/') ? body.link : null;

  try {
    const recipient = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!recipient) return notFound('That user could not be found');

    const notification = await prisma.notification.create({
      data: { userId: recipient.id, content, link },
      select: NOTIFICATION_SELECT,
    });

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    console.error('POST /api/notifications failed:', error);
    return serverError('Could not create the notification');
  }
}

/**
 * PATCH /api/notifications
 *   { id, read }        mark one of the caller's notifications read/unread
 *   { markAllRead: true } clear the whole bell in one call
 */
export async function PATCH(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  try {
    if (body.markAllRead === true) {
      const result = await prisma.notification.updateMany({
        where: { userId: session.id, read: false },
        data: { read: true },
      });

      return NextResponse.json({ updated: result.count });
    }

    if (!isUuid(body.id)) return badRequest('Invalid notification id');
    const notificationId = body.id;

    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });

    if (!existing) return notFound('Notification not found');
    if (existing.userId !== session.id && session.role !== 'ADMIN') {
      return forbidden('You can only update your own notifications');
    }

    // `content` is deliberately not writable — the text is written by the server
    // that raised the notification, and the client only ever flips `read`.
    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: typeof body.read === 'boolean' ? body.read : true },
      select: NOTIFICATION_SELECT,
    });

    return NextResponse.json(notification);
  } catch (error) {
    console.error('PATCH /api/notifications failed:', error);
    return serverError('Could not update the notification');
  }
}

/** PUT /api/notifications — kept as an alias so existing clients carry on working. */
export async function PUT(req: NextRequest) {
  return PATCH(req);
}

/** DELETE /api/notifications — the caller's own notifications only. */
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

  if (!isUuid(body.id)) return badRequest('Invalid notification id');
  const notificationId = body.id;

  try {
    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });

    if (!existing) return notFound('Notification not found');
    if (existing.userId !== session.id && session.role !== 'ADMIN') {
      return forbidden('You can only delete your own notifications');
    }

    await prisma.notification.delete({ where: { id: notificationId } });

    return NextResponse.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('DELETE /api/notifications failed:', error);
    return serverError('Could not delete the notification');
  }
}

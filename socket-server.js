require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

/**
 * Standalone Socket.IO relay for the chat feature.
 *
 * Three things were wrong with earlier versions. CORS was `*`, and
 * `/emit-message` was an unauthenticated POST endpoint, so anyone who could
 * reach the port could inject arbitrary messages into any conversation room.
 * Both of those were fixed.
 *
 * The third was the *read* side, and it survived that fix: the handshake
 * authenticated nobody, and `join-conversation` subscribed the caller to
 * whatever room id they named. Since `POST /api/messages` fans the full
 * serialised message row into the room — sender name and email included — a
 * stranger who learned or guessed a conversation UUID could listen to a hiring
 * thread live, with no account at all. CORS is no defence: a Node client
 * ignores it.
 *
 * So membership is now proved twice over: the handshake must carry a valid
 * signed JWT, and every join is checked against the conversation row itself.
 * A room id is treated as a claim, never as a credential.
 */

const PORT = Number(process.env.SOCKET_SERVER_PORT || 3002);
const EMIT_SECRET = process.env.SOCKET_EMIT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const prisma = new PrismaClient();

const ALLOWED_ORIGINS = (process.env.SOCKET_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (IS_PRODUCTION && !EMIT_SECRET) {
  console.error(
    'Refusing to start: SOCKET_EMIT_SECRET must be set in production, otherwise ' +
      'anyone who can reach this port can forge chat messages.'
  );
  process.exit(1);
}

if (IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
  console.error('Refusing to start: set SOCKET_ALLOWED_ORIGINS in production.');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error(
    'Refusing to start: JWT_SECRET must be set, otherwise the handshake cannot ' +
      'verify who is connecting and any caller could subscribe to a conversation.'
  );
  process.exit(1);
}

const corsOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*';

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

const MAX_BODY_BYTES = 64 * 1024;

server.on('request', (req, res) => {
  // Socket.IO handles its own upgrade/polling paths.
  if (req.url && req.url.startsWith('/socket.io')) return;

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, connections: io.engine.clientsCount }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/emit-message') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Only the Next.js API, which knows the shared secret, may broadcast.
  if (EMIT_SECRET && req.headers['x-socket-secret'] !== EMIT_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  let body = '';
  let aborted = false;

  req.on('data', (chunk) => {
    if (aborted) return;
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
    }
  });

  req.on('end', () => {
    if (aborted) return;
    try {
      const data = JSON.parse(body);
      if (!data || typeof data.conversationId !== 'string' || !data.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'conversationId and message are required' }));
        return;
      }

      io.to(data.conversationId).emit('new-message', {
        conversationId: data.conversationId,
        message: data.message,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
});

/**
 * Handshake authentication.
 *
 * The token is the same JWT the HTTP API issues, read from `auth.token` (the
 * cookie is deliberately JS-readable so the client can pass it here). Verified
 * for signature and expiry — `jsonwebtoken` runs fine in this process, unlike
 * in `middleware.ts` where the edge runtime forces an unverified decode.
 */
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof token !== 'string' || !token) {
    next(new Error('unauthorized'));
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.data.user = {
      id: payload.id,
      role: payload.role,
      companyId: payload.companyId || null,
    };
    next();
  } catch {
    // Never echo the reason back: expired and forged should look identical.
    next(new Error('unauthorized'));
  }
});

/**
 * Is this user actually in this conversation?
 *
 * Mirrors the ownership rule in `app/api/conversations` and
 * `app/api/messages`: the seeker who owns the thread, anyone belonging to the
 * company on the other side of it, or an admin. Checked against the row rather
 * than inferred from the id, because the id is what the caller supplied.
 */
async function canJoin(user, conversationId) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true, companyId: true },
  });
  if (!conversation) return false;

  if (conversation.userId === user.id) return true;
  return (
    user.role === 'COMPANY' && !!user.companyId && user.companyId === conversation.companyId
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

io.on('connection', (socket) => {
  socket.on('join-conversation', async (conversationId) => {
    if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) return;

    try {
      if (await canJoin(socket.data.user, conversationId)) {
        socket.join(conversationId);
      } else {
        // Tell the client it failed, but not why — "no such thread" and "not
        // yours" are the same answer to someone probing for room ids.
        socket.emit('join-denied', { conversationId });
      }
    } catch (error) {
      console.error('join-conversation check failed:', error);
      socket.emit('join-denied', { conversationId });
    }
  });

  socket.on('leave-conversation', (conversationId) => {
    // No authorization needed to stop listening to something.
    if (typeof conversationId === 'string' && conversationId) {
      socket.leave(conversationId);
    }
  });

  // The old `send-message` handler let a client broadcast straight into a room
  // with no persistence and no authorization. Messages now go through
  // POST /api/messages, which writes to the database and then asks this server
  // to fan the saved row out.
});

server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
  if (!EMIT_SECRET) {
    console.warn('SOCKET_EMIT_SECRET is not set — /emit-message is unauthenticated (development only).');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    io.close(() => server.close(() => process.exit(0)));
  });
}

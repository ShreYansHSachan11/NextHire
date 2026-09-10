require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');

/**
 * Standalone Socket.IO relay for the chat feature.
 *
 * Two things were wrong with the previous version: CORS was `*`, and
 * `/emit-message` was an unauthenticated POST endpoint, so anyone who could
 * reach the port could inject arbitrary messages into any conversation room.
 */

const PORT = Number(process.env.SOCKET_SERVER_PORT || 3002);
const EMIT_SECRET = process.env.SOCKET_EMIT_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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

io.on('connection', (socket) => {
  socket.on('join-conversation', (conversationId) => {
    if (typeof conversationId === 'string' && conversationId) {
      socket.join(conversationId);
    }
  });

  socket.on('leave-conversation', (conversationId) => {
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

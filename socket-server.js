require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Handle HTTP requests for emitting messages
server.on('request', (req, res) => {
  console.log('HTTP request received:', req.method, req.url);
  
  if (req.method === 'POST' && req.url === '/emit-message') {
    console.log('Processing emit-message request');
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Emitting message to conversation:', data.conversationId);
        // Emit the message to all clients in the conversation
        io.to(data.conversationId).emit('new-message', data);
        console.log('Message emitted successfully');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.log('Error processing emit-message:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.url !== '/socket.io/') {
    console.log('404 for request:', req.url);
    res.writeHead(404);
    res.end();
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join conversation room
  socket.on('join-conversation', (conversationId) => {
    socket.join(conversationId);
    console.log(`User ${socket.id} joined conversation ${conversationId}`);
  });

  // Leave conversation room
  socket.on('leave-conversation', (conversationId) => {
    socket.leave(conversationId);
    console.log(`User ${socket.id} left conversation ${conversationId}`);
  });

  // Handle new message
  socket.on('send-message', (data) => {
    console.log('New message:', data);
    // Broadcast to all users in the conversation
    socket.to(data.conversationId).emit('new-message', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.SOCKET_SERVER_PORT || 3002;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
}); 
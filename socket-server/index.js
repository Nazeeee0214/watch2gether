const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// In-Memory Room State
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('room:join', (data) => {
    const { roomId, userId, username, isCreator } = data;
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: [],
        hostId: userId,
        videoUrl: '',
        isScreenSharing: false
      };
    }

    const room = rooms[roomId];
    
    // Check if user already in room
    const existingUserIndex = room.users.findIndex(u => u.userId === userId);
    if (existingUserIndex === -1) {
      room.users.push({ userId, socketId: socket.id, username });
    } else {
      room.users[existingUserIndex].socketId = socket.id;
    }

    if (isCreator) {
      room.hostId = userId;
    }

    // Set first user as host if host is disconnected
    if (!room.users.find(u => u.userId === room.hostId)) {
      room.hostId = room.users[0]?.userId;
    }

    io.to(roomId).emit('room:state', {
      users: room.users,
      hostId: room.hostId,
      videoUrl: room.videoUrl,
      isScreenSharing: room.isScreenSharing
    });

    console.log(`User ${username} (${userId}) joined room ${roomId}`);
  });

  socket.on('video:state_change', (data) => {
    if (!socket.roomId) return;
    // Volatile broadcast to prevent Infinite Loop Trap
    socket.volatile.to(socket.roomId).emit('video:state_change', data);
  });

  socket.on('video:heartbeat', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    // Only broadcast heartbeat if it's from the host
    if (room && room.hostId === socket.userId) {
      socket.volatile.to(socket.roomId).emit('video:heartbeat', data);
    }
  });

  socket.on('video:change_url', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (room && room.hostId === socket.userId) {
      room.videoUrl = data.url;
      io.to(socket.roomId).emit('room:state', {
        users: room.users,
        hostId: room.hostId,
        videoUrl: room.videoUrl,
        isScreenSharing: room.isScreenSharing
      });
    }
  });

  socket.on('video:toggle_screenshare', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (room && room.hostId === socket.userId) {
      room.isScreenSharing = data.active;
      // Broadcast the updated state reliably to everyone in the room
      io.to(socket.roomId).emit('room:state', {
        users: room.users,
        hostId: room.hostId,
        videoUrl: room.videoUrl,
        isScreenSharing: room.isScreenSharing
      });
    }
  });

  socket.on('webrtc:signal', (data) => {
    // Relays the signaling token (SDP/ICE) to a specific targeted socket
    io.to(data.targetSocketId).emit('webrtc:signal', {
      senderSocketId: socket.id,
      signal: data.signal
    });
  });

  // --- CHAT ---
  socket.on('chat:message', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;

    const message = {
      userId: socket.userId,
      username: data.username || 'Unknown',
      text: String(data.text || '').trim().slice(0, 500), // cap at 500 chars
      timestamp: Date.now()
    };

    if (!message.text) return;

    // Broadcast to everyone in the room including sender
    io.to(socket.roomId).emit('chat:message', message);
  });

  // --- OPEN MIC SIGNALING ---
  socket.on('mic:signal', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;

    // Only relay to recipients in same room
    const targetInRoom = room.users.some(u => u.socketId === data.targetSocketId);
    if (!targetInRoom) return;

    io.to(data.targetSocketId).emit('mic:signal', {
      senderSocketId: socket.id,
      signal: data.signal
    });
  });

  // Broadcast mic toggle state to the room
  socket.on('mic:toggle', (data) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;

    // Track which users have mic active on each user object
    const user = room.users.find(u => u.userId === socket.userId);
    if (user) {
      user.micActive = !!data.active;
    }

    io.to(socket.roomId).emit('room:state', {
      users: room.users,
      hostId: room.hostId,
      videoUrl: room.videoUrl,
      isScreenSharing: room.isScreenSharing
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      room.users = room.users.filter(u => u.socketId !== socket.id);
      
      if (room.users.length === 0) {
        delete rooms[socket.roomId];
      } else if (room.hostId === socket.userId) {
        room.hostId = room.users[0].userId;
        io.to(socket.roomId).emit('room:state', {
          users: room.users,
          hostId: room.hostId,
          videoUrl: room.videoUrl,
          isScreenSharing: room.isScreenSharing
        });
      } else {
        io.to(socket.roomId).emit('room:state', {
          users: room.users,
          hostId: room.hostId,
          videoUrl: room.videoUrl,
          isScreenSharing: room.isScreenSharing
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});

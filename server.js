const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto'); // Used for secure random username generation

/**
 * Simple HTML escaping to prevent XSS when emitting user‑provided strings.
 * Replaces &, <, >, ", and ' with their HTML entity equivalents.
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


const app = express();
const server = http.createServer(app);
// Origins allowed to open a Socket.IO connection. Browsers send an `Origin`
// header on WebSocket/polling requests; socket.io rejects any origin not on
// this list. Localhost is allowed by default for dev. On deployment set
// ALLOWED_ORIGINS to your production domain, e.g.:
//   ALLOWED_ORIGINS="https://chat.example.com,http://localhost:3000"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Non-browser clients (socket.io-client from Node, health checks) send no
      // Origin header — allow those. Everything else must match the allowlist.
      if (!origin) return callback(null, true);
      return callback(null, ALLOWED_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST']
  },
  serveClient: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  // Files are sent as base64 data URIs, which inflate raw bytes by ~33%
  // (20 MB video ≈ 27 MB on the wire). 30 MB keeps the relay buffer above
  // that ceiling — otherwise socket.io closes the connection on oversized
  // messages and mid-transfer file sends get dropped.
  maxHttpBufferSize: 30 * 1024 * 1024
});

// Basic hardening: hide the Express banner, force browsers to sniff no types.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Static frontend with modest caching (1h) to reduce repeat downloads.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ─── In-Memory Store ───────────────────────────────────────────────────────────
const users = new Map();      // socketId -> user profile
const waitingQueue = [];      // FIFO queue of socket IDs waiting for a match

// ─── Helper ────────────────────────────────────────────────────────────────────
function generateUsername() {
  const prefixes = ['Seeker', 'Dreamer', 'Wanderer', 'Soul', 'Spirit', 'Heart', 'Star', 'Moon', 'Sun', 'Sky'];
  // Use crypto for secure random values and ensure uniqueness across current users
  let username;
  do {
    const prefix = prefixes[crypto.randomInt(0, prefixes.length)];
    const num = crypto.randomInt(0, 9999);
    username = `${prefix}_${num}`;
    // Ensure no other user already has this username (case‑insensitive)
  } while ([...users.values()].some(u => u.username && u.username.toLowerCase() === username.toLowerCase()));
  return username;
}

function cleanupUser(socketId) {
  const user = users.get(socketId);
  if (!user) return;

  // Notify partner if chatting
  if (user.partner) {
    const partnerSocket = io.sockets.sockets.get(user.partner);
    if (partnerSocket) {
      partnerSocket.emit('stranger-disconnected', {
        reason: 'Stranger has left the conversation',
        partnerUsername: user.username
      });
    }
    const partner = users.get(user.partner);
    if (partner) {
      partner.partner = null;
      partner.room = null;
      partner.status = 'idle';
    }
  }

  // Remove from waiting queue
  const qIndex = waitingQueue.indexOf(socketId);
  if (qIndex !== -1) waitingQueue.splice(qIndex, 1);

  // Delete user
  users.delete(socketId);
  console.log(`🗑️  Cleaned up ${user.username} (${socketId}). Online: ${users.size}`);
}

// ─── Helper: check if two users pass each other's filters ─────────────────────
function passesFilters(seeker, target) {
  // Gender matching according to seeker's filter
  const genderMatch = seeker.filterGender === 'any' ||
    (seeker.filterGender === 'men' && target.gender === 'Male') ||
    (seeker.filterGender === 'women' && target.gender === 'Female') ||
    (seeker.filterGender === 'non-binary' && target.gender === 'Non-binary') ||
    seeker.filterGender === 'rather not say';
  // Also allow match if target selected "Rather not say"
  const targetGenderMatch = target.gender === 'Rather not say' || genderMatch;
  // Age range matching according to seeker's filter
  const ageMatch = target.age >= seeker.filterMinAge && target.age <= seeker.filterMaxAge;
  return targetGenderMatch && ageMatch;
}

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Simple per‑socket rate‑limiting map – event → last timestamp (ms)
  const rateLimits = new Map();

  function isRateLimited(event, minMs) {
    const now = Date.now();
    const last = rateLimits.get(event) || 0;
    if (now - last < minMs) return true;
    rateLimits.set(event, now);
    return false;
  }

  console.log(`🔌 Connected: ${socket.id}`);

  // ── Register ──────────────────────────────────────────────────────────────
  socket.on('register', (data) => {
    if (isRateLimited('register', 500)) return;

    // Re-registration (e.g. a socket that reconnected mid-session): tear down
    // the previous profile before replacing it. Without this, an active partner
    // would be left orphaned in 'chatting' state, and a reused custom username
    // would falsely collide with the stale entry still held in `users`.
    const previous = users.get(socket.id);
    if (previous) {
      const previousRoom = previous.room;
      cleanupUser(socket.id);
      if (previousRoom) socket.leave(previousRoom);
    }

    const username = data.username?.trim() || generateUsername();

    if (username.length > 24) {
      socket.emit('error-msg', { message: 'Username must be 24 characters or fewer.' });
      return;
    }

    // Check custom username uniqueness
    if (data.username?.trim() && [...users.values()].some(u => u.username && u.username.toLowerCase() === username.toLowerCase())) {
      socket.emit('error-msg', { message: 'Username already taken. Please choose another or leave blank for an anonymous name.' });
      return;
    }

    const age = parseInt(data.age) || null;
    const gender = data.gender || 'Rather not say';

    if (!age || age < 18 || age > 99) {
      socket.emit('error-msg', { message: 'Please enter a valid age (18–99).' });
      return;
    }

    const user = {
      id: socket.id,
      username,
      age,
      gender,
      status: 'registered', // registered | waiting | chatting | idle
      partner: null,
      room: null,
      // Filter preferences – default to show all users
      filterGender: data.filterGender || 'any', // any | men | women | non-binary
      filterMinAge: parseInt(data.filterMinAge) || 18,
      filterMaxAge: parseInt(data.filterMaxAge) || 100
    };

    users.set(socket.id, user);
    console.log(`📝 Registered: ${username} (${age}, ${gender})`);

    socket.emit('registered', {
      username,
      message: `Welcome, ${username}! Finding someone for you...`
    });

    // Automatically start looking
    socket.emit('start-finding');
  });

  // ── Update Filters ──────────────────────────────────────────────────────
  socket.on('filter-update', (data) => {
    if (isRateLimited('filter-update', 500)) return;
    const user = users.get(socket.id);
    if (!user) return;

    if (data.filterGender) user.filterGender = data.filterGender;
    if (data.filterMinAge) user.filterMinAge = parseInt(data.filterMinAge) || 18;
    if (data.filterMaxAge) user.filterMaxAge = parseInt(data.filterMaxAge) || 100;

    console.log(`🔧 ${user.username} updated filters: ${user.filterGender}, ${user.filterMinAge}-${user.filterMaxAge}`);
  });

  // ── Find Stranger ─────────────────────────────────────────────────────────
  socket.on('find-stranger', () => {
    if (isRateLimited('find-stranger', 1000)) return;
    const user = users.get(socket.id);
    if (!user) {
      socket.emit('error-msg', { message: 'Please register first.' });
      return;
    }

    // Guard: don't re-match if already in an active chat
    if (user.status === 'chatting') return;

    user.status = 'waiting';

    // Try to match with someone in the queue
    let matchedId = null;
    for (let i = 0; i < waitingQueue.length; i++) {
      const candidateId = waitingQueue[i];
      const candidate = users.get(candidateId);
      if (candidate && candidate.status === 'waiting' && candidateId !== socket.id
          && passesFilters(user, candidate) && passesFilters(candidate, user)) {
        matchedId = candidateId;
        waitingQueue.splice(i, 1);
        break;
      }
    }

    if (matchedId) {
      const partner = users.get(matchedId);
      const roomId = `room::${socket.id}::${matchedId}`;

      // Set up both users
      user.status = 'chatting';
      user.partner = matchedId;
      user.room = roomId;

      partner.status = 'chatting';
      partner.partner = socket.id;
      partner.room = roomId;

      // Join socket.io room
      socket.join(roomId);
      const partnerSocket = io.sockets.sockets.get(matchedId);
      if (partnerSocket) partnerSocket.join(roomId);

      // Notify both
      socket.emit('matched', {
        room: roomId,
        stranger: {
          username: partner.username,
          age: partner.age,
          gender: partner.gender
        }
      });

      if (partnerSocket) {
        partnerSocket.emit('matched', {
          room: roomId,
          stranger: {
            username: user.username,
            age: user.age,
            gender: user.gender
          }
        });
      }

      console.log(`💞 Matched: ${user.username} <-> ${partner.username}`);
    } else {
      // Guard against a repeated find-stranger enqueueing the same socket
      // twice — cancel-finding/cleanupUser only ever remove one occurrence.
      if (!waitingQueue.includes(socket.id)) {
        waitingQueue.push(socket.id);
      }
      socket.emit('waiting');
      console.log(`⏳ ${user.username} is waiting for a match...`);
    }
  });

  // ── Cancel Finding ────────────────────────────────────────────────────────
  socket.on('cancel-finding', () => {
    if (isRateLimited('cancel-finding', 500)) return;
    const user = users.get(socket.id);
    if (!user) return;

    const qIndex = waitingQueue.indexOf(socket.id);
    if (qIndex !== -1) waitingQueue.splice(qIndex, 1);

    user.status = 'registered';
    socket.emit('cancelled-finding');
  });

  // ── Skip Stranger ─────────────────────────────────────────────────────────
  socket.on('skip-stranger', () => {
    if (isRateLimited('skip-stranger', 2000)) return;
    const user = users.get(socket.id);
    if (!user || !user.partner) return;

    const oldPartnerId = user.partner;
    const oldRoom = user.room;

    // Notify partner with the skipper's username
    const partnerSocket = io.sockets.sockets.get(oldPartnerId);
    if (partnerSocket) {
      partnerSocket.emit('stranger-disconnected', {
        reason: 'Stranger has moved on',
        partnerUsername: user.username
      });
    }

    const partner = users.get(oldPartnerId);
    if (partner) {
      partner.partner = null;
      partner.room = null;
      partner.status = 'idle';
    }

    // Leave room
    if (oldRoom) {
      socket.leave(oldRoom);
    }

    // Reset this user
    user.partner = null;
    user.room = null;
    user.status = 'registered';

    console.log(`⏭️  ${user.username} skipped their match.`);

    // Automatically look for a new match
    socket.emit('start-finding');
  });

  // ── Chat Message ──────────────────────────────────────────────────────────
  socket.on('chat-message', (data) => {
    if (isRateLimited('chat-message', 200)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;

    const rawMessage = data.message?.trim();
    if (!rawMessage || rawMessage.length > 500) return;

    // Escape user‑provided content to prevent XSS
    const safeMessage = escapeHTML(rawMessage);

    socket.to(user.room).emit('chat-message', {
      sender: user.username,
      message: safeMessage,
      timestamp: Date.now()
    });
  });

  // ── File Message ─────────────────────────────────────────────────────────
  socket.on('file-message', (data) => {
    if (isRateLimited('file-message', 2000)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;

    const { fileName, fileType, fileSize, fileData } = data;
    if (!fileName || !fileType || !fileSize || !fileData) return;

    // Enforce per-category size limits
    const sizeLimits = {
      image: 5 * 1024 * 1024,
      video: 20 * 1024 * 1024,
      audio: 10 * 1024 * 1024,
    };
    const category = fileType.startsWith('image/') ? 'image'
                   : fileType.startsWith('video/') ? 'video'
                   : fileType.startsWith('audio/') ? 'audio'
                   : null;
    const maxBytes = sizeLimits[category] || 5 * 1024 * 1024;
    if (fileSize > maxBytes) return;
    // Defense-in-depth: a client can lie about `fileSize`, so also check the
    // actual wire payload (base64 data URI ≈ 1.4× raw size + ~100 B prefix).
    if (typeof fileData === 'string' && fileData.length > maxBytes * 1.4 + 100) return;

    socket.to(user.room).emit('file-message', {
      sender: user.username,
      fileName,
      fileType,
      fileSize,
      fileData,       // base64 data URI string
      timestamp: Date.now()
    });
  });

  // ── Typing Indicator ──────────────────────────────────────────────────────
  socket.on('typing', (data) => {
    if (isRateLimited('typing', 100)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    socket.to(user.room).emit('stranger-typing', {
      isTyping: data.isTyping
    });
  });

  // ── WebRTC Signaling ──────────────────────────────────────────────────────
  socket.on('call-offer', (data) => {
    if (isRateLimited('call-offer', 200)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    socket.to(user.room).emit('call-offer', {
      type: data.type,    // 'video' | 'voice'
      offer: data.offer,
      callId: data.callId // for client-side glare (double-call) resolution
    });
  });

  socket.on('call-answer', (data) => {
    if (isRateLimited('call-answer', 200)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    socket.to(user.room).emit('call-answer', {
      answer: data.answer
    });
  });

  socket.on('ice-candidate', (data) => {
    if (isRateLimited('ice-candidate', 200)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    socket.to(user.room).emit('ice-candidate', {
      candidate: data.candidate
    });
  });

  socket.on('end-call', () => {
    if (isRateLimited('end-call', 500)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    socket.to(user.room).emit('call-ended', {
      reason: 'Call ended by the other person'
    });
  });

  socket.on('call-rejected', () => {
    if (isRateLimited('call-rejected', 500)) return;
    const user = users.get(socket.id);
    if (!user || !user.room) return;
    // Relay the decline so the caller stops waiting instead of hanging in a
    // "call in progress" state forever.
    socket.to(user.room).emit('call-rejected', {
      reason: 'Call was declined'
    });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    cleanupUser(socket.id);
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   ✨ BlushChat ✨                     ║
  ║   Running on http://localhost:${String(PORT).padEnd(5)} ║
  ╚═══════════════════════════════════════╝
  `);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Close the HTTP server and drop all socket clients cleanly on SIGTERM/SIGINT
// (host restarts, Ctrl+C in dev) instead of killing the process abruptly.
function shutdown() {
  console.log('🛑 Shutting down...');
  io.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Safety net: force-exit if connections refuse to close.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

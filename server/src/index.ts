/**
 * Hold’em & Shot – Server bootstrap
 * - Express + Socket.IO
 * - CORS(다중 Origin), /health, /status
 * - Quick Match(8s 안 잡히면 AI 매칭)
 * - Create/Join Room(6자리 영숫자)
 * - 매치 성사 시 'match:started' → 엔진 wire + startRound
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';

import type { Room, ServerUser, MatchPayload } from './game/types.js';
import { startRound, wireGameHandlers } from './game/engine.js';

// ---------- Config ----------
const PORT = Number(process.env.PORT || 8080);

// 쉼표로 여러 Origin 허용 (Vercel/로컬 등)
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 6자리 영숫자 코드
const nano6 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// ---------- App / IO ----------
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl 등 허용
      const ok = ALLOWED_ORIGINS.includes(origin);
      cb(ok ? null : new Error('Not allowed by CORS'), ok);
    },
    credentials: true,
  })
);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
});

// ---------- In-memory state ----------
const rooms = new Map<string, Room>();
let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

// ---------- Helpers ----------
function makeAIName(): string {
  const pool = [
    'HAL9000',
    'EchoBot',
    'RogueAI',
    'TuringKid',
    'DealerX',
    'PokerDroid',
    'Synthia',
    'Atlas',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function getSocketNickname(socket: any): string {
  const raw = (socket.data?.nickname as string | undefined) || '';
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : 'PLAYER?';
}

function emitRoomUpdate(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('room:update', {
    roomId,
    stage: room.stage,
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isAI: !!p.isAI,
    })),
  });
}

function clearRoomTimer(room: Room, key: keyof Room['timers']) {
  const t = room.timers[key];
  if (t) clearTimeout(t as NodeJS.Timeout);
  room.timers[key] = null;
}

function putInRoom(roomId: string, socketId: string) {
  const s = io.sockets.sockets.get(socketId);
  if (s) s.join(roomId);
}

// 매치 성사 → 클라 통지 + 엔진 시작
function startMatch(room: Room) {
  room.stage = 'playing';
  clearRoomTimer(room, 'aiFallback');

  const payloadFor = (me: ServerUser, opp: ServerUser): MatchPayload => ({
    roomId: room.id,
    you: me,
    opponent: opp,
    round: room.round,
  });

  room.players.forEach((p, idx) => {
    if (p.isAI) return;
    const opp = room.players[1 - idx];
    io.to(p.id).emit('match:started', payloadFor(p, opp));
  });

  // 엔진 와이어링 + 라운드 시작
  wireGameHandlers(io, room);
  startRound(io, room);

  emitRoomUpdate(room.id);
}

// ---------- Express routes ----------
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    rooms: rooms.size,
    queueWaiting: !!quickQueue.waiting,
  });
});

app.get('/status', (_req, res) => {
  res.json({
    allowedOrigins: ALLOWED_ORIGINS,
    port: PORT,
    rooms: [...rooms.values()].map((r) => ({
      id: r.id,
      stage: r.stage,
      round: r.round,
      players: r.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isAI: !!p.isAI,
      })),
    })),
  });
});

// ---------- Socket.IO handlers ----------
io.on('connection', (socket) => {
  console.log('[socket] connected:', socket.id);

  // 홈 입장 시 닉네임 등록
  socket.on('home:hello', (payload: { nickname?: string } = {}) => {
    socket.data.nickname = (payload.nickname || '').trim();
    socket.emit('home:hello:ack', {
      ok: true,
      nickname: getSocketNickname(socket),
      serverTime: Date.now(),
    });
  });

  // Quick Match
  socket.on('match:quick', () => {
    const nickname = getSocketNickname(socket);

    // 누군가 대기중이면 즉시 매칭
    if (quickQueue.waiting && io.sockets.sockets.has(quickQueue.waiting.socketId)) {
      const other = quickQueue.waiting;
      quickQueue.waiting = null;

      const roomId = nano6();
      const room: Room = {
        id: roomId,
        createdAt: Date.now(),
        players: [
          { id: other.socketId, nickname: other.nickname },
          { id: socket.id, nickname },
        ],
        stage: 'matching',
        round: 1,
        timers: { aiFallback: null },
        meta: { mode: 'quick' },
      };
      rooms.set(roomId, room);

      putInRoom(roomId, other.socketId);
      putInRoom(roomId, socket.id);

      io.to(other.socketId).emit('match:paired', { roomId, role: 'PLAYER1' });
      socket.emit('match:paired', { roomId, role: 'PLAYER2' });

      startMatch(room);
      return;
    }

    // 내가 첫 대기자 → 8s 후 AI 매칭
    quickQueue.waiting = { socketId: socket.id, nickname, enqueuedAt: Date.now() };
    socket.emit('match:queued', { timeoutSec: 8 });

    setTimeout(() => {
      if (!quickQueue.waiting || quickQueue.waiting.socketId !== socket.id) return;

      const roomId = nano6();
      const ai: ServerUser = {
        id: `AI:${roomId}`,
        nickname: makeAIName(),
        isAI: true,
      };

      const room: Room = {
        id: roomId,
        createdAt: Date.now(),
        players: [
          { id: socket.id, nickname },
          ai,
        ],
        stage: 'matching',
        round: 1,
        timers: { aiFallback: null },
        meta: { mode: 'quick' },
      };
      rooms.set(roomId, room);

      putInRoom(roomId, socket.id);

      socket.emit('match:paired', { roomId, role: 'PLAYER1', vsAI: true });

      quickQueue.waiting = null;
      startMatch(room);
    }, 8000);
  });

  // Create Room
  socket.on('room:create', () => {
    const roomId = nano6();
    const nickname = getSocketNickname(socket);

    const room: Room = {
      id: roomId,
      createdAt: Date.now(),
      players: [{ id: socket.id, nickname }],
      stage: 'matching',
      round: 1,
      timers: { aiFallback: null },
      meta: { mode: 'code' },
    };
    rooms.set(roomId, room);
    putInRoom(roomId, socket.id);

    socket.emit('room:created', { roomId });
    emitRoomUpdate(roomId);
  });

  // Join Room
  socket.on('room:join', (payload: { roomId: string }) => {
    const roomId = (payload?.roomId || '').trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('room:join:error', { message: 'Room not found' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('room:join:error', { message: 'Room is full' });
      return;
    }

    const nickname = getSocketNickname(socket);
    room.players.push({ id: socket.id, nickname });
    putInRoom(roomId, socket.id);

    io.to(roomId).emit('room:joined', { roomId, players: room.players });
    emitRoomUpdate(roomId);

    if (room.players.length === 2) startMatch(room);
  });

  // 홈 좌하단 서버 버튼 “새로고침”
  socket.on('server:ping', () => {
    socket.emit('server:pong', { t: Date.now(), ok: true });
  });

  socket.on('disconnect', () => {
    // 큐에서 나간 경우 정리
    if (quickQueue.waiting?.socketId === socket.id) {
      quickQueue.waiting = null;
    }

    // 방에서 나간 경우 처리
    for (const room of rooms.values()) {
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        emitRoomUpdate(room.id);

        // 전원 퇴장 or AI만 남으면 방 제거
        if (room.players.length === 0 || (room.players.length === 1 && room.players[0].isAI)) {
          rooms.delete(room.id);
        }
        break;
      }
    }

    console.log('[socket] disconnected:', socket.id);
  });
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`Hold’em & Shot server on :${PORT}`);
  console.log('Allowed Origins:', ALLOWED_ORIGINS.join(', '));
});

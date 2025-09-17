import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';
import type { Room, ServerUser, MatchPayload } from './game/types.js';

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map(s=>s.trim()).filter(Boolean);
const nano6 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const app = express();
app.use(express.json());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok = ALLOWED_ORIGINS.includes(origin);
    cb(ok ? null : new Error('Not allowed by CORS'), ok);
  },
  credentials: true,
}));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGINS, credentials: true } });

const rooms = new Map<string, Room>();
let quickQueue: { waiting: { socketId: string; nickname: string; enqueuedAt: number } | null } = { waiting: null };

function makeAIName(): string {
  const pool = ['HAL9000','EchoBot','RogueAI','TuringKid','DealerX','PokerDroid','Synthia','Atlas'];
  return pool[Math.floor(Math.random()*pool.length)];
}
function getSocketNickname(socket: any): string {
  const raw = (socket.data?.nickname as string | undefined) || '';
  const t = raw.trim();
  return t.length ? t : 'PLAYER?';
}
function emitRoomUpdate(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('room:update', {
    roomId, stage: room.stage, round: room.round,
    players: room.players.map(p=>({id:p.id,nickname:p.nickname,isAI:!!p.isAI}))
  });
}
function startMatch(room: Room) {
  room.stage = 'playing';
  clearRoomTimer(room,'aiFallback');
  const [p1,p2] = room.players;
  const payloadFor = (me: ServerUser, opp: ServerUser): MatchPayload => ({
    roomId: room.id, you: me, opponent: opp, round: room.round,
  });
  room.players.forEach((p,idx)=>{
    if (p.isAI) return;
    io.to(p.id).emit('match:started', payloadFor(p, room.players[1-idx]));
  });
  emitRoomUpdate(room.id);
}
function clearRoomTimer(room: Room, key: keyof Room['timers']) {
  const t = room.timers[key]; if (t) clearTimeout(t as NodeJS.Timeout); room.timers[key]=null;
}
function putInRoom(roomId: string, socketId: string) {
  const s = io.sockets.sockets.get(socketId); if (s) s.join(roomId);
}

app.get('/health', (_req,res)=>{
  res.json({ ok:true, uptime:process.uptime(), rooms:rooms.size, queueWaiting:!!quickQueue.waiting });
});
app.get('/status', (_req,res)=>{
  res.json({
    allowedOrigins: ALLOWED_ORIGINS, port: PORT,
    rooms: [...rooms.values()].map(r=>({
      id:r.id, stage:r.stage, round:r.round,
      players: r.players.map(p=>({id:p.id,nickname:p.nickname,isAI:!!p.isAI}))
    }))
  });
});

io.on('connection', (socket)=>{
  console.log('[socket] connected:', socket.id);

  socket.on('home:hello', (payload: { nickname?: string } = {}) => {
    socket.data.nickname = (payload.nickname || '').trim();
    socket.emit('home:hello:ack', { ok:true, nickname:getSocketNickname(socket), serverTime: Date.now() });
  });

  socket.on('match:quick', () => {
    const nickname = getSocketNickname(socket);
    if (quickQueue.waiting && io.sockets.sockets.has(quickQueue.waiting.socketId)) {
      const other = quickQueue.waiting; quickQueue.waiting = null;
      const roomId = nano6();
      const room: Room = {
        id: roomId, createdAt: Date.now(),
        players: [{id:other.socketId,nickname:other.nickname},{id:socket.id,nickname}],
        stage: 'matching', round: 1, timers: { aiFallback: null }, meta: { mode: 'quick' }
      };
      rooms.set(roomId, room);
      putInRoom(roomId, other.socketId); putInRoom(roomId, socket.id);
      io.to(other.socketId).emit('match:paired', { roomId, role:'PLAYER1' });
      socket.emit('match:paired', { roomId, role:'PLAYER2' });
      startMatch(room); return;
    }
    quickQueue.waiting = { socketId: socket.id, nickname, enqueuedAt: Date.now() };
    socket.emit('match:queued', { timeoutSec: 8 });
    setTimeout(()=>{
      if (!quickQueue.waiting || quickQueue.waiting.socketId !== socket.id) return;
      const roomId = nano6();
      const ai: ServerUser = { id:`AI:${roomId}`, nickname: makeAIName(), isAI: true };
      const room: Room = {
        id: roomId, createdAt: Date.now(),
        players: [{id:socket.id,nickname}, ai],
        stage: 'matching', round: 1, timers: { aiFallback: null }, meta: { mode: 'quick' }
      };
      rooms.set(roomId, room);
      putInRoom(roomId, socket.id);
      socket.emit('match:paired', { roomId, role:'PLAYER1', vsAI: true });
      quickQueue.waiting = null;
      startMatch(room);
    }, 8000);
  });

  socket.on('room:create', () => {
    const roomId = nano6();
    const nickname = getSocketNickname(socket);
    const room: Room = {
      id: roomId, createdAt: Date.now(),
      players: [{ id: socket.id, nickname }],
      stage: 'matching', round: 1, timers: { aiFallback: null }, meta: { mode: 'code' }
    };
    rooms.set(roomId, room);
    putInRoom(roomId, socket.id);
    socket.emit('room:created', { roomId });
    emitRoomUpdate(roomId);
  });

  socket.on('room:join', (payload: { roomId: string }) => {
    const roomId = (payload?.roomId || '').trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) { socket.emit('room:join:error', { message: 'Room not found' }); return; }
    if (room.players.length >= 2) { socket.emit('room:join:error', { message: 'Room is full' }); return; }
    const nickname = getSocketNickname(socket);
    room.players.push({ id: socket.id, nickname });
    putInRoom(roomId, socket.id);
    io.to(roomId).emit('room:joined', { roomId, players: room.players });
    emitRoomUpdate(roomId);
    if (room.players.length === 2) startMatch(room);
  });

  socket.on('server:ping', () => { socket.emit('server:pong', { t: Date.now(), ok: true }); });

  socket.on('disconnect', () => {
    if (quickQueue.waiting?.socketId === socket.id) quickQueue.waiting = null;
    for (const room of rooms.values()) {
      const idx = room.players.findIndex(p=>p.id===socket.id);
      if (idx>=0) {
        room.players.splice(idx,1);
        emitRoomUpdate(room.id);
        if (room.players.length===0 || (room.players.length===1 && room.players[0].isAI)) rooms.delete(room.id);
        break;
      }
    }
    console.log('[socket] disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hold’em & Shot server on :${PORT}`);
  console.log('Allowed Origins:', ALLOWED_ORIGINS.join(', '));
});

/**
 * Hold’em & Shot – Server bootstrap (FULL)
 * - Express + Socket.IO
 * - CORS: *.vercel.app / *.onrender.com / localhost 허용 + env 추가 허용
 * - Quick Match(8s 미매칭 시 AI) / Create & Join Room(6자리)
 * - Surrender: 즉시 패배 처리 → game:result 방송(클라는 바로 결과 화면)
 * - 매치 직후 선공 무작위(yourSeat 포함) → 엔진이 턴을 관리하되 시작 좌석 힌트를 제공
 */

import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";

import type { Room, ServerUser, MatchPayload } from "./game/types.js";
import { startRound, wireGameHandlers } from "./game/engine.js";

/* =========================
 * Config
 * =======================*/
const PORT = Number(process.env.PORT || 8080);
const RAW_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 와일드카드 허용 규칙
function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true; // curl 등
  try {
    const u = new URL(origin);
    const host = u.hostname;

    // 1) 환경변수로 명시한 풀 오리진
    if (RAW_ORIGINS.includes(origin)) return true;
    // 2) vercel.app 전체 허용(프리뷰 포함)
    if (host.endsWith(".vercel.app")) return true;
    // 3) onrender.com(서버 자기 자신) / localhost 허용
    if (host.endsWith(".onrender.com") || host === "localhost") return true;
  } catch { /* ignore malformed origin */ }
  return false;
}

// 6자리 영숫자 코드
const nano6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

/* =========================
 * App / IO
 * =======================*/
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => cb(isAllowedOrigin(origin) ? null : new Error("Not allowed by CORS"), isAllowedOrigin(origin)),
    credentials: true,
  })
);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => cb(isAllowedOrigin(origin) ? null : new Error("Not allowed by CORS"), isAllowedOrigin(origin)),
    credentials: true,
  },
});

/* =========================
 * In-memory state
 * =======================*/
const rooms = new Map<string, Room>();
let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

/* =========================
 * Helpers
 * =======================*/
type Seat = "P1" | "P2";

function makeAIName(): string {
  const pool = ["HAL9000", "EchoBot", "RogueAI", "TuringKid", "DealerX", "PokerDroid", "Synthia", "Atlas"];
  return pool[Math.floor(Math.random() * pool.length)];
}
function getSocketNickname(socket: any): string {
  const raw = (socket.data?.nickname as string | undefined) || "";
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : "PLAYER?";
}
function otherSeat(seat: Seat): Seat {
  return seat === "P1" ? "P2" : "P1";
}
function getSeat(room: Room, socketId: string): Seat | null {
  if (!room.players.length) return null;
  if (room.players[0]?.id === socketId) return "P1";
  if (room.players[1]?.id === socketId) return "P2";
  return null;
}
function putInRoom(roomId: string, socketId: string) {
  const s = io.sockets.sockets.get(socketId);
  if (s) s.join(roomId);
}
function emitRoomUpdate(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:update", {
    roomId,
    stage: room.stage,
    round: room.round,
    players: room.players.map((p) => ({ id: p.id, nickname: p.nickname, isAI: !!p.isAI })),
  });
}
function cleanupRoomLater(roomId: string, ms = 6000) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.stage = "ended";
  setTimeout(() => rooms.delete(roomId), ms);
}

// 매치 성사 → 클라 통지 + 엔진 시작
function startMatch(room: Room) {
  room.stage = "playing";

  // 선공 무작위 선정(라운드 시작 힌트로 사용)
  const starter: Seat = Math.random() < 0.5 ? "P1" : "P2";
  room.meta = room.meta || {};
  (room.meta as any).starter = starter;

  const payloadFor = (me: ServerUser, opp: ServerUser, seat: Seat): MatchPayload & { yourSeat: Seat } => ({
    roomId: room.id,
    you: me,
    opponent: opp,
    round: room.round,
    yourSeat: seat,
  });

  room.players.forEach((p, idx) => {
    if (p.isAI) return;
    const opp = room.players[1 - idx];
    const seat: Seat = idx === 0 ? "P1" : "P2";
    io.to(p.id).emit("match:started", payloadFor(p, opp, seat));
  });

  // 엔진 와이어 + 라운드 시작
  wireGameHandlers(io, room);

  // 엔진이 자체적으로 턴을 관리하더라도, 첫 힌트를 전달(클라에서 Ready 버튼 비활성화 초기화용)
  io.to(room.id).emit("game:phase", { phase: "Dealing", round: room.round, turn: starter });

  startRound(io, room);
  emitRoomUpdate(room.id);
}

/* =========================
 * Express routes
 * =======================*/
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: process.uptime(), rooms: rooms.size, queueWaiting: !!quickQueue.waiting, allow: RAW_ORIGINS });
});
app.get("/status", (_req: Request, res: Response) => {
  res.json({
    allowedOrigins: RAW_ORIGINS, port: PORT,
    rooms: [...rooms.values()].map((r) => ({
      id: r.id, stage: r.stage, round: r.round,
      players: r.players.map((p) => ({ id: p.id, nickname: p.nickname, isAI: !!p.isAI })),
    })),
  });
});

/* =========================
 * Socket.IO handlers
 * =======================*/
io.on("connection", (socket) => {
  console.log("[socket] connected:", socket.id);

  socket.on("home:hello", (payload: { nickname?: string } = {}) => {
    socket.data.nickname = (payload.nickname || "").trim();
    socket.emit("home:hello:ack", { ok: true, nickname: getSocketNickname(socket), serverTime: Date.now() });
  });

  // Quick Match
  socket.on("match:quick", () => {
    const nickname = getSocketNickname(socket);

    // 누군가 대기중이면 즉시 매칭
    if (quickQueue.waiting && io.sockets.sockets.has(quickQueue.waiting.socketId)) {
      const other = quickQueue.waiting; quickQueue.waiting = null;

      const roomId = nano6();
      const room: Room = {
        id: roomId, createdAt: Date.now(),
        players: [{ id: other.socketId, nickname: other.nickname }, { id: socket.id, nickname }],
        stage: "matching", round: 1, timers: { aiFallback: null }, meta: { mode: "quick" },
      };
      rooms.set(roomId, room);

      putInRoom(roomId, other.socketId); putInRoom(roomId, socket.id);
      io.to(other.socketId).emit("match:paired", { roomId, role: "PLAYER1" });
      socket.emit("match:paired", { roomId, role: "PLAYER2" });

      startMatch(room); return;
    }

    // 내가 첫 대기자 → 8s 후 AI 매칭
    quickQueue.waiting = { socketId: socket.id, nickname, enqueuedAt: Date.now() };
    socket.emit("match:queued", { timeoutSec: 8 });

    const aiTimer = setTimeout(() => {
      if (!quickQueue.waiting || quickQueue.waiting.socketId !== socket.id) return;

      const roomId = nano6();
      const ai: ServerUser = { id: `AI:${roomId}`, nickname: makeAIName(), isAI: true };
      const room: Room = {
        id: roomId, createdAt: Date.now(),
        players: [{ id: socket.id, nickname }, ai],
        stage: "matching", round: 1, timers: { aiFallback: null }, meta: { mode: "quick" },
      };
      rooms.set(roomId, room);

      putInRoom(roomId, socket.id);
      socket.emit("match:paired", { roomId, role: "PLAYER1", vsAI: true });

      quickQueue.waiting = null;
      startMatch(room);
    }, 8000);

    socket.once("disconnect", () => clearTimeout(aiTimer));
  });

  // Create / Join
  socket.on("room:create", () => {
    const roomId = nano6();
    const nickname = getSocketNickname(socket);
    const room: Room = {
      id: roomId, createdAt: Date.now(),
      players: [{ id: socket.id, nickname }],
      stage: "matching", round: 1, timers: { aiFallback: null }, meta: { mode: "code" },
    };
    rooms.set(roomId, room); putInRoom(roomId, socket.id);
    socket.emit("room:created", { roomId }); emitRoomUpdate(roomId);
  });

  socket.on("room:join", (payload: { roomId: string }) => {
    const roomId = (payload?.roomId || "").trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) return socket.emit("room:join:error", { message: "Room not found" });
    if (room.players.length >= 2) return socket.emit("room:join:error", { message: "Room is full" });

    const nickname = getSocketNickname(socket);
    room.players.push({ id: socket.id, nickname }); putInRoom(roomId, socket.id);
    io.to(roomId).emit("room:joined", { roomId, players: room.players }); emitRoomUpdate(roomId);
    if (room.players.length === 2) startMatch(room);
  });

  // ===== SURRENDER: 즉시 패배 처리 =====
  socket.on("game:surrender", (payload: { roomId: string }) => {
    const roomId = (payload?.roomId || "").trim();
    const room = rooms.get(roomId); if (!room) return;

    const mySeat = getSeat(room, socket.id); if (!mySeat) return;
    const winSeat = otherSeat(mySeat);

    io.to(roomId).emit("game:result", {
      roomId, round: room.round, winnerSeat: winSeat, reason: "surrender",
      // 클라가 텍스트를 표시할 수 있도록 최소 정보
      loserSeat: mySeat,
    });

    cleanupRoomLater(roomId, 6000);
  });

  // Ping
  socket.on("server:ping", () => socket.emit("server:pong", { t: Date.now(), ok: true }));

  // Disconnect 정리
  socket.on("disconnect", () => {
    if (quickQueue.waiting?.socketId === socket.id) quickQueue.waiting = null;

    for (const room of rooms.values()) {
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        emitRoomUpdate(room.id);
        if (room.players.length === 0 || (room.players.length === 1 && room.players[0].isAI)) rooms.delete(room.id);
        break;
      }
    }
    console.log("[socket] disconnected:", socket.id);
  });
});

/* =========================
 * Start
 * =======================*/
httpServer.listen(PORT, () => {
  console.log(`Hold’em & Shot server on :${PORT}`);
  console.log("Allowed Origins (env):", RAW_ORIGINS.join(", ") || "(none)");
});

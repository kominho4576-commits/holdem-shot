// server/src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server, Socket } from "socket.io";

import {
  evaluate7,
  describeBestHand,
  type Card,
  type Rank,
  type Suit,
} from "./game/poker7.js";

// ---------- 경로 유틸 (ESM) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 빌드된 클라이언트가 위치할 경로: ../client/dist
// (server/dist/index.js 기준으로 상대경로 계산)
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

// ---------- 서버 기본 설정 ----------
const PORT = Number(process.env.PORT || 8080);
const ALLOWED = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      // 같은 오리진/정적서빙으로 오는 요청은 허용
      if (!origin) return cb(null, true);
      if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

// 헬스체크
app.get("/health", (_req, res) => res.json({ ok: true }));

// ----- 정적 클라이언트 서빙 -----
app.use(express.static(CLIENT_DIST));

// SPA 라우팅(소켓/io/헬스 제외 모든 경로는 index.html 반환)
app.get(/^\/(?!health|socket\.io\/).*$/, (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED.length ? ALLOWED : true,
    credentials: true,
  },
});

// ---------- 타입 ----------
type PlayerRef = {
  id: string;
  nickname: string;
  isAI: boolean;
  socketId?: string;
  hand: Card[];
  ready: boolean;
  surrendered: boolean;
};

type Phase = "dealing" | "flop" | "turn" | "river" | "showdown" | "roulette";

type Room = {
  code: string;
  players: PlayerRef[];
  board: Card[];
  deck: Card[];
  phase: Phase;
  round: number;
  turnIndex: 0 | 1;
  exchangeStep: 0 | 1;
};

// ---------- 카드 유틸 ----------
function buildDeck(): Card[] {
  const ranks: Rank[] = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const suits: Suit[] = ["S","H","D","C"];
  const deck: Card[] = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  deck.push({ rank: "JOKER", suit: "X" });
  deck.push({ rank: "JOKER", suit: "X" });
  return deck;
}
function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
}
function code6() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

// ---------- 상태 ----------
const rooms = new Map<string, Room>();
const waiting: { socketId: string; nickname: string }[] = [];

// ---------- 라운드 관리 ----------
function startRound(room: Room) {
  room.phase = "dealing";
  room.deck = buildDeck();
  shuffle(room.deck);
  room.board = [];
  for (const p of room.players) {
    p.hand = [];
    p.ready = false;
    p.surrendered = false;
  }
  // 개인 카드 2장씩
  for (let i = 0; i < 2; i++) for (const p of room.players) p.hand.push(room.deck.pop()!);
  // 공유 카드 5장 (조커 제외)
  while (room.board.length < 5 && room.deck.length) {
    const c = room.deck.pop()!;
    if (c.rank === "JOKER") continue;
    room.board.push(c);
  }
  room.turnIndex = Math.random() < 0.5 ? 0 : 1;
  room.exchangeStep = 0;
  emitState(room);
  io.to(room.code).emit("phase", { phase: "dealing", round: room.round });
}
function reveal(room: Room, which: Phase) {
  room.phase = which;
  emitState(room);
  io.to(room.code).emit("phase", { phase: which, round: room.round });
}
function doExchange(room: Room, idx: 0 | 1, indices: number[]) {
  const p = room.players[idx];
  const safe = [...new Set(indices.filter((i) => i === 0 || i === 1))].slice(0, 2);
  for (const i of safe) p.hand[i] = room.deck.pop()!;
}

// ---------- 브로드캐스트 ----------
function publicPlayer(p: PlayerRef) {
  return { id: p.id, nickname: p.nickname, isAI: p.isAI, ready: p.ready };
}
function emitState(room: Room) {
  io.to(room.code).emit("state", {
    code: room.code,
    phase: room.phase,
    round: room.round,
    board: room.board,
    players: room.players.map(publicPlayer),
    turnIndex: room.turnIndex,
    exchangeStep: room.exchangeStep,
  });
}

// ---------- 매치메이킹 ----------
function ensureRoom(): Room {
  let c = code6();
  while (rooms.has(c)) c = code6();
  const room: Room = {
    code: c,
    players: [],
    board: [],
    deck: [],
    phase: "dealing",
    round: 1,
    turnIndex: 0,
    exchangeStep: 0,
  };
  rooms.set(c, room);
  return room;
}
function joinRoom(room: Room, socket: Socket, nickname: string, isAI = false) {
  if (room.players.length >= 2) {
    socket.emit("error:room", { message: "Room is full" });
    return false;
  }
  const p: PlayerRef = {
    id: socket.id,
    nickname: nickname || (isAI ? aiName() : `PLAYER${room.players.length + 1}`),
    isAI,
    socketId: socket.id,
    hand: [],
    ready: false,
    surrendered: false,
  };
  room.players.push(p);
  socket.join(room.code);
  emitState(room);
  if (room.players.length === 2) startRound(room);
  return true;
}
function aiName() {
  const pool = ["HAL","MAVERICK","R2D2","BORG","BOT77","IVY","KATE"];
  return pool[(Math.random() * pool.length) | 0];
}

// ---------- 소켓 이벤트 ----------
io.on("connection", (socket) => {
  socket.emit("hello", { id: socket.id });

  socket.on("createRoom", ({ nickname }) => {
    const room = ensureRoom();
    joinRoom(room, socket, nickname || "");
    socket.emit("roomCreated", { code: room.code });
  });

  socket.on("joinRoom", ({ code, nickname }) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return socket.emit("error:room", { message: "Room not found" });
    joinRoom(room, socket, nickname || "");
  });

  socket.on("quickMatch", ({ nickname }) => {
    const peer = waiting.shift();
    if (peer && peer.socketId !== socket.id) {
      const room = ensureRoom();
      const ok1 = joinRoom(room, io.sockets.sockets.get(peer.socketId)!, peer.nickname);
      const ok2 = joinRoom(room, socket, nickname || "");
      if (!ok1 || !ok2) return;
      return;
    }
    waiting.push({ socketId: socket.id, nickname: nickname || "" });
    setTimeout(() => {
      const idx = waiting.findIndex((w) => w.socketId === socket.id);
      if (idx !== -1) {
        waiting.splice(idx, 1);
        const room = ensureRoom();
        joinRoom(room, socket, nickname || "");
        const aiSock = socket; // dummy for AI
        joinRoom(room, aiSock, aiName(), true);
      }
    }, 2000);
  });

  socket.on("ready", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return;
    room.players[idx].ready = true;
    emitState(room);
    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      reveal(room, "flop");
    }
  });

  socket.on("exchange", ({ code, indices }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (!["flop","turn","river"].includes(room.phase)) return;
    const meIdx = room.players.findIndex((p) => p.id === socket.id);
    if (meIdx < 0) return;
    const expected = room.exchangeStep === 0 ? room.turnIndex : (room.turnIndex === 0 ? 1 : 0);
    if (meIdx !== expected) return;
    doExchange(room, meIdx as 0 | 1, indices || []);
    emitState(room);
    if (room.exchangeStep === 0) {
      room.exchangeStep = 1;
    } else {
      room.exchangeStep = 0;
      if (room.phase === "flop") reveal(room, "turn");
      else if (room.phase === "turn") reveal(room, "river");
      else if (room.phase === "river") doShowdown(room);
    }
  });

  socket.on("surrender", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const meIdx = room.players.findIndex((p) => p.id === socket.id);
    if (meIdx < 0) return;
    room.players[meIdx].surrendered = true;
    const winnerIdx = (meIdx === 0 ? 1 : 0) as 0 | 1;
    io.to(room.code).emit("round:result", {
      round: room.round,
      winner: winnerIdx,
      reason: "Surrender",
    });
    startRoulette(room, meIdx as 0 | 1);
  });

  socket.on("disconnect", () => {
    const idx = waiting.findIndex((w) => w.socketId === socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    for (const room of rooms.values()) {
      const i = room.players.findIndex((p) => p.id === socket.id);
      if (i !== -1) {
        room.players.splice(i, 1);
        io.to(room.code).emit("info", { message: "A player left." });
        emitState(room);
      }
      if (room.players.length === 0) rooms.delete(room.code);
    }
  });
});

// ---------- 쇼다운 & 룰렛 ----------
function doShowdown(room: Room) {
  room.phase = "showdown";
  emitState(room);
  const [A, B] = room.players;
  const evA = evaluate7([...A.hand, ...room.board]);
  const evB = evaluate7([...B.hand, ...room.board]);

  let winner: 0 | 1 | -1 = -1;
  const cmp =
    evA.category !== evB.category
      ? evA.category - evB.category
      : (() => {
          for (let i = 0; i < Math.max(evA.tiebreak.length, evB.tiebreak.length); i++) {
            const d = (evA.tiebreak[i] ?? 0) - (evB.tiebreak[i] ?? 0);
            if (d) return d;
          }
          return 0;
        })();

  if (cmp > 0) winner = 0;
  else if (cmp < 0) winner = 1;
  else winner = -1;

  io.to(room.code).emit("round:result", { round: room.round, winner });

  if (winner === -1) return proceedNextRound(room);
  const loser = winner === 0 ? 1 : 0;
  startRoulette(room, loser as 0 | 1);
}

function startRoulette(room: Room, loserIdx: 0 | 1) {
  room.phase = "roulette";
  emitState(room);

  const bullets = Math.min(room.round, 6);
  const slots = new Set<number>();
  while (slots.size < bullets) slots.add((Math.random() * 6) | 0);
  const bulletSlots = [...slots];
  const startPos = (Math.random() * 6) | 0;
  const stopPos = (Math.random() * 6) | 0;
  const spins = 2 + ((Math.random() * 4) | 0);

  io.to(room.code).emit("roulette:start", {
    bullets,
    chambers: 6,
    bulletSlots,
    startPos,
    spins,
    stopPos,
  });

  setTimeout(() => {
    const bang = bulletSlots.includes(stopPos);
    io.to(room.code).emit("roulette:result", { bang, loser: loserIdx });

    setTimeout(() => {
      if (bang) {
        io.to(room.code).emit("game:end", {
          winner: loserIdx === 0 ? 1 : 0,
          loser: loserIdx,
        });
        rooms.delete(room.code);
      } else {
        proceedNextRound(room);
      }
    }, 1000);
  }, 4800);
}

function proceedNextRound(room: Room) {
  room.round += 1;
  startRound(room);
}

// ---------- 서버 실행 ----------
server.listen(PORT, () => {
  console.log("holdem-shot server on :", PORT);
});

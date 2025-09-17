// server/src/index.ts
import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";

import {
  evaluate7,
  describeBestHand,
  type Card,
  type Rank,
  type Suit,
} from "./game/poker7.js"; // ✅ ESM 런타임에서 .js 확장자 필요

// ---------- 환경설정 ----------
const PORT = Number(process.env.PORT || 8080);
const ALLOWED = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED.length ? ALLOWED : true,
    credentials: true,
  },
});

// ---------- 유틸 ----------
type PlayerRef = {
  id: string;
  nickname: string;
  isAI: boolean;
  socketId?: string;
  hand: Card[];
  ready: boolean;
  surrendered: boolean;
  jokerShieldUsed: boolean;
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
  bulletsExtraForLoser: number;
  loserExempt: boolean;
};

// 54장(조커 2장 포함)
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

const rooms = new Map<string, Room>();
const waiting: { socketId: string; nickname: string }[] = [];

// ---------- 라운드 / 분배 ----------
function startRound(room: Room) {
  room.phase = "dealing";
  room.deck = buildDeck();
  shuffle(room.deck);
  room.board = [];
  room.loserExempt = false;
  room.bulletsExtraForLoser = 0;
  for (const p of room.players) {
    p.hand = [];
    p.ready = false;
    p.surrendered = false;
    p.jokerShieldUsed = false;
  }

  // 개인 카드 2장 지급(조커 가능)
  for (let i = 0; i < 2; i++) {
    for (const p of room.players) {
      p.hand.push(room.deck.pop()!);
    }
  }

  // 커뮤니티 5장 — 반드시 조커 제외
  while (room.board.length < 5 && room.deck.length) {
    const c = room.deck.pop()!;
    if (c.rank === "JOKER" || c.suit === "X") continue;
    room.board.push(c);
  }

  // 선순 설정
  if (room.round === 1) {
    room.turnIndex = (Math.random() < 0.5 ? 0 : 1);
  } else {
    room.turnIndex = (room.turnIndex === 0 ? 1 : 0);
  }
  room.exchangeStep = 0;

  emitState(room);
  io.to(room.code).emit("phase", { phase: "dealing", round: room.round });
}

function revealFlopTurnRiver(room: Room, which: "flop"|"turn"|"river") {
  room.phase = which;
  emitState(room);
  io.to(room.code).emit("phase", { phase: which, round: room.round });
}

// 교환 처리 (indices: 0~1 중 0~2장)
function doExchange(room: Room, playerIdx: 0 | 1, indices: number[]) {
  const p = room.players[playerIdx];
  const safeIdx = [...new Set(indices.filter((i) => i === 0 || i === 1))].slice(0, 2);
  for (const i of safeIdx) {
    p.hand[i] = room.deck.pop()!;
  }
}

// ---------- 상태 브로드캐스트 ----------
function publicPlayer(p: PlayerRef) {
  return {
    id: p.id,
    nickname: p.nickname || "",
    isAI: p.isAI,
    ready: p.ready,
  };
}
function emitState(room: Room) {
  const payload = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    board: room.board,
    players: room.players.map(publicPlayer),
    turnIndex: room.turnIndex,
    exchangeStep: room.exchangeStep,
  };
  io.to(room.code).emit("state", payload);
}

// ---------- 매치메이킹 ----------
function ensureRoom(code?: string): Room {
  let c = code || code6();
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
    bulletsExtraForLoser: 0,
    loserExempt: false,
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
    nickname: nickname?.trim() || (isAI ? aiName() : `PLAYER${room.players.length+1}`),
    isAI,
    socketId: socket.id,
    hand: [],
    ready: false,
    surrendered: false,
    jokerShieldUsed: false,
  };
  room.players.push(p);
  socket.join(room.code);
  emitState(room);
  if (room.players.length === 2) startRound(room);
  return true;
}
function aiName() {
  const pool = ["HAL","MAVERICK","R2D2","KATE","BORG","BOT-77","AYE"];
  return pool[(Math.random() * pool.length) | 0];
}

// ---------- 소켓 이벤트 ----------
io.on("connection", (socket) => {
  socket.emit("hello", { id: socket.id });

  socket.on("createRoom", ({ nickname }: { nickname?: string }) => {
    const room = ensureRoom();
    joinRoom(room, socket, nickname || "");
    socket.emit("roomCreated", { code: room.code });
  });

  socket.on("joinRoom", ({ code, nickname }: { code: string; nickname?: string }) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return socket.emit("error:room", { message: "Room not found" });
    joinRoom(room, socket, nickname || "");
  });

  socket.on("quickMatch", ({ nickname }: { nickname?: string }) => {
    const waitingPeer = waiting.shift();
    if (waitingPeer && waitingPeer.socketId !== socket.id) {
      const room = ensureRoom();
      const ok1 = joinRoom(room, io.sockets.sockets.get(waitingPeer.socketId)!, waitingPeer.nickname);
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
        const ok1 = joinRoom(room, socket, nickname || "");
        if (!ok1) return;
        const aiSocket = socket; // dummy
        joinRoom(room, aiSocket, aiName(), true);
      }
    }, 2000);
  });

  socket.on("ready", ({ code, ready }: { code: string; ready: boolean }) => {
    const room = rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return;
    room.players[idx].ready = !!ready;
    emitState(room);
    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      revealFlopTurnRiver(room, "flop");
    }
  });

  socket.on("exchange", ({ code, indices }: { code: string; indices: number[] }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (!["flop", "turn", "river"].includes(room.phase)) return;

    const meIdx = room.players.findIndex((p) => p.id === socket.id);
    if (meIdx < 0) return;

    const expectedIdx = (room.exchangeStep === 0 ? room.turnIndex : (room.turnIndex === 0 ? 1 : 0)) as 0|1;
    if (meIdx !== expectedIdx) return;

    doExchange(room, meIdx as 0|1, indices || []);
    emitState(room);

    if (room.exchangeStep === 0) {
      room.exchangeStep = 1;
      emitState(room);
      return;
    }
    room.exchangeStep = 0;
    if (room.phase === "flop") {
      revealFlopTurnRiver(room, "turn");
    } else if (room.phase === "turn") {
      revealFlopTurnRiver(room, "river");
    } else if (room.phase === "river") {
      doShowdown(room);
    }
  });

  socket.on("surrender", ({ code }: { code: string }) => {
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
      summary: "",
      my: {},
      opp: {},
    });
    startRoulette(room, meIdx as 0|1, false, 0);
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

  const A = room.players[0];
  const B = room.players[1];

  const evA = evaluate7([...A.hand, ...room.board]);
  const evB = evaluate7([...B.hand, ...room.board]);

  let winner: 0 | 1 | -1 = -1;
  const cmp =
    evA.category !== evB.category
      ? evA.category - evB.category
      : (() => {
          const aa = evA.tiebreak;
          const bb = evB.tiebreak;
          for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
            const d = (aa[i] ?? 0) - (bb[i] ?? 0);
            if (d) return d;
          }
          return 0;
        })();

  if (cmp > 0) winner = 0;
  else if (cmp < 0) winner = 1;
  else winner = -1;

  io.to(room.code).emit("round:result", {
    round: room.round,
    winner,
    reason: "Showdown",
    summary:
      winner === -1
        ? "Tie"
        : winner === 0
        ? describeBestHand(evA, evB)
        : describeBestHand(evB, evA),
    my: { a: evA, b: evB }
  });

  if (winner === -1) {
    proceedNextRound(room);
    return;
  }
  const loser = winner === 0 ? 1 : 0;

  const loserHasJoker = room.players[loser].hand.some(
    (c) => c.rank === "JOKER" || c.suit === "X"
  );
  const winnerHasJoker = room.players[winner].hand.some(
    (c) => c.rank === "JOKER" || c.suit === "X"
  );

  const exempt = loserHasJoker;
  const extra = winnerHasJoker ? 1 : 0;

  startRoulette(room, loser as 0|1, exempt, extra);
}

function startRoulette(room: Room, loserIdx: 0 | 1, exempt: boolean, extraBullets: number) {
  room.phase = "roulette";
  emitState(room);

  const baseBullets = Math.min(room.round, 6);
  const bullets = Math.min(baseBullets + (extraBullets || 0), 6);

  if (exempt) {
    io.to(room.code).emit("roulette:start", {
      bullets,
      exempt: true,
      chambers: 6,
      bulletSlots: []
    });
    setTimeout(() => proceedNextRound(room), 1000);
    return;
  }

  const slots = new Set<number>();
  while (slots.size < bullets) slots.add((Math.random() * 6) | 0);
  const bulletSlots = [...slots].sort((a,b)=>a-b);

  const startPos = (Math.random() * 6) | 0;
  const spins = 2 + ((Math.random() * 4) | 0);
  const stopPos = (Math.random() * 6) | 0;

  io.to(room.code).emit("roulette:start", {
    bullets,
    exempt: false,
    chambers: 6,
    bulletSlots,
    startPos,
    spins,
    stopPos
  });

  setTimeout(() => {
    const bang = bulletSlots.includes(stopPos);
    io.to(room.code).emit("roulette:result", {
      bang,
      loser: loserIdx
    });
    setTimeout(() => {
      if (bang) {
        io.to(room.code).emit("game:end", {
          winner: loserIdx === 0 ? 1 : 0,
          loser: loserIdx
        });
        rooms.delete(room.code);
      } else {
        proceedNextRound(room);
      }
    }, 1000);
  }, 5000);
}

function proceedNextRound(room: Room) {
  room.round += 1;
  startRound(room);
}

// ---------- 서버 시작 ----------
server.listen(PORT, () => {
  console.log("holdem-shot server on :", PORT);
});

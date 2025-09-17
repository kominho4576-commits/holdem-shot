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
} from "./game/poker7";

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
  jokerShieldUsed: boolean; // 라운드별 사용 플래그는 라운드 초기화 시 false
};

type Phase = "dealing" | "flop" | "turn" | "river" | "showdown" | "roulette";

type Room = {
  code: string;
  players: PlayerRef[]; // 최대 2명
  board: Card[]; // 5장 (커뮤니티) — 조커 제외
  deck: Card[];
  phase: Phase;
  round: number;
  turnIndex: 0 | 1; // 현재 교환 선순 (0 또는 1)
  exchangeStep: 0 | 1; // 각 단계에서 0(선순)→1(후순)
  bulletsExtraForLoser: number; // 조커 효과로 추가 탄수
  loserExempt: boolean; // 조커로 면제
};

// 54장(조커 2장 포함)
function buildDeck(): Card[] {
  const ranks: Rank[] = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const suits: Suit[] = ["S","H","D","C"];
  const deck: Card[] = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  // Jokers
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
    if (c.rank === "JOKER" || c.suit === "X") continue; // 스킵
    room.board.push(c);
  }

  // 선순 무작위 — 라운드마다 번갈아야 하면 여기서 토글 가능
  if (room.round === 1) {
    room.turnIndex = (Math.random() < 0.5 ? 0 : 1);
  } else {
    // 이전 라운드 후순이 이번 라운드 선순
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
    // 새 카드 — 조커도 가능 (손패에만 조커 허용 규칙)
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
    board: room.board, // 클라에서 단계에 따라 가려서 렌더
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

  if (room.players.length === 2) {
    startRound(room);
  }
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
    // 큐에 누군가 있으면 매칭, 없으면 대기 → 2초 지나도 없으면 AI 투입
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
      // 아직 대기 중이면 AI랑 매칭
      const idx = waiting.findIndex((w) => w.socketId === socket.id);
      if (idx !== -1) {
        waiting.splice(idx, 1);
        const room = ensureRoom();
        const ok1 = joinRoom(room, socket, nickname || "");
        if (!ok1) return;
        // AI 플레이어
        const aiSocket = socket; // 실제 소켓은 없지만, 동일 처리 위해 joinRoom만 호출
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

    // 둘 다 ready면 flop 공개
    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      revealFlopTurnRiver(room, "flop");
    }
  });

  // 내 차례에 교환 실행
  socket.on("exchange", ({ code, indices }: { code: string; indices: number[] }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (!["flop", "turn", "river"].includes(room.phase)) return;

    const meIdx = room.players.findIndex((p) => p.id === socket.id);
    if (meIdx < 0) return;

    // 선/후 순서 체크
    const expectedIdx = (room.exchangeStep === 0 ? room.turnIndex : (room.turnIndex === 0 ? 1 : 0)) as 0|1;
    if (meIdx !== expectedIdx) return; // 내 차례 아님

    doExchange(room, meIdx as 0|1, indices || []);
    emitState(room);

    // 다음 사람으로
    if (room.exchangeStep === 0) {
      room.exchangeStep = 1;
      emitState(room);
      return;
    }

    // 선/후 둘 다 끝났으면 다음 단계로
    room.exchangeStep = 0;
    if (room.phase === "flop") {
      revealFlopTurnRiver(room, "turn");
    } else if (room.phase === "turn") {
      revealFlopTurnRiver(room, "river");
    } else if (room.phase === "river") {
      // 쇼다운
      doShowdown(room);
    }
  });

  socket.on("surrender", ({ code }: { code: string }) => {
    const room = rooms.get(code);
    if (!room) return;
    const meIdx = room.players.findIndex((p) => p.id === socket.id);
    if (meIdx < 0) return;

    room.players[meIdx].surrendered = true;
    // 즉시 종료 처리: 상대 승
    const winnerIdx = (meIdx === 0 ? 1 : 0) as 0 | 1;
    io.to(room.code).emit("round:result", {
      round: room.round,
      winner: winnerIdx,
      reason: "Surrender",
      summary: "",
      my: {},
      opp: {},
    });
    // 바로 러시안 룰렛 (패자만)
    startRoulette(room, meIdx as 0|1, /*jokerExempt*/ false, /*extra*/ 0);
  });

  socket.on("disconnect", () => {
    // 대기열 제거
    const idx = waiting.findIndex((w) => w.socketId === socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    // 룸에서 제거
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
  // compare
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
    my: { a: evA, b: evB }, // 클라에서 사용자 기준으로 해석
  });

  // 러시안 룰렛: 패자만
  if (winner === -1) {
    // 무승부면 다음 라운드로
    proceedNextRound(room);
    return;
  }
  const loser = winner === 0 ? 1 : 0;

  // 조커 효과 적용
  const loserHasJoker = room.players[loser].hand.some(
    (c) => c.rank === "JOKER" || c.suit === "X"
  );
  const winnerHasJoker = room.players[winner].hand.some(
    (c) => c.rank === "JOKER" || c.suit === "X"
  );

  const exempt = loserHasJoker;               // 진 사람이 조커 → 면제
  const extra = winnerHasJoker ? 1 : 0;       // 이긴 사람이 조커 → 상대 총알 1개 추가

  startRoulette(room, loser as 0|1, exempt, extra);
}

function startRoulette(room: Room, loserIdx: 0 | 1, exempt: boolean, extraBullets: number) {
  room.phase = "roulette";
  emitState(room);

  const baseBullets = Math.min(room.round, 6); // 라운드마다 +1, 최대 6
  const bullets = Math.min(baseBullets + (extraBullets || 0), 6);

  // 면제면 바로 SAFE
  if (exempt) {
    io.to(room.code).emit("roulette:start", {
      bullets,
      exempt: true,
      chambers: 6,
      bulletSlots: [],
    });
    setTimeout(() => proceedNextRound(room), 1000);
    return;
  }

  // 총알 위치(0~5) 무작위 배치
  const slots = new Set<number>();
  while (slots.size < bullets) slots.add((Math.random() * 6) | 0);
  const bulletSlots = [...slots].sort((a,b)=>a-b);

  // 시작 포인터
  const startPos = (Math.random() * 6) | 0;
  // 회전 횟수(랜덤), 마지막 정지 위치(정확히 홈에 맞춤)
  const spins = 2 + ((Math.random() * 4) | 0); // 2~5바퀴
  const stopPos = (Math.random() * 6) | 0;

  io.to(room.code).emit("roulette:start", {
    bullets,
    exempt: false,
    chambers: 6,
    bulletSlots,
    startPos,
    spins,
    stopPos,
  });

  // 5초 정도 돌리고 결과 통지(클라에서 애니메이션)
  setTimeout(() => {
    const bang = bulletSlots.includes(stopPos);
    io.to(room.code).emit("roulette:result", {
      bang,
      loser: loserIdx,
    });

    setTimeout(() => {
      if (bang) {
        // 게임 종료
        io.to(room.code).emit("game:end", {
          winner: loserIdx === 0 ? 1 : 0,
          loser: loserIdx,
        });
        // 방 정리
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

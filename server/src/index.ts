import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

type Seat = "P1" | "P2";
type Phase = "Dealing" | "Flop" | "Turn" | "River";
type Card = { r?: number; s?: number; isJoker?: boolean };

const app = express();

// ----- CORS -----
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = allowedOrigins.length === 0 || allowedOrigins.includes(origin);
      cb(ok ? null : new Error("CORS blocked"), ok);
    },
    credentials: true,
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

// ====== 게임 상태 ======
type Room = {
  id: string;
  seats: { P1?: string; P2?: string };
  names: { P1: string; P2: string };
  round: number;
  phase: Phase;
  turn: Seat; // 현재 교환 차례
  deck: Card[];
  board: Card[]; // 공유 (조커 제외)
  hole: { P1: Card[]; P2: Card[] };
  ready: Set<string>;
  lastStarter: Seat; // 이전 교환에서 먼저 했던 사람
};

const rooms = new Map<string, Room>();
const queue: string[] = []; // 대기열

// ====== 유틸 ======
const suits = [0, 1, 2, 3]; // ♠ ♥ ♦ ♣
const rankRange = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11~14: J Q K A

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of suits) for (const r of rankRange) deck.push({ r, s });
  // 조커 2장
  deck.push({ isJoker: true });
  deck.push({ isJoker: true });
  return shuffle(deck);
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function draw(deck: Card[]): Card {
  const c = deck.pop();
  if (!c) throw new Error("Deck empty");
  return c;
}
function drawHole(deck: Card[]): Card[] {
  return [draw(deck), draw(deck)];
}
// **보드는 조커 제외**로 뽑는다
function drawBoardWithoutJoker(deck: Card[]): Card[] {
  const b: Card[] = [];
  while (b.length < 5) {
    const c = draw(deck);
    if (c.isJoker) continue; // 버리고 다음으로
    b.push(c);
  }
  return b;
}

// 간단한 손 패 이름(서버 샘플용 – 실제 족보 계산기는 더 정교하게 교체 가능)
import { evaluate7 } from "./poker7"; // 없다면 간단 평가기 대체로 구현해도 됨(여기서는 7장 평가 모듈이 있다고 가정)

function handName(cards: Card[]): string {
  try {
    return evaluate7(cards); // "Straight Flush", "Four of a Kind", ...
  } catch {
    return "-";
  }
}

function broadcastState(room: Room, resetSelection = false, opSelected?: number) {
  const payload = {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    turn: room.turn,
    board: room.board,
    you: null as any,
    youName: "",
    opponentName: "",
    readyCount: room.ready.size,
    resetSelection,
    opSelected,
  };

  for (const seat of ["P1", "P2"] as Seat[]) {
    const sid = room.seats[seat];
    if (!sid) continue;
    const other: Seat = seat === "P1" ? "P2" : "P1";
    const toSend = {
      ...payload,
      you: room.hole[seat],
      youName: room.names[seat],
      opponentName: room.names[other],
    };
    io.to(sid).emit("game:state", toSend);
  }
}

function nextPhase(room: Room) {
  if (room.phase === "Dealing") room.phase = "Flop";
  else if (room.phase === "Flop") room.phase = "Turn";
  else if (room.phase === "Turn") room.phase = "River";
  io.to(room.id).emit("game:phase", { phase: room.phase, round: room.round, turn: room.turn });
}

function other(seat: Seat): Seat { return seat === "P1" ? "P2" : "P1"; }

// ====== 소켓 ======
io.on("connection", (sock) => {
  let nickname = `PLAYER${Math.random() < 0.5 ? 1 : 2}`;

  sock.on("home:hello", (p: any) => {
    if (p?.nickname) nickname = String(p.nickname).slice(0, 16);
    sock.emit("home:hello:ack", { nickname });
  });

  sock.on("match:quick", () => {
    if (!queue.includes(sock.id)) queue.push(sock.id);
    if (queue.length >= 2) {
      const a = queue.shift()!, b = queue.shift()!;
      const roomId = createRoom();
      const room = rooms.get(roomId)!;
      room.seats.P1 = a; room.seats.P2 = b;
      room.names.P1 = nickname;
      io.to(a).emit("match:paired", { role: "PLAYER1" });
      io.to(b).emit("match:paired", { role: "PLAYER2" });
      startRound(room);
      io.to(a).emit("match:started", { roomId, yourSeat: "P1", round: room.round });
      io.to(b).emit("match:started", { roomId, yourSeat: "P2", round: room.round });
    } else {
      sock.emit("match:queued", {});
    }
  });

  sock.on("room:create", () => {
    const id = createRoom();
    const r = rooms.get(id)!;
    r.seats.P1 = sock.id;
    r.names.P1 = nickname || "PLAYER1";
    sock.join(id);
    sock.emit("room:created", { roomId: id });
  });

  sock.on("room:join", (p: any) => {
    const id = (p?.roomId || "").toUpperCase();
    const r = rooms.get(id);
    if (!r) return sock.emit("room:join:error", { message: "Room not found" });
    if (r.seats.P2) return sock.emit("room:join:error", { message: "Room is full" });
    r.seats.P2 = sock.id; r.names.P2 = nickname || "PLAYER2";
    sock.join(id);
    startRound(r);
    io.to(r.seats.P1!).emit("match:started", { roomId: id, yourSeat: "P1", round: r.round });
    io.to(r.seats.P2!).emit("match:started", { roomId: id, yourSeat: "P2", round: r.round });
  });

  sock.on("game:ready", (p: any) => {
    const room = rooms.get(p?.roomId);
    if (!room) return;
    room.ready.add(sock.id);

    // 준비(Dealing) 단계: 2명 완료시 플랍 오픈 + 선 플레이어 랜덤
    if (room.phase === "Dealing" && room.ready.size === 2) {
      room.ready.clear();
      room.turn = Math.random() < 0.5 ? "P1" : "P2";
      nextPhase(room);
      broadcastState(room, true);
      return;
    }

    // 교환 단계: 요청자가 누구인지 좌석 판정
    const seat: Seat = room.seats.P1 === sock.id ? "P1" : "P2";
    if (seat !== room.turn) return; // 내 차례가 아니면 무시

    // keepIndexes 로 남길 카드 적용
    const keep: number[] = Array.isArray(p?.keepIndexes) ? p.keepIndexes : [0, 1];
    const newCards = room.hole[seat].map((c, idx) => (keep.includes(idx) ? c : draw(room.deck)));
    room.hole[seat] = newCards;

    // 턴을 상대에게 넘김
    room.turn = other(room.turn);
    broadcastState(room, false, 1); // 상대 쪽 카드 반짝 효과

    // 한 라운드의 교환 = 두 명 모두 1번씩 교환하면 다음 공개
    // ready set 로 체크
    room.ready.add(sock.id);
    if (room.ready.has(room.seats.P1!) && room.ready.has(room.seats.P2!)) {
      room.ready.clear();
      if (room.phase === "Flop") { room.phase = "Turn"; }
      else if (room.phase === "Turn") { room.phase = "River"; }
      else if (room.phase === "River") {
        // 쇼다운
        settle(room);
        return;
      }
      // 다음 공개 시작, 선 플레이어는 직전 후순
      room.turn = seat === "P1" ? "P1" : "P2"; // 직전 seat 이 후순이었다면 이번엔 그가 선이 되도록 서버 로직 맞춤
      nextPhase(room);
      broadcastState(room, true);
    }
  });

  sock.on("game:surrender", (p: any) => {
    const room = rooms.get(p?.roomId);
    if (!room) return;
    const seat: Seat = room.seats.P1 === sock.id ? "P1" : "P2";
    const winnerSeat: Seat = seat === "P1" ? "P2" : "P1";
    // 즉시 게임 종료
    io.to(room.id).emit("game:over", { winnerSeat, round: room.round });
    rooms.delete(room.id);
  });

  sock.on("disconnect", () => {
    // 방에서 정리
    for (const [id, r] of rooms) {
      if (r.seats.P1 === sock.id || r.seats.P2 === sock.id) {
        const winnerSeat: Seat = r.seats.P1 === sock.id ? "P2" : "P1";
        io.to(r.id).emit("game:over", { winnerSeat, round: r.round });
        rooms.delete(id);
        break;
      }
    }
    const idx = queue.indexOf(sock.id);
    if (idx >= 0) queue.splice(idx, 1);
  });
});

// ====== 라운드 시작/정산 ======
function createRoom(): string {
  const id = genCode();
  const room: Room = {
    id,
    seats: {},
    names: { P1: "PLAYER1", P2: "PLAYER2" },
    round: 1,
    phase: "Dealing",
    turn: "P1",
    deck: [],
    board: [],
    hole: { P1: [], P2: [] },
    ready: new Set(),
    lastStarter: "P1",
  };
  rooms.set(id, room);
  return id;
}

function startRound(room: Room) {
  room.phase = "Dealing";
  room.deck = makeDeck();
  room.board = drawBoardWithoutJoker(room.deck); // **조커 없는 보드**
  room.hole.P1 = drawHole(room.deck);
  room.hole.P2 = drawHole(room.deck);
  room.turn = Math.random() < 0.5 ? "P1" : "P2";
  io.to(room.id).emit("game:phase", { phase: room.phase, round: room.round, turn: room.turn });
  broadcastState(room, true);
}

function settle(room: Room) {
  const sevenP1 = [...room.hole.P1, ...room.board];
  const sevenP2 = [...room.hole.P2, ...room.board];
  const name1 = handName(sevenP1);
  const name2 = handName(sevenP2);

  // winner 계산 (여기서는 문자열 비교 대신 평가모듈에서 승패 결과도 함께 반환하는게 베스트)
  // 데모: 동률 처리
  let winnerSeat: Seat | "TIE" = "TIE";
  if (name1 !== name2) {
    // 평가기가 점수도 준다면 그 값을 비교하세요. 여기선 이름 우선순위 간단 처리(임시).
    const prio = ["High Card","Pair","Two Pair","Three of a Kind","Straight","Flush","Full House","Four of a Kind","Straight Flush","Royal Flush"];
    const s1 = prio.indexOf(name1); const s2 = prio.indexOf(name2);
    if (s1 > s2) winnerSeat = "P1"; else if (s2 > s1) winnerSeat = "P2";
  }

  for (const seat of ["P1","P2"] as Seat[]) {
    const sid = room.seats[seat];
    if (!sid) continue;
    io.to(sid).emit("game:result", {
      youHandName: seat === "P1" ? name1 : name2,
      oppHandName: seat === "P1" ? name2 : name1,
      winnerSeat,
      round: room.round,
    });
  }

  // 5초 뒤 러시안 룰렛(패자만)
  let loserSeat: Seat | null = null;
  if (winnerSeat !== "TIE") loserSeat = winnerSeat === "P1" ? "P2" : "P1";
  const bullets = Math.min(6, room.round); // 라운드마다 +1
  setTimeout(() => {
    io.to(room.id).emit("game:roulette", { bullets, loserSeat });
    // SAFE면 다음 라운드, BANG이면 종료는 클라/서버 협업 처리
  }, 5000);
}

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server on :${PORT}`));

// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/health", (req, res) => res.status(200).send("OK"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
    methods: ["GET", "POST"],
  },
});

// -------------------- 매칭/룸/게임 상태 --------------------
const waitingQueue = []; // {id, nick}
const rooms = new Map(); // roomId -> { players: [id1,id2], nicks: {id:nick}, state: RoomState }

function genCode(len = 6) {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => a[Math.floor(Math.random() * a.length)]).join("");
}
function removeFromQueue(id) {
  const i = waitingQueue.findIndex((w) => w.id === id);
  if (i >= 0) waitingQueue.splice(i, 1);
}

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function newDeck(){
  const d=[];
  for(const s of SUITS) for(const r of RANKS) d.push({rank:r,suit:s});
  d.push({joker:true}); d.push({joker:true});
  return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function drawNonJoker(state){
  let c = state.deck.shift();
  while(c && c.joker){
    // 조커는 공유카드로 안 나가게 덱 뒤로 보내고 다시 셔플
    state.deck.push({joker:true});
    shuffle(state.deck);
    c = state.deck.shift();
  }
  return c;
}

function createInitialState(room){
  const deck = shuffle(newDeck());
  const [p1, p2] = room.players;
  const hands = {
    [p1]: [ deck.shift(), deck.shift() ],
    [p2]: [ deck.shift(), deck.shift() ],
  };
  const community = [{back:true},{back:true},{back:true},{back:true},{back:true}];
  return {
    round: 1,
    deck,
    hands,
    community,
    phase: "deal", // deal -> flop-exchange -> turn-exchange -> river -> showdown
    phaseLabel: "Dealing",
    turn: p1,                   // 교환 페이즈에서만 의미
    allowReady: { [p1]: true, [p2]: true },
    ready: { [p1]: false, [p2]: false },
    exchangeLeft: { [p1]: 2, [p2]: 2 }, // 한 라운드 2장 제한(예시)
    players: [p1, p2],
  };
}

function broadcastState(roomId){
  const room = rooms.get(roomId);
  if(!room) return;
  io.to(roomId).emit("game:state", room.state);
}

function setPhase(roomId, phase){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;
  S.phase = phase;
  if(phase==="deal") S.phaseLabel = "Dealing";
  if(phase==="flop-exchange") S.phaseLabel = "Flop (Exchange)";
  if(phase==="turn-exchange") S.phaseLabel = "Turn (Exchange)";
  if(phase==="river") S.phaseLabel = "River";
  if(phase==="showdown") S.phaseLabel = "Showdown";
  // Ready 플래그 초기화
  for(const pid of S.players){ S.ready[pid]=false; S.allowReady[pid]=true; }
}

function progressPhase(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;

  switch(S.phase){
    case "deal": {
      // 공개 3장
      S.community[0] = drawNonJoker(S);
      S.community[1] = drawNonJoker(S);
      S.community[2] = drawNonJoker(S);
      setPhase(roomId, "flop-exchange");
      break;
    }
    case "flop-exchange": {
      // 공개 4번째
      S.community[3] = drawNonJoker(S);
      setPhase(roomId, "turn-exchange");
      break;
    }
    case "turn-exchange": {
      // 공개 5번째
      S.community[4] = drawNonJoker(S);
      setPhase(roomId, "river");
      break;
    }
    case "river": {
      setPhase(roomId, "showdown");
      break;
    }
    case "showdown": {
      // 다음 라운드(단순 리셋)
      const next = createInitialState(room);
      room.state = next;
      break;
    }
  }
  broadcastState(roomId);
}

function maybeAdvanceWhenAllReady(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;
  const all = S.players.every(pid => S.ready[pid]);
  if(!all) return;

  // 모든 플레이어 준비 -> 다음 단계
  progressPhase(roomId);
}

function startRoomGame(roomId){
  const room = rooms.get(roomId);
  if(!room || room.players.length<2) return;
  // 소켓들을 룸에 조인 (퀵매치 대비)
  for(const pid of room.players){
    const s = io.sockets.sockets.get(pid);
    if(s) s.join(roomId);
  }
  // 상태 생성 및 브로드캐스트
  room.state = createInitialState(room);
  broadcastState(roomId);
}

// -------------------- 소켓 핸들러 --------------------
io.on("connection", (socket) => {
  // 퀵매치
  socket.on("qm:join", ({ nick }) => {
    removeFromQueue(socket.id);
    waitingQueue.push({ id: socket.id, nick: nick || "PLAYER" });

    if (waitingQueue.length >= 2) {
      const a = waitingQueue.shift();
      const b = waitingQueue.shift();
      const roomId = genCode();
      rooms.set(roomId, {
        players: [a.id, b.id],
        nicks: { [a.id]: a.nick, [b.id]: b.nick },
      });
      // 두 소켓을 룸에 조인시키고 시작
      const as = io.sockets.sockets.get(a.id);
      const bs = io.sockets.sockets.get(b.id);
      as?.join(roomId);
      bs?.join(roomId);

      io.to(a.id).emit("qm:found", { roomId, opponentNick: b.nick, youNick: a.nick });
      io.to(b.id).emit("qm:found", { roomId, opponentNick: a.nick, youNick: b.nick });

      startRoomGame(roomId);
    } else {
      socket.emit("qm:queued");
    }
  });

  socket.on("qm:leave", () => removeFromQueue(socket.id));

  // Create / Join Room
  socket.on("room:create", ({ nick }) => {
    const roomId = genCode();
    rooms.set(roomId, { players: [socket.id], nicks: { [socket.id]: nick || "PLAYER" } });
    socket.join(roomId);
    socket.emit("room:created", { roomId });
  });

  socket.on("room:join", ({ roomId, nick }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length >= 2) {
      socket.emit("room:error", { message: "Invalid or full room." });
      return;
    }
    room.players.push(socket.id);
    room.nicks[socket.id] = nick || "PLAYER";
    socket.join(roomId);

    const [a, b] = room.players;
    const aNick = room.nicks[a];
    const bNick = room.nicks[b];
    io.to(a).emit("room:ready", { roomId, opponentNick: bNick, youNick: aNick });
    io.to(b).emit("room:ready", { roomId, opponentNick: aNick, youNick: bNick });

    startRoomGame(roomId);
  });

  // 유저가 명시적으로 나가기
  socket.on("leaveRoom", ({ roomId })=>{
    const room = rooms.get(roomId);
    if(!room) return;
    room.players = room.players.filter(id => id !== socket.id);
    delete room.nicks[socket.id];
    socket.leave(roomId);
    const left = room.players[0];
    if (!left) rooms.delete(roomId);
    else io.to(left).emit("room:peer-left");
  });

  // 플레이어 준비(=페이즈 진행 동의)
  socket.on("player:ready", ({ roomId })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    if(!(socket.id in S.ready)) return;
    if(!S.allowReady[socket.id]) return;

    S.ready[socket.id] = true;
    broadcastState(roomId);
    maybeAdvanceWhenAllReady(roomId);
  });

  // 교환 요청 (교환 허용 단계에서만)
  socket.on("exchange:request", ({ roomId, indices })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    const pid = socket.id;
    if(!S.players.includes(pid)) return;

    const canExchange = (S.phase==="flop-exchange" || S.phase==="turn-exchange");
    if(!canExchange) return;

    const hand = S.hands[pid] || [];
    const allowed = S.exchangeLeft[pid] || 0;
    if(!Array.isArray(indices)) return;

    // 최대 교환 가능 수 검증
    const unique = Array.from(new Set(indices.map(i=>Number(i)))).filter(i=> i>=0 && i<hand.length);
    const take = unique.slice(0, Math.max(0, Math.min(allowed, 2)));

    // 교환(플레이어 패는 조커 허용)
    for(const idx of take){
      hand[idx] = S.deck.shift();
    }
    S.exchangeLeft[pid] = Math.max(0, allowed - take.length);

    broadcastState(roomId);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    for (const [rid, r] of rooms.entries()) {
      if (r.players.includes(socket.id)) {
        r.players = r.players.filter((id) => id !== socket.id);
        delete r.nicks[socket.id];
        const left = r.players[0];
        if (!left) rooms.delete(rid);
        else io.to(left).emit("room:peer-left");
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

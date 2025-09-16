import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
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
const rooms = new Map(); // roomId -> { players:[id1,id2], nicks:{id:nick}, state }

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
    state.deck.push({joker:true});
    shuffle(state.deck);
    c = state.deck.shift();
  }
  return c;
}

function randOf(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function createInitialState(room){
  const deck = shuffle(newDeck());
  const [p1, p2] = room.players;
  const hands = {
    [p1]: [ deck.shift(), deck.shift() ],
    [p2]: [ deck.shift(), deck.shift() ],
  };
  const community = [{back:true},{back:true},{back:true},{back:true},{back:true}];
  const players = [p1,p2];
  const S = {
    round: 1,
    deck,
    hands,
    community,
    phase: "deal",                 // deal -> flop-exchange -> turn-exchange -> river -> showdown
    phaseLabel: "Dealing",
    turn: p1,                      // 교환 페이즈에서만 사용
    players,
    // ready는 비교환 페이즈에서만 사용
    ready: Object.fromEntries(players.map(pid=>[pid,false])),
    allowReady: Object.fromEntries(players.map(pid=>[pid,true])),
    // 교환(턴 기반)
    exchangeLeft: Object.fromEntries(players.map(pid=>[pid,2])),
    acted: Object.fromEntries(players.map(pid=>[pid,false])),   // 이번 교환 페이즈에서 행동했는가
    canExchange: Object.fromEntries(players.map(pid=>[pid,false])),
  };
  return S;
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

  // 공통 초기화
  for(const pid of S.players){
    S.ready[pid] = false;
    S.allowReady[pid] = true;
  }

  // 교환 페이즈 진입 시: 턴/행동 가능 여부 설정
  if(phase==="flop-exchange" || phase==="turn-exchange"){
    for(const pid of S.players){ S.acted[pid] = false; }
    S.turn = randOf(S.players);                    // 무작위로 턴 부여
    for(const pid of S.players){ S.canExchange[pid] = (pid === S.turn); }
  }else{
    // 교환 외 페이즈에선 교환 금지
    for(const pid of S.players){ S.canExchange[pid] = false; }
  }
}

function progressPhase(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;

  switch(S.phase){
    case "deal": {
      S.community[0] = drawNonJoker(S);
      S.community[1] = drawNonJoker(S);
      S.community[2] = drawNonJoker(S);
      setPhase(roomId, "flop-exchange");
      break;
    }
    case "flop-exchange": {
      S.community[3] = drawNonJoker(S);
      setPhase(roomId, "turn-exchange");
      break;
    }
    case "turn-exchange": {
      S.community[4] = drawNonJoker(S);
      setPhase(roomId, "river");
      break;
    }
    case "river": {
      setPhase(roomId, "showdown");
      break;
    }
    case "showdown": {
      // 다음 라운드 시작
      room.state = createInitialState(room);
      break;
    }
  }
  broadcastState(roomId);
}

// 비교환 페이즈에서만 Ready 동의로 진전
function maybeAdvanceWhenAllReady(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;
  if(S.phase==="flop-exchange" || S.phase==="turn-exchange") return;
  const all = S.players.every(pid => S.ready[pid]);
  if(!all) return;
  progressPhase(roomId);
}

function startRoomGame(roomId){
  const room = rooms.get(roomId);
  if(!room || room.players.length<2) return;
  for(const pid of room.players){
    io.sockets.sockets.get(pid)?.join(roomId);
  }
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

      io.sockets.sockets.get(a.id)?.join(roomId);
      io.sockets.sockets.get(b.id)?.join(roomId);

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

  // 명시적 나가기
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

  // 비교환 페이즈에서 Ready (양측 합의)
  socket.on("player:ready", ({ roomId })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    if(S.phase==="flop-exchange" || S.phase==="turn-exchange") return; // 교환 페이즈에선 무시 (턴 기반)
    if(!(socket.id in S.ready)) return;
    if(!S.allowReady[socket.id]) return;
    S.ready[socket.id] = true;
    broadcastState(roomId);
    maybeAdvanceWhenAllReady(roomId);
  });

  // 교환 요청 (턴 플레이어만, 0~2장)
  socket.on("exchange:request", ({ roomId, indices })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    const pid = socket.id;
    if(!S.players.includes(pid)) return;
    const exchangePhase = (S.phase==="flop-exchange" || S.phase==="turn-exchange");
    if(!exchangePhase) return;

    // 턴이 아니면 거부
    if(S.turn !== pid || S.acted[pid]) return;

    const hand = S.hands[pid] || [];
    const allowed = Math.max(0, Math.min(2, S.exchangeLeft[pid] || 0));
    const arr = Array.isArray(indices) ? indices : [];
    const unique = Array.from(new Set(arr.map(i=>Number(i)))).filter(i=> i>=0 && i<hand.length);
    const take = unique.slice(0, allowed);

    for(const idx of take){
      hand[idx] = S.deck.shift(); // 플레이어 패에는 조커 허용
    }
    S.exchangeLeft[pid] = Math.max(0, (S.exchangeLeft[pid]||0) - take.length);

    // 이 플레이어는 이번 페이즈 행동 완료
    S.acted[pid] = true;

    // 턴 전환 or 다음 페이즈
    const other = S.players.find(x=>x!==pid);
    if(S.acted[other]){
      // 두 명 모두 행동 완료 → 다음 페이즈
      progressPhase(roomId);
      return;
    }else{
      S.turn = other;
      for(const p of S.players){ S.canExchange[p] = (p===S.turn); }
      broadcastState(roomId);
    }
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

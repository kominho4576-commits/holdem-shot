// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

/** CORS: Netlify/Vercel/Pages/Local 허용 */
const ORIGINS = [
  "https://holdemshot.netlify.app",
  /.*\.netlify\.app$/,
  "https://holdem-shot.vercel.app",
  /.*\.vercel\.app$/,
  "https://holdemshot.pages.dev",
  /.*\.pages\.dev$/,
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

app.use(
  cors({
    origin: ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/health", (_req, res) => res.status(200).send("OK"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ORIGINS, methods: ["GET", "POST"] },
});

/* -------------------- 매칭/룸 -------------------- */
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

/* -------------------- 카드/덱/유틸 -------------------- */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i)=>[r, i+2])); // 2..14

function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  d.push({ joker: true }); d.push({ joker: true }); // 조커 2장
  return d;
}
function shuffle(a) { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function drawNonJoker(state){
  let c = state.deck.shift();
  while (c && c.joker) { state.deck.push({ joker:true }); shuffle(state.deck); c = state.deck.shift(); }
  return c;
}
const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uniqKey = (c)=> c.joker ? "J" : `${c.rank}${c.suit}`;

/* -------------------- 족보 평가(조커 와일드) -------------------- */
function eval5(cards) {
  const ranks = cards.map(c=>RANK_VAL[c.rank]).sort((a,b)=>b-a);
  const suits = cards.map(c=>c.suit);
  const bySuit = new Map(); suits.forEach((s,i)=>{ if(!bySuit.has(s)) bySuit.set(s,[]); bySuit.get(s).push(ranks[i]); });
  const counts = new Map(); ranks.forEach(v=>counts.set(v,(counts.get(v)||0)+1));
  const groups = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);

  const isFlush = [...bySuit.values()].some(arr=>arr.length===5);
  const rset = [...new Set(ranks)];
  let isStraight=false, straightHigh=0;
  for(let i=0;i<=rset.length-1;i++){
    const seq=[rset[i]];
    for(let j=i+1;j<rset.length && seq.length<5;j++){
      if(rset[j]===seq[seq.length-1]-1) seq.push(rset[j]);
      else if(rset[j]!==seq[seq.length-1]) break;
    }
    if(seq.length>=5){ isStraight=true; straightHigh=seq[0]; break; }
  }
  if(!isStraight && rset.includes(14) && [2,3,4,5].every(v=>rset.includes(v))){ isStraight=true; straightHigh=5; }

  if(isFlush){
    for(const [s, arr] of bySuit.entries()){
      const u = [...new Set(arr)].sort((a,b)=>b-a);
      let found=false, hi=0;
      for(let i=0;i<u.length;i++){
        let seq=[u[i]];
        for(let j=i+1;j<u.length && seq.length<5;j++){
          if(u[j]===seq[seq.length-1]-1) seq.push(u[j]); else if(u[j]!==seq[seq.length-1]) break;
        }
        if(seq.length>=5){ found=true; hi=seq[0]; break; }
      }
      if(!found && u.includes(14) && [2,3,4,5].every(v=>u.includes(v))){ found=true; hi=5; }
      if(found) return {score:[9,hi], name: (hi===14? "Royal Flush":"Straight Flush")};
    }
  }

  if(groups[0][1]===4){
    const four=groups[0][0], kicker=groups.find(g=>g[0]!==four)[0];
    return {score:[8,four,kicker], name:"Four of a Kind"};
  }
  if(groups[0][1]===3 && (groups[1]?.[1]||0)>=2){
    return {score:[7,groups[0][0],groups[1][0]], name:"Full House"};
  }
  if(isFlush){
    const arr = [...bySuit.values()].find(a=>a.length===5).sort((a,b)=>b-a);
    return {score:[6,...arr], name:"Flush"};
  }
  if(isStraight) return {score:[5,straightHigh], name:"Straight"};
  if(groups[0][1]===3){
    const kick = ranks.filter(v=>v!==groups[0][0]).slice(0,2);
    return {score:[4,groups[0][0],...kick], name:"Three of a Kind"};
  }
  if(groups[0][1]===2 && groups[1]?.[1]===2){
    const pair1=groups[0][0], pair2=groups[1][0];
    const kick = ranks.filter(v=>v!==pair1 && v!==pair2)[0];
    const hi=Math.max(pair1,pair2), lo=Math.min(pair1,pair2);
    return {score:[3,hi,lo,kick], name:"Two Pair"};
  }
  if(groups[0][1]===2){
    const pair=groups[0][0];
    const kick = ranks.filter(v=>v!==pair).slice(0,3);
    return {score:[2,pair,...kick], name:"One Pair"};
  }
  return {score:[1,...ranks], name:"High Card"};
}
function bestHand7(cards7) {
  const base = cards7.filter(c=>!c.joker);
  const jokers = cards7.length - base.length;

  const all = [];
  for(const s of SUITS) for(const r of RANKS) all.push({rank:r,suit:s});
  const used = new Set(base.map(uniqKey));
  const pool = all.filter(c=>!used.has(uniqKey(c)));

  function bestOf(arr7){
    let best=null;
    for(let a=0;a<7;a++) for(let b=a+1;b<7;b++){
      const pick=[]; for(let i=0;i<7;i++) if(i!==a && i!==b) pick.push(arr7[i]);
      const e = eval5(pick);
      if(!best || compareScore(e.score,best.score)>0) best=e;
    }
    return best;
  }
  function compareScore(a,b){
    const n=Math.max(a.length,b.length);
    for(let i=0;i<n;i++){ const ai=a[i]||0, bi=b[i]||0; if(ai!==bi) return ai-bi; }
    return 0;
  }

  if(jokers===0) return bestOf(base);
  if(jokers===1){
    let best=null;
    for(const sub of pool){
      const e = bestOf([...base, sub]);
      if(!best || compareScore(e.score,best.score)>0) best=e;
    }
    return best;
  }
  let best=null;
  for(let i=0;i<pool.length;i++){
    for(let j=i+1;j<pool.length;j++){
      const e = bestOf([...base, pool[i], pool[j]]);
      if(!best || compareScore(e.score,best.score)>0) best=e;
    }
  }
  return best;
}

/* -------------------- 상태 생성/전환 -------------------- */
function createStateForRound(room, roundNo){
  const deck = shuffle(newDeck());
  const [p1, p2] = room.players;
  const hands = { [p1]: [deck.shift(), deck.shift()], [p2]: [deck.shift(), deck.shift()] };
  const community = [{back:true},{back:true},{back:true},{back:true},{back:true}];
  const players = [p1,p2];

  const S = {
    round: roundNo,
    deck, hands, community,
    // deal → flop-exchange → turn-exchange → river-exchange → showdown
    phase: "deal",
    phaseLabel: "Dealing",
    players,
    turn: p1,
    acted: Object.fromEntries(players.map(pid=>[pid,false])),
    canExchange: Object.fromEntries(players.map(pid=>[pid,false])),
    phaseExchangeLeft: Object.fromEntries(players.map(pid=>[pid,2])),
    ready: Object.fromEntries(players.map(pid=>[pid,false])),
    allowReady: Object.fromEntries(players.map(pid=>[pid,true])),
  };
  return S;
}

function broadcastState(roomId){
  const room = rooms.get(roomId); if(!room) return;
  io.to(roomId).emit("game:state", room.state);
}
function setPhase(roomId, phase){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;
  S.phase = phase;
  if(phase==="deal")            S.phaseLabel="Dealing";
  if(phase==="flop-exchange")   S.phaseLabel="Flop (Exchange)";
  if(phase==="turn-exchange")   S.phaseLabel="Turn (Exchange)";
  if(phase==="river-exchange")  S.phaseLabel="River (Final Exchange)";
  if(phase==="showdown")        S.phaseLabel="Showdown";

  for(const pid of S.players){ S.ready[pid]=false; S.allowReady[pid]=true; }

  const isEx = ["flop-exchange","turn-exchange","river-exchange"].includes(phase);
  if(isEx){
    for(const pid of S.players){ S.acted[pid]=false; S.phaseExchangeLeft[pid]=2; }
    S.turn = S.players[Math.floor(Math.random()*S.players.length)];
    for(const pid of S.players) S.canExchange[pid] = (pid===S.turn);
  }else{
    for(const pid of S.players) S.canExchange[pid] = false;
  }
}
function progressPhase(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;

  switch(S.phase){
    case "deal": {
      S.community[0]=drawNonJoker(S);
      S.community[1]=drawNonJoker(S);
      S.community[2]=drawNonJoker(S);
      setPhase(roomId,"flop-exchange");
      break;
    }
    case "flop-exchange": {
      S.community[3]=drawNonJoker(S);
      setPhase(roomId,"turn-exchange");
      break;
    }
    case "turn-exchange": {
      S.community[4]=drawNonJoker(S);
      setPhase(roomId,"river-exchange");
      break;
    }
    case "river-exchange": {
      setPhase(roomId,"showdown");
      break;
    }
    case "showdown": { break; }
  }
  broadcastState(roomId);
}

function startRoomGame(roomId){
  const room = rooms.get(roomId);
  if(!room || room.players.length<2) return;
  for(const pid of room.players){ io.sockets.sockets.get(pid)?.join(roomId); }
  room.state = createStateForRound(room, 1);
  broadcastState(roomId);
  setTimeout(()=>progressPhase(roomId), 600);
}

/* -------------------- 쇼다운/룰렛 -------------------- */
function showdownAndRoulette(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const S = room.state;
  const [a,b] = S.players;
  const a7 = [...S.hands[a], ...S.community.filter(c=>!c.back)];
  const b7 = [...S.hands[b], ...S.community.filter(c=>!c.back)];

  const Ea = bestHand7(a7);
  const Eb = bestHand7(b7);

  function cmp(x,y){
    const n=Math.max(x.score.length,y.score.length);
    for(let i=0;i<n;i++){ const xi=x.score[i]||0, yi=y.score[i]||0; if(xi!==yi) return xi-yi; }
    return 0;
  }
  const diff = cmp(Ea,Eb);
  let winner=null, loser=null, tie=false;
  if(diff>0){ winner=a; loser=b; }
  else if(diff<0){ winner=b; loser=a; }
  else { tie=true; }

  io.to(roomId).emit("round:result", {
    roomId, round:S.round, tie,
    winner, loser,
    winnerName: winner? rooms.get(roomId).nicks[winner] : null,
    loserName:  loser? rooms.get(roomId).nicks[loser]  : null,
    eval: { a: Ea, b: Eb }
  });

  if(tie){ setTimeout(()=>nextRound(roomId), 2000); return; }

  const HOLES = 6;
  const bulletsCount = Math.min(6, S.round);
  const allIdx = [0,1,2,3,4,5];
  shuffle(allIdx);
  const bullets = allIdx.slice(0, bulletsCount).sort((x,y)=>x-y);
  const selected = Math.floor(Math.random()*HOLES);
  const fired = bullets.includes(selected);

  io.to(roomId).emit("roulette:spin", { roomId, round:S.round, loser, holes: HOLES, bullets, selected, fired });
  setTimeout(()=>nextRound(roomId), 3000);
}
function nextRound(roomId){
  const room = rooms.get(roomId); if(!room) return;
  const cur = room.state?.round || 1;
  room.state = createStateForRound(room, cur+1);
  broadcastState(roomId);
  setTimeout(()=>progressPhase(roomId), 600);
}

/* -------------------- 소켓 핸들러 -------------------- */
io.on("connection", (socket) => {
  // 퀵매치
  socket.on("qm:join", ({ nick }) => {
    removeFromQueue(socket.id);
    waitingQueue.push({ id: socket.id, nick: nick || "PLAYER" });
    if (waitingQueue.length >= 2) {
      const a = waitingQueue.shift();
      const b = waitingQueue.shift();
      const roomId = genCode();
      rooms.set(roomId, { players:[a.id,b.id], nicks: { [a.id]:a.nick, [b.id]:b.nick }});
      io.sockets.sockets.get(a.id)?.join(roomId);
      io.sockets.sockets.get(b.id)?.join(roomId);
      io.to(a.id).emit("qm:found", { roomId, opponentNick: b.nick, youNick:a.nick });
      io.to(b.id).emit("qm:found", { roomId, opponentNick: a.nick, youNick:b.nick });
      startRoomGame(roomId);
    } else {
      socket.emit("qm:queued");
    }
  });

  socket.on("qm:leave", () => removeFromQueue(socket.id));

  // Create / Join
  socket.on("room:create", ({ nick }) => {
    const roomId = genCode();
    rooms.set(roomId, { players:[socket.id], nicks: { [socket.id]: nick || "PLAYER" }});
    socket.join(roomId);
    socket.emit("room:created", { roomId });
  });

  socket.on("room:join", ({ roomId, nick }) => {
    const room = rooms.get(roomId);
    if(!room || room.players.length>=2){
      socket.emit("room:error",{message:"Invalid or full room."});
      return;
    }
    room.players.push(socket.id);
    room.nicks[socket.id] = nick || "PLAYER";
    socket.join(roomId);

    const [a,b] = room.players;
    io.to(a).emit("room:ready", { roomId, opponentNick: room.nicks[b], youNick: room.nicks[a] });
    io.to(b).emit("room:ready", { roomId, opponentNick: room.nicks[a], youNick: room.nicks[b] });
    startRoomGame(roomId);
  });

  socket.on("leaveRoom", ({ roomId })=>{
    const room = rooms.get(roomId); if(!room) return;
    room.players = room.players.filter(id=>id!==socket.id);
    delete room.nicks[socket.id];
    socket.leave(roomId);
    const left = room.players[0];
    if(!left) rooms.delete(roomId);
    else io.to(left).emit("room:peer-left");
  });

  // Ready 카운터(정보용)
  socket.on("player:ready", ({ roomId })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    if(!S.players.includes(socket.id)) return;
    if(!(socket.id in S.ready)) return;
    if(S.ready[socket.id]) return;
    S.ready[socket.id] = true;
    broadcastState(roomId);
  });

  // 교환(턴 기반, 페이즈당 1회, 최대 2장)
  socket.on("exchange:request", ({ roomId, indices })=>{
    const room = rooms.get(roomId); if(!room || !room.state) return;
    const S = room.state;
    const pid = socket.id;
    if(!S.players.includes(pid)) return;
    const exPhase = ["flop-exchange","turn-exchange","river-exchange"].includes(S.phase);
    if(!exPhase) return;
    if(S.turn !== pid || S.acted[pid]) return;

    const hand = S.hands[pid];
    const allowed = Math.max(0, Math.min(2, S.phaseExchangeLeft[pid]||0));
    const arr = Array.isArray(indices) ? indices : [];
    const unique = Array.from(new Set(arr.map(n=>Number(n)))).filter(i=> i>=0 && i<hand.length);
    const take = unique.slice(0, allowed);

    for(const idx of take){ hand[idx] = S.deck.shift(); }
    S.phaseExchangeLeft[pid] = Math.max(0, (S.phaseExchangeLeft[pid]||0) - take.length);

    S.acted[pid] = true;

    const other = S.players.find(x=>x!==pid);
    if(S.acted[other]){
      progressPhase(roomId);
      if(S.phase==="showdown"){
        setTimeout(()=>showdownAndRoulette(roomId), 150);
      }
    }else{
      S.turn = other;
      for(const p of S.players) S.canExchange[p] = (p===S.turn);
      broadcastState(roomId);
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    for (const [rid, r] of rooms.entries()) {
      if (r.players.includes(socket.id)) {
        r.players = r.players.filter(id=>id!==socket.id);
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

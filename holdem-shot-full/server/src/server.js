// Hold'em & Shot – Server
// Node + Express + Socket.IO
// - Matchmaking (Quick/Room)
// - 1v1 Game engine (Texas Hold'em variant + Joker rule)
// - Russian Roulette after each round (loser only, skip/add via Joker)
// - AI fallback if matchmaking fails within 8s or server set offline
// - All text intended for clients in English (nickname alone is user text)

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'

// ---------------------- Setup ----------------------
const app = express()
app.use(express.json())

// 허용할 도메인 배열
const allowedOrigins = [
  "https://holdem-shot.vercel.app", // Vercel 프론트엔드
  "http://localhost:5173"           // 로컬 개발용
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // 모바일 앱/테스트 환경에서 origin 없을 수 있음
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed"), false);
  }
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});


app.get('/health', (_req, res) =>
  res.json({ ok: true, time: Date.now(), origin: ORIGIN })
)

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: ORIGIN } })

// ---------------------- Utilities ----------------------
const randInt = (n) => Math.floor(Math.random() * n)
const sample = (arr) => arr[randInt(arr.length)]
const now = () => Date.now()

const BOT_NAMES = [
  'Maverick', 'Viper', 'Nexus', 'Kappa', 'Atlas', 'Nova', 'Echo',
  'Quark', 'Orion', 'Pixel', 'Zephyr', 'Comet', 'Delta', 'Juno'
]

// 52 + 2 jokers: ranks A..K, suits ♠ ♥ ♦ ♣ (S,H,D,C)
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
const SUITS = ['S','H','D','C']
const makeDeck = () => {
  const deck = []
  for (const r of RANKS) for (const s of SUITS) deck.push(r+s)
  deck.push('JK1') // Joker #1
  deck.push('JK2') // Joker #2
  return shuffle(deck)
}
const shuffle = (a) => {
  for (let i=a.length-1;i>0;i--) { const j = randInt(i+1); [a[i],a[j]]=[a[j],a[i]] }
  return a
}
const isJoker = (c) => c.startsWith('JK')
const cardRank = (c) => RANKS.indexOf(c[0]) // 0 is highest(A), 12 lowest(2)
const cardSuit = (c) => c[1]

// Poker evaluator (7-card best). Jokers count as *best-rank* wilds but only
// when they are in a player's private hand (per rule: “보유한 경우”) not in board.
// Simplified but solid ranking: returns {score, name, primaryRanks[]}
// Higher score wins; tie broken by primaryRanks lexicographically.
function evaluate7(private2, board5) {
  const privNoJoker = private2.filter(c=>!isJoker(c))
  const hasJoker = private2.length !== privNoJoker.length
  // If joker owned, we try upgrading hand by duplicating the best needed rank.
  // For simplicity we try all ranks as substitution targets and take the best.
  const candidates = [privNoJoker]
  if (hasJoker) {
    for (const r of RANKS) {
      // simulate joker as rS (suit chosen later within evaluator as needed)
      candidates.push([...privNoJoker, r+'S']) // suit won’t matter except flush; we try 4 suits later
      candidates.push([...privNoJoker, r+'H'])
      candidates.push([...privNoJoker, r+'D'])
      candidates.push([...privNoJoker, r+'C'])
    }
  }
  let best = null
  for (const priv of candidates) {
    const seven = [...priv, ...board5]
    const res = eval7NoJoker(seven)
    if (!best || cmpRank(res, best) > 0) best = res
  }
  best.hasPrivateJoker = hasJoker
  return best
}

// Core evaluator without jokers. Credit: hand logic written for this project.
// Detects Straight Flush/Royal, Four, Full House, Flush, Straight, Trips, Two Pair, Pair, High.
function eval7NoJoker(cards) {
  // ranksHi: 12..0 (2..A) reversed vs our index; we’ll map to 12-low for ease
  const ranksCount = new Array(13).fill(0)
  const suitMap = { S:[], H:[], D:[], C:[] }
  for (const c of cards) {
    const r = cardRank(c); if (r<0) continue
    ranksCount[r]++
    suitMap[cardSuit(c)].push(r)
  }

  // helpers
  const sortedRanksDesc = () => {
    const list=[]
    for (let r=0;r<13;r++) for(let k=0;k<ranksCount[r];k++) list.push(r)
    return list.sort((a,b)=>a-b) // 0(A) .. 12(2) -> ascending by index (A high)
  }
  const straightOf = (ranksArr) => {
    // ranksArr: numeric indices 0..12 (A..2); treat A-low straight too (A,5,4,3,2)
    const set = new Set(ranksArr)
    // A-high
    for (let a=0;a<=8;a++) {
      // a..a+4 should be consecutive
      let ok=true
      for (let k=0;k<5;k++) if (!set.has(a+k)) { ok=false; break }
      if (ok) return a+4 // return high rank index
    }
    // A-low (A,5,4,3,2) -> ranks indices {0,8,9,10,11}? Wait our indices: 0:A 12:2
    // A-low straight high treated as 5 (index of '5' is RANKS.indexOf('5')=8)
    const five = RANKS.indexOf('5')
    const four = RANKS.indexOf('4')
    const three = RANKS.indexOf('3')
    const two = RANKS.indexOf('2')
    if (set.has(0) && set.has(five) && set.has(four) && set.has(three) && set.has(two)) return five
    return null
  }

  // Flush?
  let flushSuit = null, flushRanks = null
  for (const s of SUITS) {
    if (suitMap[s].length>=5) { flushSuit = s; flushRanks = suitMap[s].slice().sort((a,b)=>a-b); break }
  }
  // Straight Flush?
  if (flushSuit) {
    const hi = straightOf(flushRanks)
    if (hi!==null) {
      const royal = (hi===RANKS.indexOf('A')) // A-high straight (A K Q J T)
      return { score: royal?900:800, name: royal?'Royal Flush':'Straight Flush', primary:[hi] }
    }
  }

  // Four / Full house / Trips / Pairs
  const groups = {}
  for (let r=0;r<13;r++) if (ranksCount[r]) (groups[ranksCount[r]] ??= []).push(r)
  for (const k of Object.keys(groups)) groups[k].sort((a,b)=>a-b) // high first (A is 0 so smaller index)

  if (groups[4]?.length) {
    const four = groups[4][0]
    const kicker = (sortedRanksDesc().filter(x=>x!==four)).at(-1)
    return { score:700, name:'Four of a Kind', primary:[four, kicker] }
  }

  if ( (groups[3]?.length) && ((groups[2]?.length) || (groups[3]?.length>1)) ) {
    const trips = groups[3][0]
    const pair = (groups[3].length>1) ? groups[3][1] : groups[2][0]
    return { score:600, name:'Full House', primary:[trips, pair] }
  }

  if (flushSuit) {
    // top five flush ranks
    const top5 = flushRanks.slice(-5)
    return { score:500, name:'Flush', primary:top5 }
  }

  const straightHi = straightOf(sortedRanksDesc())
  if (straightHi!==null) return { score:400, name:'Straight', primary:[straightHi] }

  if (groups[3]?.length) {
    const trips = groups[3][0]
    const kickers = (sortedRanksDesc().filter(x=>x!==trips)).slice(-2)
    return { score:300, name:'Three of a Kind', primary:[trips, ...kickers] }
  }

  if (groups[2]?.length>=2) {
    const [p1,p2] = groups[2].slice(-2) // top two pairs
    const kicker = (sortedRanksDesc().filter(x=>x!==p1 && x!==p2)).at(-1)
    return { score:200, name:'Two Pair', primary:[p1,p2,kicker] }
  }

  if (groups[2]?.length===1) {
    const p = groups[2][0]
    const kickers = (sortedRanksDesc().filter(x=>x!==p)).slice(-3)
    return { score:100, name:'One Pair', primary:[p, ...kickers] }
  }

  // High card
  const hi5 = sortedRanksDesc().slice(-5)
  return { score:50, name:'High Card', primary:hi5 }
}
function cmpRank(a,b){
  if (a.score!==b.score) return a.score-b.score
  const len=Math.max(a.primary.length,b.primary.length)
  for (let i=0;i<len;i++){
    const av=a.primary[i]??-1, bv=b.primary[i]??-1
    if (av!==bv) return av-bv
  }
  return 0
}

// ---------------------- Matchmaking & Rooms ----------------------
const queue = new Set() // sockets waiting for quick match
const rooms = new Map() // roomId -> RoomState

function makeRoomId(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s=''
  for(let i=0;i<6;i++) s+=chars[randInt(chars.length)]
  return rooms.has(s) ? makeRoomId() : s
}

function botName() { return sample(BOT_NAMES) }

function cleanSocketFromQueue(socket){
  queue.delete(socket.id)
}

function broadcast(roomId, ev, payload){
  io.to(roomId).emit(ev, payload)
}

// ---------------------- Game State Model ----------------------
function newGameState(p1, p2) {
  return {
    createdAt: now(),
    players: {
      [p1]: { id:p1, nickname:'PLAYER1', hearts:1, private:[], hasJoker:false, ready:false, exchangeIdxs:[] },
      [p2]: { id:p2, nickname:'PLAYER2', hearts:1, private:[], hasJoker:false, ready:false, exchangeIdxs:[] },
    },
    order: [p1,p2], // first to act rotates per street could be added; for now unused
    board: [],
    deck: [],
    round: 1,
    phase: 'DEAL', // DEAL -> FLOP -> EX1 -> TURN -> EX2 -> RIVER -> EX3 -> COMPARE -> ROULETTE/RESULT
    lastResult: null, // {winnerId, loserId, reason}
    isAI: false, // if one side is AI
  }
}

// Helpers to move phase
function deal(gs){
  gs.deck = makeDeck()
  gs.board = []
  for (const pid of Object.keys(gs.players)){
    gs.players[pid].private = [gs.deck.pop(), gs.deck.pop()]
    gs.players[pid].hasJoker = gs.players[pid].private.some(isJoker)
    gs.players[pid].ready=false
    gs.players[pid].exchangeIdxs=[]
  }
  gs.phase = 'FLOP'
}
function flop(gs){ gs.board = [gs.deck.pop(), gs.deck.pop(), gs.deck.pop()]; resetReady(gs); gs.phase='EX1' }
function turn(gs){ gs.board.push(gs.deck.pop()); resetReady(gs); gs.phase='EX2' }
function river(gs){ gs.board.push(gs.deck.pop()); resetReady(gs); gs.phase='EX3' }
function resetReady(gs){ for (const p of Object.values(gs.players)) { p.ready=false; p.exchangeIdxs=[] } }

// perform exchange after both ready in EX* phases
function doExchange(gs){
  for (const p of Object.values(gs.players)) {
    const idxs = Array.from(new Set(p.exchangeIdxs)).filter(i=>i===0||i===1)
    idxs.sort()
    for (const i of idxs) { p.private[i] = gs.deck.pop() }
    p.hasJoker = p.private.some(isJoker)
  }
}

// compare hands -> return {winnerId, loserId, tie}
function compareHands(gs){
  const [a,b] = Object.keys(gs.players)
  const A = gs.players[a], B = gs.players[b]
  const evalA = evaluate7(A.private, gs.board.filter(c=>!isJoker(c)))
  const evalB = evaluate7(B.private, gs.board.filter(c=>!isJoker(c)))
  const cmp = cmpRank(evalA, evalB)
  if (cmp===0) return { tie:true }
  const winnerId = (cmp>0)?a:b
  const loserId = (cmp>0)?b:a
  return { winnerId, loserId, tie:false, evalA, evalB }
}

// Roulette simulation
function russianRoulette(round, loserHasJoker, winnerHasJoker){
  // chambers=6, bullets = round (1..6) + (winner joker ? +1 : 0), min 1, max 6
  let bullets = Math.min(6, Math.max(1, round + (winnerHasJoker ? 1 : 0)))
  const chambers = new Array(6).fill(0)
  // unique bullet slots
  while (bullets>0){
    const i = randInt(6)
    if (chambers[i]===0){ chambers[i]=1; bullets-- }
  }
  // spin: rotate random steps then stop at arrow(0)
  const rot = randInt(24)+6 // 6~29 steps
  // After rotation, chamber at index (6 - rot%6) lands at arrow
  const top = ((6 - (rot % 6)) % 6)
  const hit = chambers[top]===1
  // Apply joker skip for loser
  const skipped = loserHasJoker ? true : false
  return { chambers, top, hit: skipped ? false : hit, rotatedSteps: rot, skipped }
}

function resetForNextRound(gs){
  gs.round++
  gs.board=[]
  gs.deck=[]
  for (const p of Object.values(gs.players)){
    p.private=[]
    p.hasJoker=false
    p.ready=false
    p.exchangeIdxs=[]
  }
  gs.phase='DEAL'
}

// ---------------------- Room Lifecycle ----------------------
function ensureRoom(roomId){
  const r = rooms.get(roomId)
  if (!r) throw new Error('Room not found')
  return r
}

function createRoom(hostId){
  const code = makeRoomId()
  const state = { id: code, createdAt: now(), sockets: new Set([hostId]), game: null, timer: null }
  rooms.set(code, state)
  return state
}

function joinRoom(code, sid){
  const r = rooms.get(code)
  if (!r) return null
  r.sockets.add(sid)
  return r
}

function startGame(room){
  const [p1, p2] = Array.from(room.sockets)
  room.game = newGameState(p1, p2)
  deal(room.game)
  broadcastState(room)
}

function broadcastState(room){
  const gs = room.game
  const payload = {
    roomId: room.id,
    phase: gs.phase,
    round: gs.round,
    board: gs.board,
    players: Object.fromEntries(Object.entries(gs.players).map(([id,p])=>[id,{
      id, nickname:p.nickname, hearts:p.hearts, ready:p.ready,
      // IMPORTANT: do not leak private cards to opponent; client will hide on its side.
      private: p.private, 
      hasJoker: p.hasJoker
    }])),
    isAI: gs.isAI
  }
  broadcast(room.id, 'state', payload)
}

// ---------------------- Socket Handlers ----------------------
io.on('connection', (socket) => {
  console.log('connected', socket.id)
  socket.data.nickname = 'PLAYER' // default; refined via set_nickname

  socket.emit('server_status', { online: true })

  socket.on('set_nickname', (name) => {
    // only store for display; English text rule applies on client side
    const safe = String(name||'').trim().slice(0,16)
    socket.data.nickname = safe || `PLAYER`
  })

  // ----- Create Room -----
  socket.on('create_room', (_, cb) => {
    const room = createRoom(socket.id)
    socket.join(room.id)
    cb?.({ ok:true, code:room.id })
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
  })

  // ----- Join Room -----
  socket.on('join_room', (code, cb) => {
    const room = joinRoom(String(code||'').toUpperCase(), socket.id)
    if (!room) return cb?.({ ok:false, error:'ROOM_NOT_FOUND' })
    socket.join(room.id)
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
    if (room.sockets.size===2) startGame(room)
    cb?.({ ok:true })
  })

  // ----- Quick Match -----
  socket.on('quick_match', (_payload, cb) => {
    // if someone is waiting, pair
    for (const otherId of queue) {
      if (otherId!==socket.id) {
        queue.delete(otherId)
        const room = createRoom(socket.id) // use fresh room id
        joinRoom(room.id, otherId)
        socket.join(room.id)
        io.sockets.sockets.get(otherId)?.join(room.id)
        startGame(room)
        return cb?.({ ok:true, paired:true, code:room.id })
      }
    }
    // else enqueue and fallback to AI after 8s
    queue.add(socket.id)
    const startAt = now()
    const timer = setTimeout(()=>{
      if (!queue.has(socket.id)) return
      queue.delete(socket.id)
      const room = createRoom(socket.id)
      socket.join(room.id)
      // Create bot socket surrogate id
      const botId = `BOT_${Math.random().toString(36).slice(2,8)}`
      room.sockets.add(botId)
      startGame(room)
      // mark AI name
      room.game.isAI = true
      room.game.players[botId].nickname = botName()
      // attach to room state (no real socket for bot)
      broadcast(room.id,'system',{ msg:'AI matched due to timeout' })
      cb?.({ ok:true, paired:false, ai:true, code:room.id, waitedMs: now()-startAt })
    }, 8000)
    // allow cancel
    socket.once('cancel_match', ()=>{ clearTimeout(timer); cleanSocketFromQueue(socket) })
    cb?.({ ok:true, queued:true })
  })

  // ----- Ready & Exchange -----
  socket.on('select_exchange', (idxs=[])=>{
    // find room of player
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const p = gs.players[socket.id]
    if (!p) return
    if (!gs.phase.startsWith('EX')) return
    p.exchangeIdxs = Array.isArray(idxs) ? idxs.slice(0,2) : []
    io.to(room.id).emit('peer_exchange_hint', { playerId: socket.id }) // opponent sees blink
  })

  socket.on('ready', ()=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const p = gs.players[socket.id]
    if (!p) return
    p.ready = true
    broadcastState(room)

    const bothReady = Object.values(gs.players).every(x=>x.ready)
    if (!bothReady) return

    // Both ready -> perform exchange then move phase
    doExchange(gs)
    if (gs.phase==='EX1'){ turnToNext(room, 'TURN', turn) }
    else if (gs.phase==='EX2'){ turnToNext(room, 'RIVER', river) }
    else if (gs.phase==='EX3'){ compareStep(room) }
  })

  // ----- Surrender -----
  socket.on('surrender', ()=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const oppId = Array.from(room.sockets).find(id=>id!==socket.id)
    endMatch(room, oppId, socket.id, 'Surrender')
  })

  // ----- Leave & Cleanup -----
  socket.on('disconnect', ()=>{
    cleanSocketFromQueue(socket)
    // if inside a room, declare other side the winner (unless bot only)
    for (const room of rooms.values()) {
      if (room.sockets.has(socket.id)) {
        room.sockets.delete(socket.id)
        io.to(room.id).emit('system',{msg:'Player disconnected'})
        const others = Array.from(room.sockets)
        if (others.length===1 && room.game) {
          const winner = others[0]
          endMatch(room, winner, socket.id, 'Disconnect')
        }
      }
    }
  })
})

// ---------------------- Phase Drivers ----------------------
function turnToNext(room, phaseName, exec){
  const gs = room.game
  exec(gs)
  gs.phase = phaseName
  broadcastState(room)
}

function compareStep(room){
  const gs = room.game
  gs.phase = 'COMPARE'
  const res = compareHands(gs)
  if (res.tie){
    broadcast(room.id,'compare', { tie:true, message:'Tie – no roulette' })
    resetForNextRound(gs) // new round
    deal(gs); flop(gs) // immediately go to EX1
    broadcastState(room)
    return
  }
  const winner = res.winnerId, loser = res.loserId
  broadcast(room.id,'compare', {
    tie:false,
    winnerId:winner, loserId:loser,
    detail: { a:res.evalA?.name, b:res.evalB?.name }
  })
  // Joker rule application for roulette
  const loserHasJoker = gs.players[loser].hasJoker
  const winnerHasJoker = gs.players[winner].hasJoker
  const rr = russianRoulette(gs.round, loserHasJoker, winnerHasJoker)
  gs.phase = 'ROULETTE'
  broadcast(room.id,'roulette', {
    round: gs.round,
    chambers: rr.chambers,
    top: rr.top,
    rotatedSteps: rr.rotatedSteps,
    skipped: rr.skipped,
    text: rr.skipped ? 'SAFE' : (rr.hit ? 'BANG!' : 'SAFE'),
    hit: rr.hit
  })

  if (rr.hit) {
    endMatch(room, winner, loser, 'Roulette')
  } else {
    // survive -> next round
    resetForNextRound(gs)
    deal(gs); flop(gs)
    broadcastState(room)
  }
}

function endMatch(room, winnerId, loserId, reason){
  const gs = room.game
  gs.phase = 'RESULT'
  gs.lastResult = { winnerId, loserId, reason }
  broadcast(room.id,'result', {
    winnerId, loserId, reason,
    message: (winnerId.startsWith('BOT_')?'AI': 'Player') + ' wins'
  })
  // after result, clear game (fresh lobby). Client will navigate home in 5s.
  setTimeout(()=>{
    room.game = null
    // keep sockets in room so they can rematch if desired
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
  }, 5200)
}

// ---------------------- Start ----------------------
const PORT = process.env.PORT || 8080
httpServer.listen(PORT, () => console.log('server listening on ' + PORT))

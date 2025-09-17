// Hold'em & Shot – Server
// Node + Express + Socket.IO
// - Matchmaking (Quick/Room)
// - 1v1 Game engine (Texas Hold'em variant + Joker rule)
// - Russian Roulette after each round
// - AI fallback if matchmaking fails within 8s
// - Texts in English (only nicknames are user input)

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
]

app.use(cors({
  origin: (origin, callback) => {
    // ⚡ iOS Safari 같은 환경에서는 origin이 undefined/null일 수 있음 → 허용
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error("CORS not allowed"), false)
  }
}))

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
})

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }))

// ---------------------- Utilities ----------------------
const randInt = (n) => Math.floor(Math.random() * n)
const sample = (arr) => arr[randInt(arr.length)]
const now = () => Date.now()

const BOT_NAMES = [
  'Maverick','Viper','Nexus','Kappa','Atlas','Nova','Echo',
  'Quark','Orion','Pixel','Zephyr','Comet','Delta','Juno'
]

// 카드 덱 (조커 포함)
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
const SUITS = ['S','H','D','C']
const makeDeck = () => {
  const deck = []
  for (const r of RANKS) for (const s of SUITS) deck.push(r+s)
  deck.push('JK1'); deck.push('JK2')
  return shuffle(deck)
}
const shuffle = (a) => {
  for (let i=a.length-1;i>0;i--) {
    const j = randInt(i+1); [a[i],a[j]]=[a[j],a[i]]
  }
  return a
}
const isJoker = (c) => c.startsWith('JK')

// ---------------------- Game State ----------------------
function newGameState(p1, p2) {
  return {
    createdAt: now(),
    players: {
      [p1]: { id:p1, nickname:'PLAYER1', hearts:1, private:[], hasJoker:false, ready:false, exchangeIdxs:[] },
      [p2]: { id:p2, nickname:'PLAYER2', hearts:1, private:[], hasJoker:false, ready:false, exchangeIdxs:[] },
    },
    order: [p1,p2],
    board: [],
    deck: [],
    round: 1,
    phase: 'DEAL',
    lastResult: null,
    isAI: false,
  }
}

// ---------------------- Rooms ----------------------
const queue = new Set()
const rooms = new Map()

function makeRoomId() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s=''
  for(let i=0;i<6;i++) s+=chars[randInt(chars.length)]
  return rooms.has(s) ? makeRoomId() : s
}
function createRoom(hostId){
  const code = makeRoomId()
  const state = { id: code, createdAt: now(), sockets: new Set([hostId]), game: null }
  rooms.set(code, state)
  return state
}
function joinRoom(code, sid){
  const r = rooms.get(code)
  if (!r) return null
  r.sockets.add(sid)
  return r
}
function broadcast(roomId, ev, payload){ io.to(roomId).emit(ev, payload) }

// ---------------------- Core Game Logic ----------------------
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
function doExchange(gs){
  for (const p of Object.values(gs.players)) {
    const idxs = Array.from(new Set(p.exchangeIdxs)).filter(i=>i===0||i===1)
    idxs.sort()
    for (const i of idxs) { p.private[i] = gs.deck.pop() }
    p.hasJoker = p.private.some(isJoker)
  }
}

// ---------------------- Roulette ----------------------
function russianRoulette(round, loserHasJoker, winnerHasJoker){
  let bullets = Math.min(6, Math.max(1, round + (winnerHasJoker ? 1 : 0)))
  const chambers = new Array(6).fill(0)
  while (bullets>0){
    const i = randInt(6)
    if (chambers[i]===0){ chambers[i]=1; bullets-- }
  }
  const rot = randInt(24)+6
  const top = ((6 - (rot % 6)) % 6)
  const hit = chambers[top]===1
  const skipped = loserHasJoker ? true : false
  return { chambers, top, hit: skipped ? false : hit, rotatedSteps: rot, skipped }
}

// ---------------------- Socket ----------------------
io.on('connection', (socket) => {
  console.log('connected', socket.id)
  socket.data.nickname = 'PLAYER'

  socket.emit('server_status', { online: true })

  socket.on('set_nickname', (name) => {
    const safe = String(name||'').trim().slice(0,16)
    socket.data.nickname = safe || `PLAYER`
  })

  socket.on('create_room', (_, cb) => {
    const room = createRoom(socket.id)
    socket.join(room.id)
    cb?.({ ok:true, code:room.id })
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
  })

  socket.on('join_room', (code, cb) => {
    const room = joinRoom(String(code||'').toUpperCase(), socket.id)
    if (!room) return cb?.({ ok:false, error:'ROOM_NOT_FOUND' })
    socket.join(room.id)
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
    if (room.sockets.size===2) startGame(room)
    cb?.({ ok:true })
  })

  socket.on('quick_match', (_payload, cb) => {
    for (const otherId of queue) {
      if (otherId!==socket.id) {
        queue.delete(otherId)
        const room = createRoom(socket.id)
        joinRoom(room.id, otherId)
        socket.join(room.id)
        io.sockets.sockets.get(otherId)?.join(room.id)
        startGame(room)
        return cb?.({ ok:true, paired:true, code:room.id })
      }
    }
    queue.add(socket.id)
    const startAt = now()
    setTimeout(()=>{
      if (!queue.has(socket.id)) return
      queue.delete(socket.id)
      const room = createRoom(socket.id)
      socket.join(room.id)
      const botId = `BOT_${Math.random().toString(36).slice(2,8)}`
      room.sockets.add(botId)
      startGame(room, botId)
      room.game.isAI = true
      room.game.players[botId].nickname = sample(BOT_NAMES)
      cb?.({ ok:true, paired:false, ai:true, code:room.id, waitedMs: now()-startAt })
    }, 8000)
    cb?.({ ok:true, queued:true })
  })

  socket.on('ready', () => {
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const p = gs.players[socket.id]
    if (!p) return
    p.ready = true
    broadcastState(room)

    const bothReady = Object.values(gs.players).every(x=>x.ready)
    if (!bothReady) return

    doExchange(gs)
    if (gs.phase==='EX1'){ turn(gs) }
    else if (gs.phase==='EX2'){ river(gs) }
    else if (gs.phase==='EX3'){ compareStep(room) }
    broadcastState(room)
  })

  socket.on('surrender', () => {
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const oppId = Array.from(room.sockets).find(id=>id!==socket.id)
    endMatch(room, oppId, socket.id, 'Surrender')
  })

  socket.on('disconnect', () => {
    queue.delete(socket.id)
    for (const room of rooms.values()) {
      if (room.sockets.has(socket.id)) {
        room.sockets.delete(socket.id)
        io.to(room.id).emit('system',{msg:'Player disconnected'})
        const others = Array.from(room.sockets)
        if (others.length===1 && room.game) {
          endMatch(room, others[0], socket.id, 'Disconnect')
        }
      }
    }
  })
})

// ---------------------- Game Flow ----------------------
function startGame(room, botId=null) {
  const [p1, p2] = Array.from(room.sockets)
  room.game = newGameState(p1, p2)
  // 닉네임 반영 (PLAYER1/PLAYER2 덮어쓰기)
  for (const pid of [p1,p2]) {
    if (pid.startsWith('BOT_')) {
      room.game.players[pid].nickname = sample(BOT_NAMES)
    } else {
      const s = io.sockets.sockets.get(pid)
      if (s?.data.nickname) {
        room.game.players[pid].nickname = s.data.nickname
      }
    }
  }
  deal(room.game)
  flop(room.game)
  broadcastState(room)
}

function broadcastState(room) {
  const gs = room.game
  if (!gs) return
  const payload = {
    roomId: room.id,
    phase: gs.phase,
    round: gs.round,
    board: gs.board,
    players: Object.fromEntries(Object.entries(gs.players).map(([id,p])=>[id,{
      id, nickname:p.nickname, hearts:p.hearts, ready:p.ready,
      private: p.private, hasJoker: p.hasJoker
    }])),
    isAI: gs.isAI
  }
  broadcast(room.id,'state', payload)
}

function compareStep(room){
  const gs = room.game
  gs.phase = 'COMPARE'
  // 단순 승패 결정 (족보 evaluator 부분은 생략/기존 그대로)
  const [a,b] = Object.keys(gs.players)
  const winner = Math.random()>0.5 ? a : b
  const loser = winner===a ? b : a
  const rr = russianRoulette(gs.round, gs.players[loser].hasJoker, gs.players[winner].hasJoker)
  gs.phase = 'ROULETTE'
  broadcast(room.id,'roulette', { ...rr, round: gs.round, text: rr.skipped ? 'SAFE' : (rr.hit ? 'BANG!' : 'SAFE') })
  if (rr.hit) {
    endMatch(room, winner, loser, 'Roulette')
  } else {
    gs.round++
    deal(gs); flop(gs)
    broadcastState(room)
  }
}

function endMatch(room, winnerId, loserId, reason){
  const gs = room.game
  gs.phase = 'RESULT'
  gs.lastResult = { winnerId, loserId, reason }
  broadcast(room.id,'result', { winnerId, loserId, reason })
  setTimeout(()=>{ room.game=null }, 5200)
}

// ---------------------- Start ----------------------
const PORT = process.env.PORT || 8080
httpServer.listen(PORT, () => console.log('server listening on ' + PORT))

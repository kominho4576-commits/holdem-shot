// Hold'em & Shot – Server
// Node + Express + Socket.IO
// - Matchmaking (Quick/Room)
// - 1v1 Game engine (Texas Hold'em variant + Joker rule)
// - Russian Roulette after each round (loser only, skip/add via Joker)  ← 5s auto countdown
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

// ✅ CORS: 모바일 사파리/웹소켓 이슈 방지 - 허용 도메인 명시
const allowedOrigins = [
  'https://holdem-shot.vercel.app',
  'http://localhost:5173'
]
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)   // 모바일 앱/테스트 등 origin 없음 허용
    callback(allowedOrigins.includes(origin) ? null : new Error('CORS not allowed'),
             allowedOrigins.includes(origin))
  }
}))

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] }
})

// 간단 헬스체크
app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }))

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
  deck.push('JK1'); deck.push('JK2')
  return shuffle(deck)
}
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j = randInt(i+1); [a[i],a[j]]=[a[j],a[i]] } return a }
const isJoker = (c) => c.startsWith('JK')
const cardRank = (c) => RANKS.indexOf(c[0]) // 0 is A(high), 12 is 2(low)
const cardSuit = (c) => c[1]

// ---------------- Poker Evaluator (with private-joker rule) -------------
function evaluate7(private2, board5) {
  const privNoJoker = private2.filter(c=>!isJoker(c))
  const hasJoker = private2.length !== privNoJoker.length
  const candidates = [privNoJoker]
  if (hasJoker) {
    for (const r of RANKS) {
      candidates.push([...privNoJoker, r+'S'])
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

// core (no jokers)
function eval7NoJoker(cards) {
  const ranksCount = new Array(13).fill(0)
  const suitMap = { S:[], H:[], D:[], C:[] }
  for (const c of cards) {
    const r = cardRank(c); if (r<0) continue
    ranksCount[r]++
    suitMap[cardSuit(c)].push(r)
  }
  const listAll = () => {
    const list=[]; for (let r=0;r<13;r++) for (let k=0;k<ranksCount[r];k++) list.push(r)
    return list.sort((a,b)=>a-b)
  }
  const straightOf = (ranksArr) => {
    const set = new Set(ranksArr)
    for (let a=0;a<=8;a++){ let ok=true; for (let k=0;k<5;k++) if(!set.has(a+k)){ok=false;break}; if(ok) return a+4 }
    const five = RANKS.indexOf('5'), four = RANKS.indexOf('4'), three = RANKS.indexOf('3'), two = RANKS.indexOf('2')
    if (set.has(0)&&set.has(five)&&set.has(four)&&set.has(three)&&set.has(two)) return five
    return null
  }

  // Flush / Straight Flush
  let flushSuit = null, flushRanks = null
  for (const s of SUITS) if (suitMap[s].length>=5){ flushSuit=s; flushRanks=suitMap[s].slice().sort((a,b)=>a-b); break }
  if (flushSuit){
    const hi = straightOf(flushRanks)
    if (hi!==null){ const royal = (hi===RANKS.indexOf('A')); return { score: royal?900:800, name: royal?'Royal Flush':'Straight Flush', primary:[hi] } }
  }

  // Groups
  const groups = {}
  for (let r=0;r<13;r++) if (ranksCount[r]) (groups[ranksCount[r]]??=[]).push(r)
  for (const k of Object.keys(groups)) groups[k].sort((a,b)=>a-b)

  if (groups[4]?.length){
    const four = groups[4][0]; const kicker = (listAll().filter(x=>x!==four)).at(-1)
    return { score:700, name:'Four of a Kind', primary:[four,kicker] }
  }
  if ((groups[3]?.length) && ((groups[2]?.length)||(groups[3]?.length>1))){
    const trips = groups[3][0]; const pair = (groups[3].length>1)?groups[3][1]:groups[2][0]
    return { score:600, name:'Full House', primary:[trips,pair] }
  }
  if (flushSuit){ const top5 = flushRanks.slice(-5); return { score:500, name:'Flush', primary:top5 } }
  const straightHi = straightOf(listAll()); if (straightHi!==null) return { score:400, name:'Straight', primary:[straightHi] }
  if (groups[3]?.length){
    const trips = groups[3][0]; const kickers=(listAll().filter(x=>x!==trips)).slice(-2)
    return { score:300, name:'Three of a Kind', primary:[trips,...kickers] }
  }
  if (groups[2]?.length>=2){
    const [p1,p2]=groups[2].slice(-2); const kicker=(listAll().filter(x=>x!==p1&&x!==p2)).at(-1)
    return { score:200, name:'Two Pair', primary:[p1,p2,kicker] }
  }
  if (groups[2]?.length===1){
    const p=groups[2][0]; const kickers=(listAll().filter(x=>x!==p)).slice(-3)
    return { score:100, name:'One Pair', primary:[p,...kickers] }
  }
  const hi5 = listAll().slice(-5); return { score:50, name:'High Card', primary:hi5 }
}
function cmpRank(a,b){
  if (a.score!==b.score) return a.score-b.score
  const len=Math.max(a.primary.length,b.primary.length)
  for (let i=0;i<len;i++){ const av=a.primary[i]??-1, bv=b.primary[i]??-1; if (av!==bv) return av-bv }
  return 0
}

// ---------------------- Matchmaking & Rooms ----------------------
const queue = new Set()       // sockets waiting for quick match
const rooms = new Map()       // roomId -> RoomState

function makeRoomId(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s=''; for(let i=0;i<6;i++) s+=chars[randInt(chars.length)]
  return rooms.has(s) ? makeRoomId() : s
}
const botName = () => sample(BOT_NAMES)
const cleanSocketFromQueue = (socket) => queue.delete(socket.id)
const broadcast = (roomId, ev, payload) => io.to(roomId).emit(ev, payload)

// ---------------------- Game State Model ----------------------
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
    isAI: false
  }
}

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
    const idxs = Array.from(new Set(p.exchangeIdxs)).filter(i=>i===0||i===1).sort()
    for (const i of idxs) p.private[i] = gs.deck.pop()
    p.hasJoker = p.private.some(isJoker)
  }
}

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

// ---------------------- Roulette (5s auto) ----------------------
const ROULETTE_COUNTDOWN_MS = 5000
const rouletteTimers = new Map()    // roomId -> timeout
const countdownTimers = new Map()   // roomId -> interval (초카운트 브로드캐스트용)

function russianRoulette(round, loserHasJoker, winnerHasJoker){
  let bullets = Math.min(6, Math.max(1, round + (winnerHasJoker ? 1 : 0)))
  const chambers = new Array(6).fill(0)
  while (bullets>0){ const i = randInt(6); if (!chambers[i]){ chambers[i]=1; bullets-- } }
  const rot = randInt(24)+6        // 6~29 steps (정확히 60도 단위는 클라에서 맞춤)
  const top = ((6 - (rot % 6)) % 6)
  const hit = chambers[top]===1
  const skipped = !!loserHasJoker
  return { chambers, top, hit: skipped ? false : hit, rotatedSteps: rot, skipped }
}

function scheduleRoulette(room){
  clearTimeout(rouletteTimers.get(room.id))
  clearInterval(countdownTimers.get(room.id))
  // 클라 표시용 5→1 카운트 전송
  let left = 5
  io.to(room.id).emit('roulette_countdown', { seconds: left })
  const iv = setInterval(()=>{
    left -= 1
    if (left > 0) io.to(room.id).emit('roulette_countdown', { seconds: left })
    else clearInterval(iv)
  }, 1000)
  countdownTimers.set(room.id, iv)

  const t = setTimeout(()=> runRoulette(room), ROULETTE_COUNTDOWN_MS)
  rouletteTimers.set(room.id, t)
}

function runRoulette(room){
  clearTimeout(rouletteTimers.get(room.id))
  clearInterval(countdownTimers.get(room.id))
  const gs = room.game
  if (!gs || gs.phase!=='ROULETTE') return

  const { winnerId, loserId } = room.pendingRoulette
  const rr = russianRoulette(gs.round, gs.players[loserId].hasJoker, gs.players[winnerId].hasJoker)

  // Joker skip: 즉시 SAFE
  if (rr.skipped){
    io.to(room.id).emit('roulette', {
      round: gs.round, chambers:[0,0,0,0,0,0], top:0, rotatedSteps:0,
      skipped:true, text:'SAFE', hit:false
    })
    proceedNextRound(room)
    return
  }

  // 실제 결과 브로드캐스트
  io.to(room.id).emit('roulette', {
    round: gs.round,
    chambers: rr.chambers,
    top: rr.top,
    rotatedSteps: rr.rotatedSteps,
    skipped: false,
    text: rr.hit ? 'BANG!' : 'SAFE',
    hit: rr.hit
  })

  if (rr.hit) endMatch(room, winnerId, loserId, 'Roulette')
  else proceedNextRound(room)
}

function proceedNextRound(room){
  const gs = room.game
  resetForNextRound(gs)
  deal(gs); flop(gs)
  broadcastState(room)
}

function resetForNextRound(gs){
  gs.round++
  gs.board=[]; gs.deck=[]
  for (const p of Object.values(gs.players)){
    p.private=[]; p.hasJoker=false; p.ready=false; p.exchangeIdxs=[]
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
  const state = { id: code, createdAt: now(), sockets: new Set([hostId]), game: null, timer: null, pendingRoulette: null }
  rooms.set(code, state)
  return state
}
function joinRoom(code, sid){
  const r = rooms.get(code); if (!r) return null
  r.sockets.add(sid); return r
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
      id, nickname:p.nickname, hearts:p.hearts, ready:p.ready, private:p.private, hasJoker:p.hasJoker
    }])),
    isAI: gs.isAI
  }
  broadcast(room.id, 'state', payload)
}

// ---------------------- Socket Handlers ----------------------
io.on('connection', (socket) => {
  console.log('connected', socket.id)
  socket.data.nickname = 'PLAYER' // default

  socket.emit('server_status', { online: true })

  socket.on('set_nickname', (name) => {
    const safe = String(name||'').trim().slice(0,16)
    socket.data.nickname = safe || 'PLAYER'
  })

  // Create Room
  socket.on('create_room', (_, cb) => {
    const room = createRoom(socket.id)
    socket.join(room.id)
    cb?.({ ok:true, code:room.id })
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
  })

  // Join Room
  socket.on('join_room', (code, cb) => {
    const room = joinRoom(String(code||'').toUpperCase(), socket.id)
    if (!room) return cb?.({ ok:false, error:'ROOM_NOT_FOUND' })
    socket.join(room.id)
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
    if (room.sockets.size===2) startGame(room)
    cb?.({ ok:true })
  })

  // Quick Match
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
    // enqueue & fallback to AI after 8s
    queue.add(socket.id)
    const started = now()
    const timer = setTimeout(()=>{
      if (!queue.has(socket.id)) return
      queue.delete(socket.id)
      const room = createRoom(socket.id)
      socket.join(room.id)
      const botId = `BOT_${Math.random().toString(36).slice(2,8)}`
      room.sockets.add(botId)
      startGame(room)
      room.game.isAI = true
      room.game.players[botId].nickname = botName()
      broadcast(room.id,'system',{ msg:'AI matched due to timeout' })
      cb?.({ ok:true, paired:false, ai:true, code:room.id, waitedMs: now()-started })
    }, 8000)
    socket.once('cancel_match', ()=>{ clearTimeout(timer); cleanSocketFromQueue(socket) })
    cb?.({ ok:true, queued:true })
  })

  // Exchange select / ready
  socket.on('select_exchange', (idxs=[])=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const p = gs.players[socket.id]; if (!p) return
    if (!gs.phase.startsWith('EX')) return
    p.exchangeIdxs = Array.isArray(idxs) ? idxs.slice(0,2) : []
    io.to(room.id).emit('peer_exchange_hint', { playerId: socket.id })
  })

  socket.on('ready', ()=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const p = gs.players[socket.id]; if (!p) return
    p.ready = true
    broadcastState(room)
    const bothReady = Object.values(gs.players).every(x=>x.ready)
    if (!bothReady) return
    doExchange(gs)
    if (gs.phase==='EX1'){ turnToNext(room, 'TURN', turn) }
    else if (gs.phase==='EX2'){ turnToNext(room, 'RIVER', river) }
    else if (gs.phase==='EX3'){ compareStep(room) }
  })

  // Surrender
  socket.on('surrender', ()=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room) return
    const gs = room.game
    const oppId = Array.from(room.sockets).find(id=>id!==socket.id)
    endMatch(room, oppId, socket.id, 'Surrender')
  })

  // Optional: 수동으로 즉시 룰렛 시작시키고 싶을 때
  socket.on('roulette_start', ()=>{
    const room = [...rooms.values()].find(r=>r.sockets.has(socket.id) && r.game)
    if (!room || room.game.phase!=='ROULETTE') return
    runRoulette(room)
  })

  // Disconnect
  socket.on('disconnect', ()=>{
    cleanSocketFromQueue(socket)
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
    resetForNextRound(gs); deal(gs); flop(gs)
    broadcastState(room)
    return
  }

  const winner = res.winnerId, loser = res.loserId
  broadcast(room.id,'compare', {
    tie:false,
    winnerId:winner, loserId:loser,
    detail: { a:res.evalA?.name, b:res.evalB?.name }
  })

  // → ROULETTE 단계 진입 (여기서 즉시 돌리지 않음!)
  gs.phase = 'ROULETTE'
  room.pendingRoulette = { winnerId:winner, loserId:loser }
  broadcastState(room)                    // 클라 Phase 바꾸고
  scheduleRoulette(room)                  // ★ 5초 카운트 후 자동 실행
}

function endMatch(room, winnerId, loserId, reason){
  const gs = room.game
  gs.phase = 'RESULT'
  gs.lastResult = { winnerId, loserId, reason }
  broadcast(room.id,'result', {
    winnerId, loserId, reason,
    message: (winnerId.startsWith('BOT_')?'AI':'Player') + ' wins'
  })
  // 라운드 정보 정리
  clearTimeout(rouletteTimers.get(room.id))
  clearInterval(countdownTimers.get(room.id))
  setTimeout(()=>{
    room.game = null
    room.pendingRoulette = null
    io.to(room.id).emit('lobby', { code:room.id, players:Array.from(room.sockets) })
  }, 5200)
}

// ---------------------- Start ----------------------
const PORT = process.env.PORT || 8080
httpServer.listen(PORT, () => console.log('server listening on ' + PORT))

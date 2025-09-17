// server/src/server.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'

const app = express()
app.use(express.json())

// 허용할 도메인
const allowedOrigins = [
  "https://holdem-shot.vercel.app",
  "http://localhost:5173"
]

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error("CORS not allowed"), false)
  }
}))

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] }
})

app.get('/health', (_req, res) =>
  res.json({ ok: true, time: Date.now() })
)

// --- Utils ---
const randInt = (n) => Math.floor(Math.random() * n)
const now = () => Date.now()
const BOT_NAMES = ['Maverick','Viper','Nexus','Atlas','Echo','Comet','Delta','Juno']
const sample = (arr) => arr[randInt(arr.length)]

// --- Game state ---
function newGameState(p1, p2) {
  return {
    round: 1,
    board: [],
    deck: [],
    players: {
      [p1]: { id:p1, nickname:'PLAYER1', hearts:1, private:[], ready:false, exchangeIdxs:[] },
      [p2]: { id:p2, nickname:'PLAYER2', hearts:1, private:[], ready:false, exchangeIdxs:[] },
    },
    order: [p1,p2],
    turn: p1,
    phase: 'DEAL'
  }
}

// --- Broadcast helpers ---
function broadcastState(room) {
  io.to(room.id).emit('state', {
    roomId: room.id,
    phase: room.game.phase,
    round: room.game.round,
    players: Object.fromEntries(Object.entries(room.game.players).map(([id,p])=>[id,{
      id, nickname:p.nickname, hearts:p.hearts, ready:p.ready, private:p.private
    }])),
    turn: room.game.turn
  })
}

// --- Roulette logic ---
function russianRoulette(round) {
  let bullets = Math.min(6, Math.max(1, round))
  const chambers = new Array(6).fill(0)
  while (bullets>0) {
    const i = randInt(6)
    if (chambers[i]===0){ chambers[i]=1; bullets-- }
  }
  const rot = randInt(24)+6
  const top = ((6 - (rot % 6)) % 6)
  const hit = chambers[top]===1
  return { chambers, top, hit, rotatedSteps: rot }
}

// --- Compare → Roulette with countdown ---
function compareStep(room) {
  room.game.phase = 'COMPARE'

  // 간단히 loser 임의 선택 (테스트용)
  const [p1,p2] = room.game.order
  const loser = Math.random()>0.5?p1:p2
  const winner = loser===p1?p2:p1

  io.to(room.id).emit('compare', { winnerId:winner, loserId:loser })

  // 카운트다운
  let sec = 5
  const timer = setInterval(()=>{
    io.to(room.id).emit('roulette_countdown', { seconds: sec })
    sec--
    if (sec<0) {
      clearInterval(timer)
      const rr = russianRoulette(room.game.round)
      room.game.phase = 'ROULETTE'
      io.to(room.id).emit('roulette', rr)
      if (rr.hit) {
        endMatch(room, winner, loser)
      } else {
        room.game.round++
        broadcastState(room)
      }
    }
  },1000)
}

function endMatch(room, winner, loser) {
  room.game.phase = 'RESULT'
  io.to(room.id).emit('result', { winnerId:winner, loserId:loser })
}

// --- Socket handlers ---
const rooms = new Map()
function createRoom(id) {
  const code = Math.random().toString(36).slice(2,8).toUpperCase()
  const state = { id: code, sockets:new Set([id]), game:null }
  rooms.set(code, state)
  return state
}

io.on('connection', (socket)=>{
  socket.data.nickname = 'PLAYER'

  socket.on('set_nickname', (name)=>{
    const safe = String(name||'').trim().slice(0,16) || 'PLAYER'
    socket.data.nickname = safe
    for (const room of rooms.values()) {
      if (room.sockets.has(socket.id) && room.game?.players[socket.id]) {
        room.game.players[socket.id].nickname = safe
        broadcastState(room)
      }
    }
  })

  socket.on('create_room', (_,cb)=>{
    const room = createRoom(socket.id)
    socket.join(room.id)
    cb?.({ ok:true, code:room.id })
    room.game = newGameState(socket.id, "BOT")
    room.game.players["BOT"] = { id:"BOT", nickname:sample(BOT_NAMES), hearts:1, private:[] }
    compareStep(room) // 바로 테스트용 실행
  })
})

const PORT = process.env.PORT||8080
httpServer.listen(PORT, ()=>console.log("server running on "+PORT))

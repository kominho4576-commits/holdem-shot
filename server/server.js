import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as IOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: (origin, cb)=> cb(null, true) }
});

const PORT = process.env.PORT || 3000;

// CORS allow list from env
const allowed = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.length===0 || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Not allowed ' + origin));
  },
}));
app.use(express.json());

// very light room store
const rooms = new Map(); // code -> { hostNick, guestNick, createdAt, sockets:Set, seed:number }

app.get('/health', (req,res)=> res.status(200).send('ok'));

app.get('/create', (req,res)=>{
  const code = (req.query.code||'').toUpperCase();
  const nick = (req.query.nick||'PLAYER').toString().slice(0,24);
  if(!code) return res.status(400).json({error:'invalid_code'});
  if(rooms.has(code)) return res.status(409).json({error:'exists'});
  rooms.set(code, { hostNick:nick, guestNick:null, createdAt: Date.now(), sockets:new Set(), seed: Math.floor(Math.random()*1e9) });
  res.json({ok:true, code});
});

app.get('/join', (req,res)=>{
  const code = (req.query.code||'').toUpperCase();
  const nick = (req.query.nick||'PLAYER').toString().slice(0,24);
  const r = rooms.get(code);
  if(!r) return res.status(404).json({error:'not_found'});
  if(r.guestNick) return res.status(409).json({error:'room_full'});
  r.guestNick = nick;
  res.json({ok:true, code});
});

// socket.io for sync
io.on('connection', (socket)=>{
  socket.on('join-room', ({code, nick})=>{
    const r = rooms.get((code||'').toUpperCase());
    if(!r) return socket.emit('room-error', {error:'not_found'});
    socket.join(code);
    r.sockets.add(socket.id);
    socket.data = {code, nick};
    const info = { hostNick:r.hostNick, guestNick:r.guestNick, seed:r.seed };
    // notify both
    io.to(code).emit('room-info', info);
    // if both present, kick off start
    if(r.hostNick && r.guestNick) io.to(code).emit('room-ready', info);
  });
  socket.on('player-ready', ({code})=>{
    socket.to(code).emit('peer-ready', {});
  });
  socket.on('action', ({code, payload})=>{
    // forward to the other client
    socket.to(code).emit('peer-action', payload);
  });
  socket.on('disconnect', ()=>{
    const {code} = socket.data||{};
    if(code && rooms.has(code)){
      const r = rooms.get(code);
      r.sockets.delete(socket.id);
      io.to(code).emit('peer-left', {});
      if(r.sockets.size===0) rooms.delete(code);
    }
  });
});

server.listen(PORT, ()=>{
  console.log('listening on', PORT);
});

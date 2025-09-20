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

// Room store
const rooms = new Map(); // code -> { hostNick, guestNick, seed, sockets:Set }

app.get('/health', (req,res)=> res.status(200).send('ok'));

app.get('/create', (req,res)=>{
  const code = (req.query.code||'').toUpperCase();
  const nick = (req.query.nick||'PLAYER').toString().slice(0,24);
  if(!code) return res.status(400).json({error:'invalid_code'});
  if(rooms.has(code)) return res.status(409).json({error:'exists'});
  rooms.set(code, { hostNick:nick, guestNick:null, seed: Math.floor(Math.random()*1e9), sockets:new Set() });
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

// socket.io
io.on('connection', (socket)=>{
  socket.on('join-room', ({code, nick})=>{
    code=(code||'').toUpperCase();
    const r = rooms.get(code);
    if(!r) return socket.emit('room-error', {error:'not_found'});
    socket.join(code);
    r.sockets.add(socket.id);
    socket.data = {code, nick};
    const info = { hostNick:r.hostNick, guestNick:r.guestNick, seed:r.seed };
    io.to(code).emit('room-info', info);
    if(r.hostNick && r.guestNick) io.to(code).emit('room-ready', info);
  });
  socket.on('action', ({code, payload})=>{
    socket.to((code||'').toUpperCase()).emit('peer-action', payload);
  });
  socket.on('disconnect', ()=>{
    const {code} = socket.data||{};
    if(!code) return;
    const r = rooms.get(code);
    if(!r) return;
    r.sockets.delete(socket.id);
    io.to(code).emit('peer-left', {});
    if(r.sockets.size===0) rooms.delete(code);
  });
});


// quick match queue
const queue = []; // [{sid, nick}]
function pairIfPossible(){
  while(queue.length>=2){
    const a = queue.shift(), b = queue.shift();
    // generate room code
    const code = Math.random().toString(36).slice(2,6).toUpperCase();
    const seed = Math.floor(Math.random()*1e9);
    rooms.set(code, { hostNick:a.nick, guestNick:b.nick, seed, sockets:new Set() });
    // notify both
    io.to(a.sid).emit('matched', {code, seed, hostNick:a.nick, guestNick:b.nick, youAre:'host'});
    io.to(b.sid).emit('matched', {code, seed, hostNick:a.nick, guestNick:b.nick, youAre:'guest'});
  }
}
io.on('connection',(socket)=>{
  // (existing listeners above/below remain) we will inject queue listeners here
  socket.on('queue', ({nick})=>{
    queue.push({sid:socket.id, nick:nick||'PLAYER'});
    pairIfPossible();
  });
  socket.on('cancel-queue', ()=>{
    const i = queue.findIndex(q=>q.sid===socket.id);
    if(i>=0) queue.splice(i,1);
  });
  socket.on('disconnect', ()=>{
    const i = queue.findIndex(q=>q.sid===socket.id);
    if(i>=0) queue.splice(i,1);
  });
});

server.listen(PORT, ()=> console.log('listening on', PORT));

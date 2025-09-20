import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS allow list from env
const allowed = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.length===0 || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Not allowed ' + origin));
  }
}));
app.use(express.json());

const rooms = new Map(); // code -> { hostNick, guestNick, createdAt }

app.get('/health', (req,res)=> res.status(200).send('ok'));

app.get('/create', (req,res)=>{
  const code = (req.query.code||'').toUpperCase();
  const nick = (req.query.nick||'PLAYER').toString().slice(0,24);
  if(!code || rooms.has(code)) return res.status(400).json({error:'invalid_or_exists'});
  rooms.set(code, { hostNick:nick, guestNick:null, createdAt: Date.now() });
  res.json({ ok:true, code });
});

app.get('/join', (req,res)=>{
  const code = (req.query.code||'').toUpperCase();
  const nick = (req.query.nick||'PLAYER').toString().slice(0,24);
  const r = rooms.get(code);
  if(!r || r.guestNick) return res.status(404).json({error:'not_found'});
  r.guestNick = nick;
  res.json({ ok:true, host:r.hostNick, guest:r.guestNick });
});

// NOTE: This server is only for room code bookkeeping & health.
// Real-time synchronized gameplay is not implemented in this minimal package.

app.listen(PORT, ()=> console.log('Holdem&SHOT server on :' + PORT));

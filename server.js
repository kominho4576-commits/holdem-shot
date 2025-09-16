import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// Health
app.get('/health', (req,res)=>res.json({ok:true, ts: Date.now()}));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*"} });

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('ping', () => socket.emit('pong'));
  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log('Hold’em&SHOT server running on http://localhost:'+port);
});

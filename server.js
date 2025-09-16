// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/,
    ],
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

// 매칭 큐 & 룸
const waitingQueue = []; // {id, nick}
const rooms = new Map(); // roomId -> { players:[id1,id2], nicks:{id:nick} }

function genCode(len = 6) {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => a[Math.floor(Math.random() * a.length)]).join("");
}
function removeFromQueue(id) {
  const i = waitingQueue.findIndex((w) => w.id === id);
  if (i >= 0) waitingQueue.splice(i, 1);
}

io.on("connection", (socket) => {
  // Quick Match
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
      io.to(a.id).emit("qm:found", { roomId, opponentNick: b.nick });
      io.to(b.id).emit("qm:found", { roomId, opponentNick: a.nick });
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
    io.to(a).emit("room:ready", { roomId, opponentNick: bNick });
    io.to(b).emit("room:ready", { roomId, opponentNick: aNick });
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

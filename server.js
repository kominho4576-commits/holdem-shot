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
      /\.netlify\.app$/, // 다른 Netlify 서브도메인 허용
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// 헬스체크
app.get("/health", (req, res) => res.status(200).send("OK"));

// HTTP + Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
    methods: ["GET", "POST"],
  },
});

// ===== 매칭/룸 관리 =====
const waitingQueue = []; // [{id, nick}]
const rooms = new Map(); // roomId -> { players:[id1,id2], nicks:{id1:n1,id2:n2} }

function genCode(len = 6) {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function removeFromQueue(id) {
  const i = waitingQueue.findIndex((w) => w.id === id);
  if (i >= 0) waitingQueue.splice(i, 1);
}

io.on("connection", (socket) => {
  // ---- Quick Match ----
  socket.on("qm:join", ({ nick }) => {
    removeFromQueue(socket.id);
    waitingQueue.push({ id: socket.id, nick: nick || "PLAYER" });

    // 매칭 가능?
    if (waitingQueue.length >= 2) {
      const a = waitingQueue.shift();
      const b = waitingQueue.shift();
      const roomId = genCode();
      rooms.set(roomId, {
        players: [a.id, b.id],
        nicks: { [a.id]: a.nick, [b.id]: b.nick },
      });
      io.to(a.id).emit("qm:found", {
        roomId,
        opponentNick: b.nick,
      });
      io.to(b.id).emit("qm:found", {
        roomId,
        opponentNick: a.nick,
      });
    } else {
      // 큐에 들어감 알림
      socket.emit("qm:queued");
    }
  });

  socket.on("qm:leave", () => {
    removeFromQueue(socket.id);
  });

  // ---- Create / Join Room (코드 매칭) ----
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

    // 방에서 나간 경우 정리(간단 정리; 남은 사람에게 알림만)
    for (const [rid, r] of rooms.entries()) {
      if (r.players.includes(socket.id)) {
        r.players = r.players.filter((id) => id !== socket.id);
        delete r.nicks[socket.id];
        const left = r.players[0];
        if (!left) {
          rooms.delete(rid);
        } else {
          io.to(left).emit("room:peer-left");
        }
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.use(express.json());

app.get("/health", (_, res) => res.status(200).send("OK"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/], methods: ["GET", "POST"] },
});

/** --------------------------
 *  룸 & 랜덤 매칭
 * -------------------------- */
const rooms = new Map(); // code -> {hostId, hostName, guestId?, guestName?}
const queue = [];         // [{id, nick}...]

function genCode(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function removeFromQueue(id) {
  const i = queue.findIndex((q) => q.id === id);
  if (i >= 0) queue.splice(i, 1);
}

io.on("connection", (socket) => {
  // --- 코드로 방 생성 ---
  socket.on("createRoom", ({ code, nick }) => {
    if (!code || !nick) return socket.emit("roomError", "Invalid request.");
    if (rooms.has(code)) return socket.emit("roomError", "Code already in use.");
    rooms.set(code, { hostId: socket.id, hostName: nick });
    socket.join(code);
    socket.emit("roomCreated", { code });
  });

  // --- 코드로 합류 ---
  socket.on("joinRoom", ({ code, nick }) => {
    const r = rooms.get(code);
    if (!r) return socket.emit("roomError", "Room not found.");
    if (r.guestId) return socket.emit("roomError", "Room is full.");
    r.guestId = socket.id;
    r.guestName = nick;
    socket.join(code);

    // 각자 시점으로 전송
    io.to(r.hostId).emit("roomJoined", { code, host: r.hostName });
    io.to(r.hostId).emit("startGame", { you: r.hostName, opp: r.guestName, code });
    io.to(r.guestId).emit("roomJoined", { code, host: r.hostName });
    io.to(r.guestId).emit("startGame", { you: r.guestName, opp: r.hostName, code });
  });

  // --- 랜덤 매칭 ---
  socket.on("quickMatch", ({ nick }) => {
    if (!nick) return socket.emit("roomError", "Invalid request.");

    // 이미 줄에 있으면 무시
    if (queue.some((q) => q.id === socket.id)) return;

    queue.push({ id: socket.id, nick });

    // 2명 이상이면 바로 매칭
    if (queue.length >= 2) {
      const a = queue.shift();
      const b = queue.shift();
      const code = genCode(); // 내부 전용 코드(프론트에는 보내지 않음)

      const room = { hostId: a.id, hostName: a.nick, guestId: b.id, guestName: b.nick };
      rooms.set(code, room);

      io.sockets.sockets.get(a.id)?.join(code);
      io.sockets.sockets.get(b.id)?.join(code);

      // 각자 시점 전달 (code는 프론트 표시용 X — 값 없이 보냄)
      io.to(a.id).emit("startGame", { you: a.nick, opp: b.nick });
      io.to(b.id).emit("startGame", { you: b.nick, opp: a.nick });
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    // 방 정리
    for (const [code, r] of rooms) {
      if (r.hostId === socket.id || r.guestId === socket.id) {
        rooms.delete(code);
        io.to(code).emit("roomError", "Opponent left.");
      }
    }
  });

  // 예시 채팅
  socket.on("chat", (msg) => io.emit("chat", msg));
});

httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

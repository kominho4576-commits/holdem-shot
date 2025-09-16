import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS (Netlify)
app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/,
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.use(express.json());

// Health check
app.get("/health", (_req, res) => res.status(200).send("OK"));

// HTTP + Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
    methods: ["GET", "POST"],
  },
});

/** In-memory state (hobby 용도)
 * rooms: { CODE: { host:{id,nick}, guest:{id,nick}|null } }
 * queue: [{id,nick}]
 */
const rooms = {};
let queue = [];

io.on("connection", (socket) => {
  // Quick Match
  socket.on("quickMatch", ({ nick }) => {
    // 이미 대기 중인 상대가 있으면 매칭
    const mate = queue.find(u => u.id !== socket.id);
    if (mate) {
      // 큐에서 제거
      queue = queue.filter(u => u.id !== mate.id);
      // 양쪽 시작 (코드 없음)
      io.to(socket.id).emit("startGame", { you: nick, opp: mate.nick, code: null });
      io.to(mate.id).emit("startGame", { you: mate.nick, opp: nick, code: null });
    } else {
      // 대기열에 추가
      queue.push({ id: socket.id, nick });
      // 일정 시간 지나면 서버가 정리 (프론트가 AI로 전환)
      setTimeout(() => {
        queue = queue.filter(u => u.id !== socket.id);
      }, 15000);
    }
  });

  // Create Room
  socket.on("createRoom", ({ code, nick }) => {
    if (!code) return socket.emit("errorMsg", "Invalid code");
    if (rooms[code]?.host) return socket.emit("errorMsg", "Code already in use");

    rooms[code] = { host: { id: socket.id, nick }, guest: null };
    socket.join(`room:${code}`);
  });

  // Join Room
  socket.on("joinRoom", ({ code, nick }) => {
    const r = rooms[code];
    if (!r || !r.host) return socket.emit("errorMsg", "Room not found");
    if (r.guest) return socket.emit("errorMsg", "Room is full");

    r.guest = { id: socket.id, nick };
    socket.join(`room:${code}`);

    // 양쪽 모두 시작
    io.to(r.host.id).emit("startGame", { you: r.host.nick, opp: r.guest.nick, code });
    io.to(r.guest.id).emit("startGame", { you: r.guest.nick, opp: r.host.nick, code });
  });

  // 정리
  socket.on("disconnect", () => {
    // quickMatch 큐에서 제거
    queue = queue.filter(u => u.id !== socket.id);

    // 방 정리
    for (const code of Object.keys(rooms)) {
      const r = rooms[code];
      if (!r) continue;
      if (r.host?.id === socket.id) {
        // 호스트 나감 → 방 삭제 & 게스트에게 알림
        if (r.guest?.id) io.to(r.guest.id).emit("roomClosed");
        delete rooms[code];
      } else if (r.guest?.id === socket.id) {
        // 게스트만 나감
        rooms[code].guest = null;
      }
    }
  });
});

// Start
httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

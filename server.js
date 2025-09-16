// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS (Netlify 프론트 허용)
app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app", // 네 사이트
      /\.netlify\.app$/,                // 기타 netlify 서브도메인 대응
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.use(express.json());

// 헬스체크
app.get("/health", (_, res) => res.status(200).send("OK"));

// HTTP + Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://holdemshot.netlify.app", /\.netlify\.app$/],
    methods: ["GET", "POST"],
  },
});

// ===== 간단 룸 매칭 =====
/*
  rooms: Map<code, {
    hostId, hostName,
    guestId?, guestName?
  }>
*/
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("createRoom", ({ code, nick }) => {
    if (!code || !nick) return socket.emit("roomError", "Invalid request.");
    if (rooms.has(code)) return socket.emit("roomError", "Code already in use.");
    rooms.set(code, { hostId: socket.id, hostName: nick });
    socket.join(code);
    socket.emit("roomCreated", { code });
  });

  socket.on("joinRoom", ({ code, nick }) => {
    const r = rooms.get(code);
    if (!r) return socket.emit("roomError", "Room not found.");
    if (r.guestId) return socket.emit("roomError", "Room is full.");

    r.guestId = socket.id;
    r.guestName = nick;
    socket.join(code);

    // 양쪽에 상태 알림
    io.to(r.hostId).emit("roomJoined", { code, host: r.hostName });
    io.to(r.guestId).emit("roomJoined", { code, host: r.hostName });

    // 둘 다 준비되면 시작
    io.to(code).emit("startGame", { you: r.hostName, opp: r.guestName, code });
  });

  socket.on("disconnect", () => {
    // 방 정리
    for (const [code, r] of rooms) {
      if (r.hostId === socket.id || r.guestId === socket.id) {
        rooms.delete(code);
        io.to(code).emit("roomError", "Opponent left.");
      }
    }
    console.log("socket disconnected:", socket.id);
  });

  // (예시) 채팅 브로드캐스트
  socket.on("chat", (msg) => {
    io.emit("chat", msg);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

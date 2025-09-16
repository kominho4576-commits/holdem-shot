// server.js
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Netlify에서 오는 요청 허용 (CORS)
app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app", // Netlify 프론트 주소
      /\.netlify\.app$/,                // (옵션) 다른 Netlify 서브도메인도 허용
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.use(express.json());

// 헬스체크 엔드포인트
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ✅ HTTP + Socket.IO 서버 통합
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/,
    ],
    methods: ["GET", "POST"],
  },
});

// 소켓 연결 이벤트
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });

  // 예시: 클라이언트에서 "chat" 이벤트 보내면 브로드캐스트
  socket.on("chat", (msg) => {
    console.log("Message:", msg);
    io.emit("chat", msg);
  });
});

// 서버 시작
httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

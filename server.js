import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3000;

// Netlify 프론트만 허용
app.use(
  cors({
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/ // 다른 서브도 허용 (옵션)
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.use(express.json());

app.get("/health", (req, res) => res.status(200).send("OK"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://holdemshot.netlify.app",
      /\.netlify\.app$/
    ],
    methods: ["GET", "POST"],
  },
});

// (추후) 매칭/룸 로직 붙일 자리
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Hold'em&SHOT server running on :${PORT}`);
});

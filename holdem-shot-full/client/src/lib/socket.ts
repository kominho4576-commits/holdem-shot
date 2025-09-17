import { io } from 'socket.io-client'

// 🌐 서버 주소
// Render 서버 주소로 교체하세요 (예: "https://holdem-shot-server.onrender.com")
// 로컬 테스트 시에는 "http://localhost:8080"
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'https://holdem-shot-server.onrender.com'

const socket = io(SERVER_URL, {
  transports: ['websocket'], // 안정적인 연결
  autoConnect: true,
})

export default socket

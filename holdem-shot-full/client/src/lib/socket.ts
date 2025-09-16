import { io, Socket } from 'socket.io-client'

const URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'

// Singleton socket
let socket: Socket | null = null

export function getSocket() {
  if (!socket) {
    socket = io(URL, { autoConnect: true, transports: ['websocket'] })
  }
  return socket
}

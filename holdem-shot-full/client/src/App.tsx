import React, { useState, useEffect } from 'react'
import socket from './lib/socket'
import Home from './pages/Home'
import Game from './pages/Game'

export default function App() {
  const [inGame, setInGame] = useState(false)
  const [connected, setConnected] = useState(false)

  // 소켓 연결 상태 감지
  useEffect(() => {
    socket.on('connect', () => {
      console.log('✅ Connected to server:', socket.id)
      setConnected(true)
    })
    socket.on('disconnect', () => {
      console.log('❌ Disconnected')
      setConnected(false)
    })

    return () => {
      socket.off('connect')
      socket.off('disconnect')
    }
  }, [])

  return (
    <div className="app-root">
      {!inGame ? (
        <Home onEnterGame={() => setInGame(true)} />
      ) : (
        <Game onExitGame={() => setInGame(false)} />
      )}

      {!connected && (
        <div className="overlay">
          <div className="overlay-box">
            <p>Connecting to server...</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Inline styles ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.app-root {
  width:100%;
  height:100dvh;
  overflow:hidden;
  font-family: system-ui, sans-serif;
}
.overlay {
  position:fixed; inset:0;
  display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,0.6);
  color:#fff;
  z-index:1000;
}
.overlay-box {
  background:#222;
  padding:20px 30px;
  border-radius:12px;
  font-size:18px;
}
`
document.head.appendChild(style)

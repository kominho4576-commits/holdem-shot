import React, { useState, useEffect } from 'react'
import socket from '../lib/socket'

export default function Home({ onEnterGame }: { onEnterGame: () => void }) {
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [serverOnline, setServerOnline] = useState(false)

  useEffect(() => {
    socket.on('server_status', (s) => setServerOnline(s.online))
    return () => {
      socket.off('server_status')
    }
  }, [])

  const handleQuickMatch = () => {
    if (nickname.trim()) {
      socket.emit('set_nickname', nickname)
    }
    socket.emit('quick_match', {}, (res: any) => {
      if (res.ok) onEnterGame()
    })
  }

  const handleCreateRoom = () => {
    if (nickname.trim()) {
      socket.emit('set_nickname', nickname)
    }
    socket.emit('create_room', {}, (res: any) => {
      if (res.ok) {
        setRoomCode(res.code)
      }
    })
  }

  const handleJoinRoom = () => {
    if (nickname.trim()) {
      socket.emit('set_nickname', nickname)
    }
    socket.emit('join_room', roomCode, (res: any) => {
      if (res.ok) onEnterGame()
      else alert('Room not found')
    })
  }

  return (
    <div className="home-root">
      <h1>Hold'em & SHOT</h1>

      <div className="input-group">
        <input
          type="text"
          placeholder="Enter nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>

      <div className="buttons">
        <button onClick={handleQuickMatch}>Quick Match</button>
        <button onClick={handleCreateRoom}>Create Room</button>
        <input
          type="text"
          placeholder="Room Code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
        />
        <button onClick={handleJoinRoom}>Join Room</button>
      </div>

      <div className="server-status">
        <span
          className="dot"
          style={{ background: serverOnline ? 'lime' : 'red' }}
        />
        <span>{serverOnline ? 'Online' : 'Offline'}</span>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    </div>
  )
}

/* ---------------- Inline styles ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.home-root {
  width:100%;
  height:100dvh;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  background:#111;
  color:#fff;
  font-family: system-ui, sans-serif;
  gap:16px;
}
h1 {
  font-size:28px;
  margin-bottom:12px;
}
.input-group input, .buttons input {
  padding:8px;
  border-radius:6px;
  border:none;
  margin:4px;
  text-align:center;
}
.buttons {
  display:flex;
  flex-direction:column;
  gap:8px;
}
button {
  padding:10px 14px;
  border:none;
  border-radius:6px;
  background:#444;
  color:#fff;
  font-size:16px;
}
button:hover { background:#666; }
.server-status {
  display:flex;
  align-items:center;
  gap:8px;
  margin-top:12px;
}
.dot {
  width:12px; height:12px;
  border-radius:50%;
}
`
document.head.appendChild(style)

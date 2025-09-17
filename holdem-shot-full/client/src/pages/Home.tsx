import React, { useState, useEffect } from 'react'
import socket from '../lib/socket'

export default function Home({ onEnterGame }: { onEnterGame: () => void }) {
  const [nickname, setNickname] = useState('')
  const [serverOnline, setServerOnline] = useState(false)
  const [roomCode, setRoomCode] = useState('')
  const [genCode, setGenCode] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // 서버 상태
  useEffect(() => {
    socket.on('server_status', (p: { online: boolean }) => setServerOnline(p.online))
    return () => {
      socket.off('server_status')
    }
  }, [])

  // 닉네임 전송
  const applyNickname = () => {
    const safe = nickname.trim()
    if (!safe) return
    socket.emit('set_nickname', safe)
  }

  // Quick Match
  const onQuick = () => {
    applyNickname()
    setStatusMsg('Connecting...')
    socket.emit('quick_match', {}, (res: any) => {
      if (res.ok) {
        setStatusMsg('Matched!')
        onEnterGame()
      } else {
        setStatusMsg('Error matching')
      }
    })
  }

  // Create Room
  const onCreate = () => {
    applyNickname()
    socket.emit('create_room', {}, (res: any) => {
      if (res.ok) {
        setGenCode(res.code)
        setStatusMsg('Room created: ' + res.code)
        onEnterGame()
      } else {
        setStatusMsg('Failed to create room')
      }
    })
  }

  // Join Room
  const onJoin = () => {
    applyNickname()
    if (!roomCode.trim()) return
    socket.emit('join_room', roomCode.trim(), (res: any) => {
      if (res.ok) {
        setStatusMsg('Joined room ' + roomCode.trim())
        onEnterGame()
      } else {
        setStatusMsg('Room not found')
      }
    })
  }

  return (
    <div className="home-root">
      <h1 className="title">Hold&apos;em &amp; Shot</h1>

      <div className="nick-row">
        <input
          type="text"
          placeholder="Enter nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>

      <div className="btn-row">
        <button onClick={onQuick}>Quick Match</button>
        <button onClick={onCreate}>Create Room</button>
      </div>

      <div className="join-row">
        <input
          type="text"
          placeholder="Enter code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        />
        <button onClick={onJoin}>Join Room</button>
      </div>

      <div className="server-indicator">
        <span
          className={`dot ${serverOnline ? 'on' : 'off'}`}
          title={serverOnline ? 'Online' : 'Offline'}
        />
        <span className="label">{serverOnline ? 'Online' : 'Offline'}</span>
        <button onClick={() => socket.emit('ping')}>Retry</button>
      </div>

      {statusMsg && <div className="status">{statusMsg}</div>}

      {genCode && (
        <div className="gen-code">
          Room Code: <b>{genCode}</b>
        </div>
      )}
    </div>
  )
}

/* ---------------- Inline styles (추가 가능) ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.home-root {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  height:100dvh;
  text-align:center;
  gap:20px;
}
.title {
  font-size: clamp(28px,6vw,52px);
  font-weight: 800;
  color:#6D58F0;
}
.nick-row input, .join-row input {
  padding:10px 14px;
  border:2px solid #b1a6ff;
  border-radius:12px;
  font-size:16px;
  width: clamp(200px,40vw,280px);
}
.btn-row, .join-row {
  display:flex;
  gap:10px;
}
.btn-row button, .join-row button {
  padding:10px 14px;
  border:2px solid #b1a6ff;
  border-radius:12px;
  background:#f5f3ff;
  color:#6D58F0;
  font-weight:700;
  cursor:pointer;
}
.server-indicator {
  display:flex; align-items:center; gap:10px;
}
.server-indicator .dot {
  width:14px; height:14px; border-radius:50%;
  background:#ff3b30;
}
.server-indicator .dot.on { background:#32d74b; }
.status { margin-top:10px; color:#6D58F0; font-weight:700; }
.gen-code { margin-top:10px; font-size:18px; color:#333; }
`
document.head.appendChild(style)

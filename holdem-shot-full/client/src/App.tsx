import React, { useState, useEffect } from 'react'
import socket from './lib/socket'
import Home from './pages/Home'
import Match from './pages/Match'
import Game from './pages/Game'
import Result from './pages/Result'

type Screen = 'home' | 'match' | 'game' | 'result'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    socket.on('connect', () => {
      console.log('✅ Connected to server:', socket.id)
      setConnected(true)
    })
    socket.on('disconnect', () => {
      console.log('❌ Disconnected')
      setConnected(false)
    })

    // 서버에서 결과 이벤트 받으면 결과 화면으로 이동
    socket.on('result', () => {
      setScreen('result')
    })

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('result')
    }
  }, [])

  return (
    <div className="app-root">
      {screen === 'home' && <Home onEnterGame={() => setScreen('match')} />}
      {screen === 'match' && <Match onEnterGame={() => setScreen('game')} />}
      {screen === 'game' && <Game onExitGame={() => setScreen('home')} />}
      {screen === 'result' && <Result onExitGame={() => setScreen('home')} />}

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

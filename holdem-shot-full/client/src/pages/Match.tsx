import React, { useEffect, useState } from 'react'
import socket from '../lib/socket'

export default function Match({ onEnterGame }: { onEnterGame: () => void }) {
  const [waiting, setWaiting] = useState(true)
  const [count, setCount] = useState(8) // 최대 8초 대기

  useEffect(() => {
    // 서버에서 매칭 시작 신호 받으면 게임으로 진입
    socket.on('state', () => {
      setWaiting(false)
      onEnterGame()
    })

    // 8초 카운트다운 → 안 잡히면 서버에서 AI 매칭됨
    const timer = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer)
        }
        return c - 1
      })
    }, 1000)

    return () => {
      socket.off('state')
      clearInterval(timer)
    }
  }, [onEnterGame])

  return (
    <div className="match-root">
      <h2>Connecting...</h2>
      <div className="spinner" />
      <p>{waiting ? `Searching players (${count}s)` : 'Match found!'}</p>
    </div>
  )
}

/* ---------------- Inline styles ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.match-root {
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
.spinner {
  width:40px; height:40px;
  border:4px solid #555;
  border-top:4px solid #0f0;
  border-radius:50%;
  animation:spin 1s linear infinite;
}
@keyframes spin {
  0% { transform:rotate(0deg); }
  100% { transform:rotate(360deg); }
}
`
document.head.appendChild(style)

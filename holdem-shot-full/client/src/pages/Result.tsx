import React, { useEffect, useState } from 'react'
import socket from '../lib/socket'

export default function Result({ onExitGame }: { onExitGame: () => void }) {
  const [winner, setWinner] = useState<string | null>(null)
  const [loser, setLoser] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('Unknown')
  const [count, setCount] = useState(5)

  useEffect(() => {
    socket.on('result', (res) => {
      setWinner(res.winnerId)
      setLoser(res.loserId)
      setReason(res.reason)
    })

    const timer = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(timer)
          onExitGame()
        }
        return c - 1
      })
    }, 1000)

    return () => {
      socket.off('result')
      clearInterval(timer)
    }
  }, [onExitGame])

  return (
    <div className="result-root">
      <h1>{winner === socket.id ? 'Victory!' : 'Defeat'}</h1>
      <p>Reason: {reason}</p>
      <p>Returning to home in {count}s...</p>
    </div>
  )
}

/* ---------------- Inline styles ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.result-root {
  width:100%;
  height:100dvh;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  background:#000;
  color:#fff;
  font-family: system-ui, sans-serif;
}
.result-root h1 {
  font-size:36px;
  margin-bottom:12px;
}
.result-root p {
  font-size:18px;
}
`
document.head.appendChild(style)

import React, { useState, useEffect } from 'react'
import socket from '../lib/socket'

interface Player {
  id: string
  nickname: string
  hearts: number
  private: string[]
  hasJoker: boolean
  ready: boolean
}

export default function Game({ onExitGame }: { onExitGame: () => void }) {
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [board, setBoard] = useState<string[]>([])
  const [phase, setPhase] = useState<string>('WAIT')
  const [round, setRound] = useState<number>(1)
  const [myId, setMyId] = useState<string | null>(null)
  const [roulette, setRoulette] = useState<any>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    setMyId(socket.id)

    socket.on('state', (s) => {
      setPlayers(s.players)
      setBoard(s.board)
      setPhase(s.phase)
      setRound(s.round)
      setRoulette(null)
      setCountdown(null)
    })

    socket.on('roulette', (r) => {
      setRoulette(r)
      // 5초 카운트 후 자동 실행
      let c = 5
      setCountdown(c)
      const timer = setInterval(() => {
        c--
        if (c <= 0) {
          clearInterval(timer)
          setCountdown(null)
          // 클라이언트는 단순히 "돌아가는 UI"만 보여줌
        } else {
          setCountdown(c)
        }
      }, 1000)
    })

    socket.on('result', (res) => {
      alert(res.message)
      onExitGame()
    })

    return () => {
      socket.off('state')
      socket.off('roulette')
      socket.off('result')
    }
  }, [onExitGame])

  // 현재 턴 표시 (간단히: ready=false인 사람에게 불 켜기)
  const currentTurn = Object.values(players).find((p) => !p.ready)?.id

  return (
    <div className="game-root">
      <header>
        <h2>Round {round}</h2>
        <p>Phase: {phase}</p>
      </header>

      <section className="players">
        {Object.values(players).map((p) => (
          <div key={p.id} className="player">
            <span
              className="nickname"
              style={{ color: p.id === currentTurn ? 'lime' : 'white' }}
            >
              {p.nickname}
            </span>
            <span className="hearts">❤️ {p.hearts}</span>
          </div>
        ))}
      </section>

      <section className="board">
        <div className="cards">
          {board.map((c, i) => (
            <div key={i} className="card">{c}</div>
          ))}
        </div>
      </section>

      {roulette && (
        <section className="roulette">
          <div className="arrow">▼</div>
          <div className="chambers">
            {roulette.chambers.map((b: number, i: number) => (
              <div
                key={i}
                className={`slot ${i === roulette.top ? 'active' : ''}`}
              >
                {b === 1 ? '●' : '○'}
              </div>
            ))}
          </div>
          {countdown !== null && <p className="count">Spinning in {countdown}s</p>}
          {!countdown && <p>{roulette.text}</p>}
        </section>
      )}

      <footer>
        <button onClick={() => socket.emit('ready')}>Ready</button>
        <button
          onClick={() => {
            if (window.confirm('Really surrender?')) {
              socket.emit('surrender')
            }
          }}
        >
          Surrender
        </button>
      </footer>
    </div>
  )
}

/* ---------------- Inline styles ---------------- */
const style = document.createElement('style')
style.innerHTML = `
.game-root {
  width:100%;
  height:100dvh;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  background:#0b0b0b;
  color:#fff;
  text-align:center;
}
header { padding:10px; }
.players {
  display:flex;
  justify-content:space-around;
  margin:10px 0;
}
.nickname { font-weight:bold; margin-right:10px; }
.hearts { font-size:18px; }
.board .cards {
  display:flex;
  justify-content:center;
  gap:6px;
  margin:10px 0;
}
.card {
  width:40px; height:60px;
  border:1px solid #fff;
  display:flex; align-items:center; justify-content:center;
  background:#222;
}
.roulette {
  margin:20px auto;
}
.arrow {
  font-size:24px;
  margin-bottom:6px;
}
.chambers {
  display:flex;
  justify-content:center;
  gap:12px;
}
.slot {
  width:30px; height:30px;
  border:2px solid #888;
  border-radius:50%;
  display:flex; align-items:center; justify-content:center;
}
.slot.active { border-color:red; }
.count { color:orange; font-weight:bold; }
footer { padding:10px; }
button {
  margin:5px; padding:8px 12px;
  border:none; border-radius:6px;
  background:#444; color:#fff;
}
button:hover { background:#666; }
`
document.head.appendChild(style)

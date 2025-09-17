import React, { useEffect, useMemo, useState } from 'react'
import socket from '../lib/socket' // 경로: src/lib/socket.ts 에서 default export (io(...))

type PlayerView = {
  id: string
  nickname: string
  hearts: number
  private: string[]
  ready: boolean
  hasJoker?: boolean
}
type ServerState = {
  roomId: string
  phase: 'DEAL' | 'FLOP' | 'EX1' | 'TURN' | 'EX2' | 'RIVER' | 'EX3' | 'COMPARE' | 'ROULETTE' | 'RESULT' | string
  round: number
  board: string[]
  players: Record<string, PlayerView>
  turn?: string | null
  isAI?: boolean
}

const suitGlyph = (c: string) => {
  const s = c?.[1]
  if (s === 'S') return '♠'
  if (s === 'H') return '♥'
  if (s === 'D') return '♦'
  if (s === 'C') return '♣'
  return ''
}
const rankGlyph = (c: string) => (c?.startsWith('JK') ? 'Joker' : c?.[0] || '')

function Card({
  value,
  faceUp,
  selected,
  onClick,
}: {
  value?: string
  faceUp?: boolean
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`hs-card ${faceUp ? 'up' : 'down'} ${selected ? 'sel' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {faceUp && value ? (
        <div className="hs-card-face">
          <span className="rank">{rankGlyph(value)}</span>
          <span className="suit">{suitGlyph(value)}</span>
        </div>
      ) : (
        <div className="hs-card-back" />
      )}
    </div>
  )
}

function NameBadge({
  name,
  active,
  align = 'left',
}: {
  name: string
  active?: boolean
  align?: 'left' | 'right'
}) {
  return (
    <div className={`name-badge ${align}`}>
      <span>{name || 'PLAYER'}</span>
      <span className={`dot ${active ? 'on' : ''}`} />
    </div>
  )
}

/** Roulette (visual only; 결과는 서버에서 push) */
function Roulette({
  show,
  countdown,
  lastSpin,
}: {
  show: boolean
  countdown: number | null
  lastSpin?: { chambers: number[]; top: number }
}) {
  if (!show) return null

  // 크기/간격: 겹침 방지
  const N = 6
  const radiusPct = 38 // 슬롯 궤도 반지름 (%)
  const slotPx = 42 // 슬롯 지름(px)

  const slots = Array.from({ length: N }).map((_, i) => {
    const ang = (360 / N) * i - 90 // 위에서 시작 (시계 방향)
    const x = 50 + radiusPct * Math.cos((ang * Math.PI) / 180)
    const y = 50 + radiusPct * Math.sin((ang * Math.PI) / 180)
    return { x, y }
  })

  return (
    <div className="roulette-wrap">
      <div className="roulette">
        {/* 포인터 ▼ */}
        <div className="pointer">▼</div>
        {/* 큰 원 */}
        <div className="wheel" />
        {/* 슬롯 6개 */}
        {slots.map((p, i) => (
          <div
            key={i}
            className={`slot ${lastSpin && lastSpin.top === i ? 'top' : ''}`}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: slotPx,
              height: slotPx,
            }}
          />
        ))}
        {/* 카운트다운 */}
        {countdown !== null && (
          <div className="rr-countdown" aria-live="polite">
            {countdown}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Game() {
  const [meId, setMeId] = useState<string | null>(socket.id || null)
  const [state, setState] = useState<ServerState | null>(null)
  const [opponentId, setOpponentId] = useState<string | null>(null)

  const [mySelect, setMySelect] = useState<number[]>([])
  const [rrCountdown, setRrCountdown] = useState<number | null>(null)
  const [lastRoulette, setLastRoulette] = useState<{ chambers: number[]; top: number } | null>(null)

  // socket.id 는 connect 이후 할당됨
  useEffect(() => {
    const onConnect = () => setMeId(socket.id)
    socket.on('connect', onConnect)
    return () => socket.off('connect', onConnect)
  }, [])

  // 서버 이벤트
  useEffect(() => {
    const onState = (s: ServerState) => {
      setState(s)
      // 상대 id 추정
      if (meId) {
        const ids = Object.keys(s.players || {})
        const opp = ids.find((i) => i !== meId) || null
        setOpponentId(opp)
      }
    }
    const onCountdown = ({ seconds }: { seconds: number }) => setRrCountdown(seconds)
    const onRoulette = (p: { chambers: number[]; top: number }) => {
      setLastRoulette({ chambers: p.chambers, top: p.top })
      setRrCountdown(null)
    }
    const onResult = () => {
      setRrCountdown(null)
      setLastRoulette(null)
      setMySelect([])
    }

    socket.on('state', onState)
    socket.on('roulette_countdown', onCountdown)
    socket.on('roulette', onRoulette)
    socket.on('result', onResult)

    return () => {
      socket.off('state', onState)
      socket.off('roulette_countdown', onCountdown)
      socket.off('roulette', onRoulette)
      socket.off('result', onResult)
    }
  }, [meId])

  const me = useMemo<PlayerView | null>(() => {
    if (!state || !meId) return null
    return state.players?.[meId] || null
  }, [state, meId])

  const opp = useMemo<PlayerView | null>(() => {
    if (!state || !opponentId) return null
    return state.players?.[opponentId] || null
  }, [state, opponentId])

  const phaseLabel = useMemo(() => {
    const p = state?.phase
    if (!p) return 'Dealing'
    if (p === 'EX1' || p === 'EX2' || p === 'EX3') return 'Exchange'
    if (p === 'COMPARE') return 'Compare'
    if (p === 'ROULETTE') return 'Roulette'
    if (p === 'RESULT') return 'Result'
    if (p === 'DEAL') return 'Dealing'
    if (p === 'TURN') return 'Turn'
    if (p === 'RIVER') return 'River'
    if (p === 'FLOP') return 'Flop'
    return p
  }, [state?.phase])

  const isMyTurn = state?.turn && meId ? state.turn === meId : false
  const canSelect =
    state?.phase && state.phase.startsWith('EX') && me && !me.ready

  // 카드 선택 (최대 2장)
  const toggleSelect = (idx: number) => {
    if (!canSelect) return
    setMySelect((prev) => {
      const has = prev.includes(idx)
      const next = has ? prev.filter((i) => i !== idx) : [...prev, idx]
      return next.slice(0, 2)
    })
  }

  // Ready (선택된 카드 교환 요청)
  const onReady = () => {
    if (!canSelect) return
    socket.emit('select_exchange', mySelect)
    socket.emit('ready')
  }

  // Surrender
  const onSurrender = () => {
    if (confirm('Are you sure you want to surrender?')) {
      socket.emit('surrender')
    }
  }

  // UI 렌더
  return (
    <div className="game-root">
      {/* 좌측 상단 Phase / Round */}
      <div className="phase-bar">
        <div className="phase">Phase: {phaseLabel}</div>
        <div className="round">Round {state?.round ?? 1}</div>
      </div>

      {/* 상대 플레이어 이름(우측 상단), 초록불 */}
      <div className="opponent-name">
        <NameBadge
          name={opp?.nickname || 'PLAYER2'}
          active={state?.turn === opponentId}
          align="right"
        />
      </div>

      {/* 좌: 상대 개인 카드(뒷면), 공유 5장, 내 카드(앞면) */}
      <div className="board-area">
        {/* 상대 개인카드 (뒷면 두 장) */}
        <div className="peer-hand">
          <Card />
          <Card />
        </div>

        {/* 공유 카드 5 */}
        <div className="community">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card
              key={i}
              faceUp={!!state?.board?.[i]}
              value={state?.board?.[i]}
            />
          ))}
        </div>

        {/* 내 개인카드 (앞면 두 장) */}
        <div className="my-hand">
          <Card
            faceUp
            value={me?.private?.[0]}
            selected={mySelect.includes(0)}
            onClick={() => toggleSelect(0)}
          />
          <Card
            faceUp
            value={me?.private?.[1]}
            selected={mySelect.includes(1)}
            onClick={() => toggleSelect(1)}
          />
        </div>

        {/* Ready / Surrender */}
        <div className="actions">
          <button
            className="btn"
            disabled={!canSelect}
            onClick={onReady}
            aria-disabled={!canSelect}
          >
            Ready {me?.ready ? '(✓)' : ''}
          </button>
          <button className="btn ghost" onClick={onSurrender}>
            Surrender
          </button>
        </div>

        {/* 내 닉네임 + 초록불 */}
        <div className="me-name">
          <NameBadge name={me?.nickname || 'PLAYER1'} active={isMyTurn} />
        </div>
      </div>

      {/* 우: 룰렛 */}
      <div className="divider" />
      <div className="roulette-area">
        <Roulette
          show={state?.phase === 'ROULETTE'}
          countdown={rrCountdown}
          lastSpin={lastRoulette || undefined}
        />
      </div>
    </div>
  )
}

/* ----------------- Inline minimal styles -----------------
   프로젝트 전역 styles.css 에 옮겨도 됩니다.
*/
const style = document.createElement('style')
style.innerHTML = `
.game-root{
  height: 100dvh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 1px minmax(340px, 42vw);
  column-gap: clamp(12px, 2.5vw, 32px);
  padding: clamp(10px, 2.2vw, 24px);
  box-sizing: border-box;
}

.phase-bar{ position:absolute; left:clamp(12px,2vw,24px); top:clamp(10px,1.5vw,18px); }
.phase{ font-weight:700; color: #6D58F0; font-size: clamp(18px,2.6vw,22px); }
.round{ margin-top:6px; color:#6D58F0; opacity:.85; font-size: clamp(14px,2vw,16px); }

.opponent-name{ position:absolute; right: calc(42vw + 24px); top: clamp(14px, 2vw, 20px); }
.me-name{ position:absolute; left: clamp(12px,2vw,24px); bottom: clamp(10px, 2vw, 18px); }

.name-badge{ display:flex; align-items:center; gap:8px; font-weight:700; color:#6D58F0; }
.name-badge.right{ justify-content:flex-end; }
.name-badge .dot{ width:.7em; height:.7em; border-radius:50%; background:#32d74b; opacity:0; transition:.2s; }
.name-badge .dot.on{ opacity:1; }

.board-area{ position: relative; }
.peer-hand{ position:absolute; left: clamp(12px, 4vw, 64px); top: clamp(64px, 12vh, 120px); display:flex; gap: clamp(10px, 1.8vw, 16px); }
.community{
  position:absolute; left: clamp(12px, 8vw, 120px); right: clamp(12px, 10vw, 160px);
  top: clamp(220px, 34vh, 320px); display:flex; gap: clamp(10px, 1.8vw, 16px); justify-content:center;
}
.my-hand{ position:absolute; left: 0; right: clamp(12px, 10vw, 160px); bottom: clamp(64px, 10vh, 120px); display:flex; gap: clamp(12px, 2vw, 20px); justify-content:center; }

.actions{
  position:absolute; left: clamp(12px, 4vw, 64px); bottom: clamp(20px, 6vh, 64px);
  display:flex; gap: 10px;
}
.btn{
  padding: 10px 14px; border:2px solid #b1a6ff; border-radius: 12px; background: #f5f3ff;
  color:#6D58F0; font-weight:700; cursor:pointer;
}
.btn[disabled], .btn[aria-disabled="true"]{ opacity:.6; cursor:not-allowed; }
.btn.ghost{ background: #ffffff; }

.divider{ background: rgba(109,88,240,.35); }

.roulette-area{ position: relative; display:flex; align-items:center; justify-content:center; }
.roulette-wrap{ position:relative; width: min(480px, 90%); aspect-ratio: 1/1; }
.roulette{
  position:absolute; inset:0; border-radius:50%;
}
.pointer{
  position:absolute; top: -14px; left: 50%; transform: translateX(-50%); color:#6D58F0; font-size: 18px; font-weight:900;
}
.wheel{
  position:absolute; inset:0; border: 6px solid #b1a6ff; border-radius:50%;
}
.slot{
  position:absolute; transform: translate(-50%, -50%);
  border: 4px solid #b1a6ff; border-radius: 9999px; background: #fff;
}
.slot.top{ box-shadow: 0 0 0 3px rgba(109,88,240,.25); }
.rr-countdown{
  position:absolute; right: 6%; top: 10%;
  font-weight: 800; font-size: clamp(28px, 5.5vw, 56px); color:#6D58F0; opacity:.9;
}

/* 카드 */
.hs-card{
  width: clamp(74px, 9vw, 96px);
  height: clamp(108px, 13.5vw, 144px);
  border-radius: 14px;
  border: 4px solid #b1a6ff;
  background: #ffffff;
  display:flex; align-items:center; justify-content:center;
  user-select:none;
}
.hs-card.down .hs-card-back{
  width: 84%; height: 84%;
  background: repeating-linear-gradient(135deg, #c5bcff 0 6px, #efeaff 6px 12px);
  border-radius: 10px;
}
.hs-card.up .hs-card-face{
  text-align:center; font-weight:800; color:#6D58F0;
}
.hs-card.up .rank{ display:block; font-size: clamp(20px, 2.4vw, 26px); }
.hs-card.up .suit{ display:block; font-size: clamp(16px, 2vw, 22px); opacity:.9; }
.hs-card.sel{ box-shadow: 0 0 0 4px rgba(109,88,240,.35) inset; }
`
document.head.appendChild(style)

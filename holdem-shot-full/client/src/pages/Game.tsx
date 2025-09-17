import { useEffect, useMemo, useState } from 'react'
import { Card, CardBack, CardRow } from '../components/Cards'
import Roulette from '../components/Roulette'
import { getSocket } from '../lib/socket'
import { useStore } from '../state/store'
import { GameStatePayload, Phase, ComparePayload, RoulettePayload } from '../state/gameTypes'

export default function Game() {
  const { myId, game, lastCompare, lastRoulette } = useStore(s=>({
    myId:s.myId, game:s.game, lastCompare:s.lastCompare, lastRoulette:s.lastRoulette
  }))
  const setGame = useStore(s=>s.setGame)
  const setCompare = useStore(s=>s.setCompare)
  const setRoulette = useStore(s=>s.setRoulette)
  const setResult = useStore(s=>s.setResult)
  const setRoute = useStore(s=>s.setRoute)
  const resetRoundVisuals = useStore(s=>s.resetRoundVisuals)

  const [sel, setSel] = useState<number[]>([])
  const [opBlink, setOpBlink] = useState(false)
  const [rrCount, setRrCount] = useState<number|null>(null)

  const me = game ? game.players[myId] : undefined
  const oppId = game ? Object.keys(game.players).find(id=>id!==myId) : undefined
  const opp = oppId ? game!.players[oppId] : undefined

  useEffect(()=>{
    const sock = getSocket()
    const onState = (payload: GameStatePayload) => {
      setGame(payload); setSel([]); resetRoundVisuals(); setOpBlink(false)
      // 룰렛 단계에 들어오면 카운트다운 시작
      if (payload.phase === 'ROULETTE') {
        setRrCount(5)
      } else {
        setRrCount(null)
      }
    }
    const onCompare = (p: ComparePayload) => setCompare(p)
    const onRoulette = (p: RoulettePayload) => setRoulette(p)
    const onResult = (p:any) => { setResult(p); setRoute('result') }
    const onPeerHint = () => { setOpBlink(true); setTimeout(()=>setOpBlink(false), 600) }

    sock.on('state', onState)
    sock.on('compare', onCompare)
    sock.on('roulette', onRoulette)
    sock.on('result', onResult)
    sock.on('peer_exchange_hint', onPeerHint)
    return ()=>{ sock.off('state', onState); sock.off('compare', onCompare); sock.off('roulette', onRoulette); sock.off('result', onResult); sock.off('peer_exchange_hint', onPeerHint) }
  }, [resetRoundVisuals, setCompare, setGame, setResult, setRoute, setRoulette])

  // 5초 카운트 후 서버에 룰렛 시작 요청
  useEffect(()=>{
    if (rrCount==null) return
    if (rrCount > 0) {
      const t = setTimeout(()=> setRrCount(rrCount-1), 1000)
      return ()=> clearTimeout(t)
    }
    // 0이 되면 신호 보냄
    getSocket().emit('roulette_start')
  }, [rrCount])

  if (!game || !me || !opp) return null

  const phaseText = phaseLabel(game.phase)
  const roundText = `Round ${game.round}`

  const toggleSel = (i:number) => {
    if (!game.phase.startsWith('EX')) return
    setSel(prev=>{
      const has = prev.includes(i)
      const next = has ? prev.filter(x=>x!==i) : [...prev, i].slice(0,2)
      getSocket().emit('select_exchange', next)
      return next
    })
  }

  const clickReady = () => getSocket().emit('ready')

  const surrender = () => {
    if (confirm('Are you sure you want to surrender?')) getSocket().emit('surrender')
  }

  // Roulette flash color
  const flash = (() => {
    if (!lastRoulette || !lastCompare) return 'none'
    const iLost = lastCompare.loserId === myId
    if (lastRoulette.text === 'BANG!') return iLost ? 'red' : 'white'
    return 'none'
  })() as 'none'|'red'|'white'

  const readyCount = Object.values(game.players).filter(p=>p.ready).length

  // 현재 차례: 서버 activeId가 있으면 사용, 없으면 EX-Phase에서 아직 ready가 아닌 쪽
  const activeId = game.activeId || (
    game.phase.startsWith('EX')
      ? Object.values(game.players).find(p=>!p.ready)?.id
      : undefined
  )
  const meActive = activeId === me.id
  const oppActive = activeId === opp.id

  return (
    <div className="screen game-layout">
      {/* Left: Hold'em */}
      <div className="holdem">
        <div className="phase">{`Phase: ${phaseText}`}</div>
        <div className="round">{roundText}</div>

        {/* Opponent name + indicator */}
        <div className="name-row right">
          <span className="name">{opp.nickname || 'PLAYER2'}</span>
          {oppActive && <span className="green-dot" />}
        </div>

        {/* Opponent hidden hand at top-left (두 장, 룰렛 영역에서 제거) */}
        <div className="op-hand">
          <CardBack />
          <CardBack />
          {opBlink && <div className="blink-hint" />}
        </div>

        {/* Board */}
        <div className="board">
          <CardRow>
            {/* (상단 가운데에 상대 카드 두 장이 보이지 않게: 여기선 숨김) */}
          </CardRow>
          <CardRow>
            {Array.from({length:5}).map((_,i)=> (
              game.board[i] ? <Card key={i} face={game.board[i]} /> : <CardBack key={i} />
            ))}
          </CardRow>
        </div>

        {/* My hand */}
        <div className="hand">
          <CardRow>
            <Card face={me.private[0]} selected={sel.includes(0)} onClick={()=>toggleSel(0)} />
            <Card face={me.private[1]} selected={sel.includes(1)} onClick={()=>toggleSel(1)} />
          </CardRow>
        </div>

        {/* Buttons */}
        <div className="buttons">
          <button className="btn" onClick={clickReady} disabled={!game.phase.startsWith('EX')}>{`Ready ${readyCount}/2`}</button>
          <button className="btn ghost" onClick={surrender}>Surrender</button>
        </div>

        {/* My name + indicator */}
        <div className="name-row">
          <span className="name">{me.nickname || 'PLAYER1'}</span>
          {meActive && <span className="green-dot" />}
        </div>
      </div>

      {/* Right: Roulette (자동 카운트다운) */}
      <div className="roulette-side">
        <Roulette data={lastRoulette} flash={flash} countdown={rrCount} />
      </div>
    </div>
  )
}

function phaseLabel(p: Phase) {
  switch (p) {
    case 'DEAL': return 'Dealing'
    case 'FLOP': return 'Flop'
    case 'EX1': return 'Exchange'
    case 'TURN': return 'Turn'
    case 'EX2': return 'Exchange'
    case 'RIVER': return 'River'
    case 'EX3': return 'Exchange'
    case 'COMPARE': return 'Compare'
    case 'ROULETTE': return 'Roulette'
    case 'RESULT': return 'Result'
    default: return p
  }
}

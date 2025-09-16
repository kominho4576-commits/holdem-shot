import { useEffect } from 'react'
import { useStore } from '../state/store'

export default function Result() {
  const res = useStore(s=>s.lastResult)
  const myId = useStore(s=>s.myId)
  const setRoute = useStore(s=>s.setRoute)
  const setGame = useStore(s=>s.setGame)
  const setCompare = useStore(s=>s.setCompare)
  const setRoulette = useStore(s=>s.setRoulette)

  const iWon = res ? res.winnerId === myId : false

  useEffect(()=>{
    const t = setTimeout(()=>{
      // back to home & clear state for next match
      setGame(undefined); setCompare(undefined); setRoulette(undefined)
      setRoute('home')
    }, 5000)
    return ()=> clearTimeout(t)
  }, [setCompare, setGame, setRoute, setRoulette])

  return (
    <div className="screen center-col">
      <h1 className="title">{iWon ? 'Victory' : 'Defeat'}</h1>
      <div className="panel">
        <div>Winner: {res?.winnerId?.startsWith('BOT_') ? 'AI' : 'Player'}</div>
        <div>Loser: {res?.loserId?.startsWith('BOT_') ? 'AI' : 'Player'}</div>
      </div>
    </div>
  )
}

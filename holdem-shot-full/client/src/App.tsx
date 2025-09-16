import { useEffect } from 'react'
import { useStore } from './state/store'
import Home from './pages/Home'
import Match from './pages/Match'
import Game from './pages/Game'
import Result from './pages/Result'
import { getSocket } from './lib/socket'

export default function App() {
  const route = useStore(s=>s.route)
  const setMyId = useStore(s=>s.setMyId)

  // track socket id changes
  useEffect(()=>{
    const s = getSocket()
    const onConnect = () => setMyId(s.id)
    s.on('connect', onConnect)
    if (s.connected) onConnect()
    return ()=> s.off('connect', onConnect)
  }, [setMyId])

  return (
    <>
      {route==='home' && <Home/>}
      {route==='match' && <Match/>}
      {route==='game' && <Game/>}
      {route==='result' && <Result/>}
    </>
  )
}

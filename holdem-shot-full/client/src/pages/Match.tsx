import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { getSocket } from '../lib/socket'

export default function Match() {
  const [left, setLeft] = useState(8)
  const setRoute = useStore(s=>s.setRoute)

  useEffect(()=>{
    const t = setInterval(()=> setLeft(v => Math.max(0, v-1)), 1000)
    return ()=> clearInterval(t)
  }, [])

  useEffect(()=>{
    const sock = getSocket()
    const onState = (payload:any) => {
      useStore.getState().setGame(payload)
      setRoute('game')
    }
    sock.on('state', onState)
    return ()=> sock.off('state', onState)
  }, [setRoute])

  return (
    <div className="screen center-col">
      <h1 className="title">Hold’em&Shot.io</h1>
      <div className="panel match">
        <div className="spinner" />
        <div className="match-text">Connecting...{left}s</div>
      </div>
    </div>
  )
}

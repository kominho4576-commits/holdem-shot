import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'
import { useStore } from '../state/store'
import ServerIndicator from '../components/ServerIndicator'

function sixCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)]
  return s
}

export default function Home() {
  const [joinCode, setJoinCode] = useState('')
  const [createdCode, setCreatedCode] = useState('')
  const [connecting, setConnecting] = useState(false)

  const nickname = useStore(s=>s.nickname)
  const setNickname = useStore(s=>s.setNickname)
  const setRoute = useStore(s=>s.setRoute)
  const setGame = useStore(s=>s.setGame)
  const setServerOnline = useStore(s=>s.setServerOnline)

  // 저장된 닉네임 로드
  useEffect(()=>{
    const saved = localStorage.getItem('hs_nick') || ''
    if (saved) {
      setNickname(saved)
      getSocket().emit('set_nickname', saved)
    }
  }, [setNickname])

  useEffect(()=>{
    const sock = getSocket()
    const onConnect = () => {
      useStore.getState().setMyId(sock.id)
      setServerOnline(true)
      // 접속 시점에 닉네임 다시 전송 (모바일 사파리에서 blur 누락 방지)
      const name = (useStore.getState().nickname || '').trim()
      sock.emit('set_nickname', name)
    }
    const onDisconnect = () => setServerOnline(false)
    const onState = (payload:any) => { setGame(payload); setRoute('game') }
    const onServer = (p:any) => setServerOnline(!!p?.online)

    sock.on('connect', onConnect)
    sock.on('disconnect', onDisconnect)
    sock.on('state', onState)
    sock.on('server_status', onServer)
    if (sock.connected) onConnect()
    return ()=>{ sock.off('connect', onConnect); sock.off('disconnect', onDisconnect); sock.off('state', onState); sock.off('server_status', onServer) }
  }, [setGame, setRoute, setServerOnline])

  const applyName = (value: string) => {
    const name = value.trim().slice(0,16)
    setNickname(name)
    localStorage.setItem('hs_nick', name)
    getSocket().emit('set_nickname', name)
  }

  const quickMatch = () => {
    applyName(nickname)
    setConnecting(true)
    setRoute('match')
    getSocket().emit('quick_match', {}, () => {})
  }

  const createRoom = () => {
    applyName(nickname)
    const code = sixCode()
    getSocket().emit('create_room', {}, (res:any)=>{
      const c = res?.code || code
      setCreatedCode(c)
    })
  }

  const joinRoom = () => {
    if (!joinCode) return
    applyName(nickname)
    getSocket().emit('join_room', joinCode.trim().toUpperCase(), (res:any)=>{
      if (!res?.ok) alert('Room not found')
    })
    setRoute('match')
  }

  return (
    <div className="screen center-col">
      <h1 className="title">Hold’em&Shot.io</h1>

      <div className="panel">
        <div className="row">
          <input
            className="input"
            placeholder="Nickname"
            value={nickname}
            onChange={e=>applyName(e.target.value)}
            maxLength={16}
          />
          <button className="btn" onClick={quickMatch} disabled={connecting}>Quick Match</button>
        </div>

        <div className="row">
          <button className="btn" onClick={createRoom}>Create Room</button>
          <input className="input" placeholder={createdCode ? createdCode : ''} value={createdCode} readOnly />
        </div>

        <div className="row">
          <input className="input" placeholder="Enter Room Code" value={joinCode} onChange={e=>setJoinCode(e.target.value)} />
          <button className="btn" onClick={joinRoom}>Join Room</button>
        </div>
      </div>

      <ServerIndicator />
      <div className="orientation-hint">Rotate to landscape</div>
    </div>
  )
}

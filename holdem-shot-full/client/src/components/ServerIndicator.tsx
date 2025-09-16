import { useStore } from '../state/store'
import { getSocket } from '../lib/socket'

export default function ServerIndicator() {
  const online = useStore(s => s.serverOnline)

  const ping = async () => {
    try {
      const base = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
      const res = await fetch(`${base}/health`)
      const ok = res.ok
      useStore.getState().setServerOnline(ok)
      // also try reconnect socket
      const sock = getSocket()
      if (!sock.connected) sock.connect()
    } catch {
      useStore.getState().setServerOnline(false)
    }
  }

  return (
    <div className="server-indicator">
      <span className={`dot ${online ? 'on' : 'off'}`} />
      <span>Server</span>
      <button className="linkish" onClick={ping}>↻</button>
    </div>
  )
}

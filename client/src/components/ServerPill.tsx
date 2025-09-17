import { useEffect, useState } from "react";
import { pingServer, socket } from "../lib/socket";

export default function ServerPill() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [ts, setTs] = useState<number>(0);

  async function refresh() {
    const alive = await pingServer();
    setOk(alive);
    setTs(Date.now());
    if (alive) socket.emit("server:ping");
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="server-pill">
      <div className={`dot ${ok ? "ok" : ""}`} />
      <span className="light">Server</span>
      <span className="small link" onClick={refresh}>&nbsp;↻</span>
    </div>
  );
}

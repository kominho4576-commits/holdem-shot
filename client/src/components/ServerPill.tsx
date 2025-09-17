import { useEffect, useState } from "react";
import { pingServer, socket } from "../lib/socket";

export default function ServerPill() {
  const [ok, setOk] = useState<boolean | null>(null);

  async function refresh() {
    // fetch(/health) 성공 OR socket.connected 둘 중 하나라도 true면 초록불
    const alive = await pingServer();
    const socketOk = socket.connected;
    setOk(alive || socketOk);
    if (!socket.connected) socket.connect();
    else socket.emit("server:ping");
  }

  useEffect(() => {
    refresh();
    const onConnect = () => setOk(true);
    const onDisconnect = () => setOk(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return (
    <div className="server-pill" onClick={refresh} title="Refresh">
      <div className={`dot ${ok ? "ok" : ""}`} />
      <span className="light">Server</span>
      <span className="small link">&nbsp;↻</span>
    </div>
  );
}

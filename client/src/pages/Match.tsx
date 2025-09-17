import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket, type MatchStarted } from "../lib/socket";

export default function Match() {
  const nav = useNavigate();
  const [sec, setSec] = useState(8);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    timer.current = window.setInterval(() => {
      setSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    const onStarted = (p: MatchStarted) => {
      nav("/game", { replace: true, state: p });
    };
    socket.on("match:started", onStarted);
    return () => { socket.off("match:started", onStarted); };
  }, [nav]);

  return (
    <div className="center-col">
      <div className="h1">Hold’em&Shot.io</div>
      <div className="card center">
        <div className="spinner" />
        <div className="big">Connecting...{sec}s</div>
      </div>
    </div>
  );
}

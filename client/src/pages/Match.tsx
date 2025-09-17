import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket, type MatchStarted } from "../lib/socket";

export default function Match() {
  const nav = useNavigate();
  const [sec, setSec] = useState(8);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // 카운트다운
    timer.current = window.setInterval(() => {
      setSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    // 좌석 힌트 저장 (PLAYER1/PLAYER2)
    const onPaired = (p: { role?: string }) => {
      if (p?.role) sessionStorage.setItem("seatRole", p.role);
    };
    socket.on("match:paired", onPaired);

    // 매치 시작 → Game으로, 닉네임/좌석 전달
    const onStarted = (p: MatchStarted) => {
      const seatRole = sessionStorage.getItem("seatRole") || "PLAYER1";
      nav("/game", { replace: true, state: { ...p, seatRole } });
    };
    socket.on("match:started", onStarted);

    return () => {
      socket.off("match:paired", onPaired);
      socket.off("match:started", onStarted);
    };
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

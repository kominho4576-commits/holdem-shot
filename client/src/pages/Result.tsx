import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function Result() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const winnerSeat = loc.state?.winnerSeat || "P1";
  const round = loc.state?.round || 1;
  const [sec, setSec] = useState(3);

  useEffect(() => {
    const t = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (sec === 0) nav("/", { replace: true });
  }, [sec, nav]);

  return (
    <div className="page center">
      <div className="title">{winnerSeat === "P1" ? "Victory" : "Defeat"}</div>
      <div className="sub" style={{ marginTop: 8 }}>Winner: {winnerSeat}</div>
      <div className="sub">Round: {round}</div>
      <div className="sub" style={{ marginTop: 12 }}>Return to Home in {sec}s</div>
    </div>
  );
}

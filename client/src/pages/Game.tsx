import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "../lib/socket";

type Seat = "P1" | "P2";
type Card = { r?: number; s?: number; isJoker?: boolean; back?: true };

type MatchState = {
  roomId?: string;
  seatRole?: "PLAYER1" | "PLAYER2";
  you?: { id: string; nickname: string; isAI?: boolean };
  opponent?: { id: string; nickname: string; isAI?: boolean };
  round?: number;
};

export default function Game() {
  const nav = useNavigate();
  const loc = useLocation();
  const init = (loc.state || {}) as MatchState;

  // --- 식별/닉네임/좌석 ---
  const [roomId, setRoomId] = useState<string>(init.roomId || "");
  const [youInfo, setYouInfo] = useState<{ id: string; nickname: string }>({
    id: init.you?.id || "",
    nickname: init.you?.nickname || "PLAYER1",
  });
  const [oppInfo, setOppInfo] = useState<{ id: string; nickname: string }>({
    id: init.opponent?.id || "",
    nickname: init.opponent?.nickname || "PLAYER2",
  });

  // 좌석 판정 (match:paired 시 저장했던 seatRole 사용)
  const mySeat: Seat = useMemo(
    () => (init.seatRole === "PLAYER2" ? "P2" : "P1"),
    [init.seatRole]
  );

  // --- 진행/보드 상태 ---
  const [phase, setPhase] = useState("Dealing");
  const [round, setRound] = useState(init.round || 1);
  const [board, setBoard] = useState<Card[]>([]);
  const [you, setYou] = useState<Card[]>([]);
  const [opp, setOpp] = useState<Card[]>([]);
  const [turn, setTurn] = useState<Seat>("P1");
  const [readyCount, setReadyCount] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [roulette, setRoulette] = useState<{ active: boolean; bullets: number; loser: Seat | null }>({
    active: false, bullets: 0, loser: null
  });
  const [result, setResult] = useState<{ winnerSeat: Seat | "TIE"; round: number } | null>(null);

  const isMyTurn = turn === mySeat;

  // ---------------- Socket 수신 ----------------
  useEffect(() => {
    const onState = (p: any) => {
      // 서버에서 전달되는 최신 roomId/닉네임/카드/턴 모두 갱신
      if (p.roomId) setRoomId(p.roomId);
      if (p.youName || p.opponentName) {
        if (p.youName) setYouInfo((y) => ({ ...y, nickname: p.youName }));
        if (p.opponentName) setOppInfo((o) => ({ ...o, nickname: p.opponentName }));
      }
      setPhase(p.phase);
      setRound(p.round);
      setBoard(p.board || []);
      setYou(p.you || []);
      setOpp(p.opponent || []);
      if (p.turn) setTurn(p.turn);
      if (typeof p.readyCount === "number") setReadyCount(p.readyCount);
    };

    socket.on("game:state", onState);
    socket.on("game:phase", (p: any) => { setPhase(p.phase); setRound(p.round); });
    socket.on("game:swap:blink", (_p: any) => { /* 상대 카드 깜빡임 연출은 다음 단계에 */ });
    socket.on("game:result", (p: any) => { setResult({ winnerSeat: p.winnerSeat, round: p.round }); });
    socket.on("game:roulette", (p: any) => { setRoulette({ active: true, bullets: p.bullets, loser: p.loserSeat }); });

    return () => {
      socket.off("game:state", onState);
      socket.off("game:phase");
      socket.off("game:swap:blink");
      socket.off("game:result");
      socket.off("game:roulette");
    };
  }, []);

  // ---------------- 액션 ----------------
  function toggleCard(idx: number) {
    setSelected((sel) => (sel.includes(idx) ? sel.filter((i) => i !== idx) : [...sel, idx]));
  }

  function onReady() {
    const keep = [0, 1].filter((i) => !selected.includes(i));
    if (!roomId) return;
    socket.emit("game:ready", { roomId, keepIndexes: keep });
    setSelected([]);
  }

  function onSurrender() {
    if (!roomId) return;
    if (window.confirm("Are you sure you want to surrender?")) {
      socket.emit("game:surrender", { roomId });
    }
  }

  // ---------------- 결과 → 5초 후 홈 ----------------
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => nav("/result", { replace: true, state: result }), 5000);
    return () => clearTimeout(t);
  }, [result, nav]);

  // ---------------- 뷰 ----------------
  // 룰렛 단계면 룰렛 전용 화면으로
  if (roulette.active) {
    return (
      <div className="center-col">
        <NamesBar
          you={youInfo.nickname}
          opp={oppInfo.nickname}
          myTurn={false}
          oppTurn={false}
        />
        <div className="h1">Russian Roulette</div>
        <div className="sub">ROUND {round}</div>
        <Roulette bullets={roulette.bullets} loser={roulette.loser!} />
      </div>
    );
  }

  return (
    <div className="center-col">
      <NamesBar
        you={youInfo.nickname}
        opp={oppInfo.nickname}
        myTurn={isMyTurn}
        oppTurn={!isMyTurn}
      />

      <div className="h1">Phase: {phase}</div>
      <div className="sub">ROUND {round}</div>

      {/* 보드 카드 */}
      <div className="row card-row">
        {board.map((c, i) => <CardView key={i} card={c} />)}
      </div>

      {/* 내 카드 */}
      <div className="row mine">
        {you.map((c, i) => (
          <div key={i} onClick={() => toggleCard(i)} className={selected.includes(i) ? "sel" : ""}>
            <CardView card={c} />
          </div>
        ))}
      </div>

      {/* 액션 */}
      <div className="row btns">
        <button className="btn btn-big" onClick={onReady}>Ready {readyCount}/2</button>
        <button className="btn btn-big" onClick={onSurrender}>Surrender</button>
      </div>

      {/* 상대 카드(뒷면 가정) */}
      <div className="row opp">
        {opp.map((c, i) => <CardView key={i} card={c} />)}
      </div>
    </div>
  );
}

// ---------- 상단 닉네임 바 + 그린 도트 ----------
function NamesBar({ you, opp, myTurn, oppTurn }: { you: string; opp: string; myTurn: boolean; oppTurn: boolean; }) {
  return (
    <div className="namesbar">
      <div className="namepill">
        <span className={`dot-sm ${myTurn ? "on" : ""}`} />
        <span className="name">{you || "PLAYER1"}</span>
      </div>
      <div className="namepill right">
        <span className="name">{opp || "PLAYER2"}</span>
        <span className={`dot-sm ${oppTurn ? "on" : ""}`} />
      </div>
    </div>
  );
}

// ---------- 카드 ----------
function CardView({ card }: { card: Card }) {
  if (card.back) return <div className="box card-rect">🂠</div>;
  if (card.isJoker) return <div className="box card-rect">JOKER</div>;
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks: { [k: number]: string } = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const r = card.r ? (ranks[card.r] || String(card.r)) : "?";
  const s = (card.s != null && card.s >= 0) ? suits[card.s] : "?";
  return <div className="box card-rect">{r}{s}</div>;
}

// ---------- 룰렛 ----------
function Roulette({ bullets, loser }: { bullets: number; loser: Seat }) {
  const [pos, setPos] = useState(0);
  const [hit, setHit] = useState(false);

  useEffect(() => {
    const wait = setTimeout(() => { // 5초 대기 후 시작
      const spins = Math.floor(Math.random() * 10) + 10;
      let i = 0;
      const t = setInterval(() => {
        setPos((p) => (p + 1) % 6);
        i++;
        if (i >= spins) {
          clearInterval(t);
          const chambers = [0, 1, 2, 3, 4, 5];
          // 라운드마다 총알 수 증가 (서버에서 넘어온 bullets 사용)
          const loaded = shuffle(chambers).slice(0, Math.min(6, bullets));
          setHit(loaded.includes((pos) % 6));
        }
      }, 180);
    }, 5000);
    return () => clearTimeout(wait);
  }, [bullets]);

  return (
    <div className="card center" style={{ marginTop: 24 }}>
      <div className="sub">Player {loser} pulls the trigger...</div>
      <div className="big" style={{ color: hit ? "#e74c3c" : "#2ecc71", marginTop: 8 }}>
        {hit ? "BANG!" : "SAFE"}
      </div>
    </div>
  );
}

function shuffle<T>(a: T[]): T[] { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

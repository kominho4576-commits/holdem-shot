import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "../lib/socket";

type Seat = "P1" | "P2";
type Card = { r?: number; s?: number; isJoker?: boolean; back?: true };

type MatchState = {
  roomId?: string;
  yourSeat?: Seat;
  you?: { id: string; nickname: string; isAI?: boolean };
  opponent?: { id: string; nickname: string; isAI?: boolean };
  round?: number;
};

export default function Game() {
  const nav = useNavigate();
  const loc = useLocation();
  const init = (loc.state || {}) as MatchState;

  const mySeat: Seat = useMemo(() => {
    if (init.yourSeat) return init.yourSeat;
    const saved = sessionStorage.getItem("mySeat") as Seat | null;
    if (saved === "P1" || saved === "P2") return saved;
    const role = sessionStorage.getItem("seatRole");
    return role === "PLAYER2" ? "P2" : "P1";
  }, [init.yourSeat]);

  const [roomId, setRoomId] = useState<string>(init.roomId || "");
  const [youName, setYouName] = useState(init.you?.nickname || (mySeat === "P1" ? "PLAYER1" : "PLAYER2"));
  const [oppName, setOppName] = useState(init.opponent?.nickname || (mySeat === "P1" ? "PLAYER2" : "PLAYER1"));

  const [phase, setPhase] = useState("Dealing");
  const [round, setRound] = useState(init.round || 1);
  const [board, setBoard] = useState<Card[]>([]);
  const [you, setYou] = useState<Card[]>([]);
  const [opp] = useState<Card[]>([{ back: true }, { back: true }]); // 항상 뒷면
  const [turn, setTurn] = useState<Seat>("P1");
  const [readyCount, setReadyCount] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [oppBlink, setOppBlink] = useState(false);

  // 쇼다운 모달
  const [showdown, setShowdown] = useState<{ you?: string; opp?: string; winnerSeat?: Seat | "TIE" } | null>(null);
  const [count3, setCount3] = useState<number | null>(null);
  const [toRoulette, setToRoulette] = useState<number | null>(null);

  // 룰렛
  const [roulette, setRoulette] = useState<{ active: boolean; bullets: number; loser: Seat | null }>({
    active: false, bullets: 0, loser: null
  });
  const [flash, setFlash] = useState<"red" | "white" | null>(null);

  const isMyTurn = turn === mySeat;
  const readyMode = phase.toLowerCase() === "dealing";
  const revealed = useMemo(() => {
    const p = phase.toLowerCase();
    if (p === "flop") return 3;
    if (p === "turn") return 4;
    if (p === "river") return 5;
    return 0;
  }, [phase]);

  // ===== 소켓 바인딩 =====
  useEffect(() => {
    const onState = (p: any) => {
      if (p.roomId) setRoomId(p.roomId);
      if (p.phase) setPhase(p.phase);
      if (typeof p.round === "number") setRound(p.round);
      if (p.youName) setYouName(p.youName);
      if (p.opponentName) setOppName(p.opponentName);
      if (p.turn) setTurn(p.turn);
      if (typeof p.readyCount === "number") setReadyCount(p.readyCount);

      // 공유보드에 조커가 찍혀 들어오는 경우 표시 차단(서버 보정되기 전 방어)
      const sanitizedBoard: Card[] = (p.board || []).map((c: Card) =>
        c?.isJoker ? { back: true } : c
      );
      setBoard(sanitizedBoard);

      if (Array.isArray(p.you)) setYou(p.you);
      if (typeof p.opSelected === "number") { setOppBlink(true); setTimeout(() => setOppBlink(false), 280); }
      if (p.resetSelection) setSelected([]);
    };

    socket.on("game:state", onState);
    socket.on("game:phase", (p: any) => {
      setPhase(p.phase);
      setRound(p.round);
      if (p.turn) setTurn(p.turn);
      setSelected([]); // 페이즈 전환 시 선택 초기화
    });

    socket.on("game:result", (p: any) => {
      // 라운드 결과 → 중앙 모달 + 3초 카운트
      setShowdown({ you: p.youHandName, opp: p.oppHandName, winnerSeat: p.winnerSeat });
      setCount3(3);
    });

    socket.on("game:roulette", (p: any) => {
      setToRoulette(null);
      setRoulette({ active: true, bullets: p.bullets, loser: p.loserSeat });
    });

    socket.on("game:over", (p: any) => {
      nav("/result", { replace: true, state: { winnerSeat: p.winnerSeat, round: p.round } });
    });

    return () => {
      socket.off("game:state", onState);
      socket.off("game:phase");
      socket.off("game:result");
      socket.off("game:roulette");
      socket.off("game:over");
    };
  }, [nav]);

  // 3초 → 5초 카운트
  useEffect(() => {
    if (count3 == null) return;
    if (count3 <= 0) {
      setCount3(null);
      setToRoulette(5);
      return;
    }
    const t = setTimeout(() => setCount3((v) => (v ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [count3]);

  useEffect(() => {
    if (toRoulette == null) return;
    if (toRoulette <= 0) {
      setToRoulette(null);
      // 서버가 알림을 주지 않는 경우 대비해 폴백으로 시작
      setRoulette((r) => (r.active ? r : { active: true, bullets: Math.max(1, round), loser: (showdown?.winnerSeat === "TIE" ? null : (showdown?.winnerSeat === "P1" ? "P2" : "P1")) }));
      return;
    }
    const t = setTimeout(() => setToRoulette((v) => (v ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [toRoulette, round, showdown]);

  // 선택
  function toggleCard(i: number) {
    if (!isMyTurn || readyMode) return;
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : s.length >= 2 ? s : [...s, i]));
  }

  // 레디/교환
  function onAction() {
    if (!roomId) return;
    if (readyMode) {
      socket.emit("game:ready", { roomId, keepIndexes: [0, 1] });
    } else {
      const keep = [0, 1].filter((i) => !selected.includes(i));
      socket.emit("game:ready", { roomId, keepIndexes: keep });
      setSelected([]);
    }
  }

  // 서렌더 (즉시 패배 처리)
  function onSurrender() {
    if (!roomId) return;
    if (window.confirm("Are you sure you want to surrender?")) {
      socket.emit("game:surrender", { roomId }); // 서버가 즉시 승패 처리/브로드캐스트
    }
  }

  return (
    <div className="page game">
      <div className="namesbar">
        <div className="namepill"><span className={`dot-sm ${turn === "P1" && mySeat === "P1" ? "on" : ""}`} />{youName}</div>
        <div className="namepill">{oppName}<span className={`dot-sm ${turn === "P2" && mySeat === "P1" ? "on" : (turn === "P1" && mySeat === "P2" ? "on" : "")}`} /></div>
      </div>

      <div className="stack">
        <div className="title-sm">Phase: {phase}</div>
        <div className="sub">ROUND {round}</div>

        {/* 상대 카드(항상 뒷면) */}
        <div className={`row opp ${oppBlink ? "blink" : ""}`}>
          <CardBack /><CardBack />
        </div>

        {/* 공유 카드: 규칙대로 공개 수만큼만 앞면 */}
        <div className="row board">
          {board.slice(0, revealed).map((c, i) => <CardView key={i} card={c} />)}
          {Array.from({ length: Math.max(0, 5 - revealed) }).map((_, i) => <CardBack key={`b-${i}`} />)}
        </div>

        {/* 내 카드 */}
        <div className="row mine">
          {you.map((c, i) => (
            <div key={i} onClick={() => toggleCard(i)} className={selected.includes(i) ? "sel" : ""}>
              <CardView card={c} />
            </div>
          ))}
        </div>

        {/* 버튼 */}
        <div className="row btns">
          <button className="btn btn-big" disabled={readyMode ? false : !isMyTurn} onClick={onAction}>
            {readyMode ? `Ready ${readyCount}/2` : (isMyTurn ? "Exchange" : "Waiting")}
          </button>
          <button className="btn btn-big" onClick={onSurrender}>Surrender</button>
        </div>
      </div>

      {/* 라운드 결과 모달 */}
      {showdown && (
        <div className="overlay-dim">
          <div className="result-modal">
            <div className="big">
              {showdown.winnerSeat === "TIE" ? "Tie" : showdown.winnerSeat === mySeat ? "You Win" : "You Lose"}
            </div>
            <div className="sub" style={{ marginTop: 8 }}>
              Your: {showdown.you || "-"}
            </div>
            <div className="sub">
              Opponent: {showdown.opp || "-"}
            </div>
            {count3 != null && <div className="sub" style={{ marginTop: 10 }}>Showdown in {count3}s</div>}
            {toRoulette != null && <div className="sub">Roulette in {toRoulette}s</div>}
          </div>
        </div>
      )}

      {/* 룰렛 */}
      {roulette.active && (
        <Roulette
          bullets={roulette.bullets}
          loser={roulette.loser || "P2"}
          onDone={(hit) => {
            const iGotHit = hit && roulette.loser === mySeat;
            setFlash(iGotHit ? "red" : "white");
            setTimeout(() => {
              setFlash(null);
              if (hit) {
                nav("/result", { replace: true, state: { winnerSeat: roulette.loser === "P1" ? "P2" : "P1", round } });
              }
            }, 1000);
          }}
        />
      )}

      {flash && <div className={`flash ${flash}`} />}
    </div>
  );
}

/* ===== 카드 ===== */
function CardBack() { return <div className="card-rect back" aria-hidden="true" />; }

function CardView({ card }: { card: Card }) {
  if (card.back) return <CardBack />;
  if (card.isJoker) return <div className="card-rect face">JOKER</div>;
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const r = card.r ? (ranks[card.r] || String(card.r)) : "?";
  const s = (card.s != null && card.s >= 0) ? suits[card.s] : "?";
  return <div className="card-rect face">{r}{s}</div>;
}

/* ===== 룰렛(중앙 점 + 6약실, 총알 삽입 애니메이션, 정확 정지) ===== */
function Roulette({ bullets, loser, onDone }: {
  bullets: number; loser: Seat; onDone: (hit: boolean) => void;
}) {
  const [angle, setAngle] = useState(0);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [done, setDone] = useState<{ target: number; hit: boolean } | null>(null);

  // 총알 삽입 애니메이션 (라운드마다 +1)
  useEffect(() => {
    const indices = pickUnique(bullets).sort((a, b) => a - b);
    let i = 0;
    const timer = setInterval(() => {
      setLoaded((prev) => [...prev, indices[i]]);
      i++;
      if (i >= indices.length) clearInterval(timer);
    }, 350);
    return () => clearInterval(timer);
  }, [bullets]);

  // 5초 대기 후 회전 시작 → 포인터에 정확히 정지
  useEffect(() => {
    const wait = setTimeout(() => {
      const spins = 6 + Math.floor(Math.random() * 8);
      const target = Math.floor(Math.random() * 6);
      const dur = 2200 + Math.random() * 800;

      const t0 = performance.now();
      function step(t: number) {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setAngle(360 * spins + target * 60 * eased);
        if (p < 1) requestAnimationFrame(step);
        else {
          const hit = loaded.includes(target);
          setDone({ target, hit });
          setTimeout(() => onDone(hit), 500);
        }
      }
      requestAnimationFrame(step);
    }, 5000);

    return () => clearTimeout(wait);
  }, [loaded, onDone]);

  return (
    <div className="roulette">
      <div className="pointer">▲</div>
      <div className="hub" />
      <div className="disc" style={{ transform: `rotate(${angle}deg)` }}>
        {Array.from({ length: 6 }).map((_, i) => {
          const radius = 78; // 중앙점 기준 반지름
          const theta = (Math.PI * 2 * i) / 6; // 60도 간격
          const x = Math.cos(theta) * radius;
          const y = Math.sin(theta) * radius;
          const isLoaded = loaded.includes(i);
          return (
            <div
              key={i}
              className={`hole ${isLoaded ? "loaded" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
            />
          );
        })}
      </div>
      <div className="sub" style={{ marginTop: 8 }}>Player {loser} pulls the trigger...</div>
      {done && (
        <div className="big" style={{ color: done.hit ? "#e74c3c" : "#2ecc71", marginTop: 4 }}>
          {done.hit ? "BANG!" : "SAFE"}
        </div>
      )}
    </div>
  );
}

function pickUnique(n: number) {
  const a = [0, 1, 2, 3, 4, 5];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(6, Math.max(1, n)));
}

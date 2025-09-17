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

  // 좌석(정확성 최우선: yourSeat > sessionStorage > PLAYER role)
  const mySeat: Seat = useMemo(() => {
    if (init.yourSeat) return init.yourSeat;
    const saved = sessionStorage.getItem("mySeat") as Seat | null;
    if (saved === "P1" || saved === "P2") return saved;
    const role = sessionStorage.getItem("seatRole");
    return role === "PLAYER2" ? "P2" : "P1";
  }, [init.yourSeat]);

  // --- 식별/닉네임 ---
  const [roomId, setRoomId] = useState<string>(init.roomId || "");
  const [youInfo, setYouInfo] = useState<{ id: string; nickname: string }>({
    id: init.you?.id || "",
    nickname: init.you?.nickname || (mySeat === "P2" ? "PLAYER2" : "PLAYER1"),
  });
  const [oppInfo, setOppInfo] = useState<{ id: string; nickname: string }>({
    id: init.opponent?.id || "",
    nickname: init.opponent?.nickname || (mySeat === "P2" ? "PLAYER1" : "PLAYER2"),
  });

  // --- 진행/보드 상태 ---
  const [phase, setPhase] = useState("Dealing");
  const [round, setRound] = useState(init.round || 1);
  const [board, setBoard] = useState<Card[]>([]);
  const [you, setYou] = useState<Card[]>([]);
  const [opp, setOpp] = useState<Card[]>([]);
  const [turn, setTurn] = useState<Seat>("P1");
  const [readyCount, setReadyCount] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [blinkOpp, setBlinkOpp] = useState(false);

  // 러시안 룰렛 & 결과
  const [roulette, setRoulette] = useState<{ active: boolean; bullets: number; loser: Seat | null }>({
    active: false, bullets: 0, loser: null
  });
  const [showdown, setShowdown] = useState<{ you?: string; opp?: string; winnerSeat?: Seat | "TIE" } | null>(null);

  const isMyTurn = turn === mySeat;

  // ---------------- Socket 수신 ----------------
  useEffect(() => {
    const onState = (p: any) => {
      if (p.roomId) setRoomId(p.roomId);
      if (p.youName || p.opponentName) {
        if (p.youName) setYouInfo((y) => ({ ...y, nickname: p.youName }));
        if (p.opponentName) setOppInfo((o) => ({ ...o, nickname: p.opponentName }));
      }
      setPhase(p.phase); setRound(p.round);
      setBoard(p.board || []); setYou(p.you || []); setOpp(p.opponent || []);
      if (p.turn) setTurn(p.turn);
      if (typeof p.readyCount === "number") setReadyCount(p.readyCount);
    };

    socket.on("game:state", onState);
    socket.on("game:phase", (p: any) => { setPhase(p.phase); setRound(p.round); if (p.turn) setTurn(p.turn); });
    socket.on("game:swap:blink", (_p: any) => { setBlinkOpp(true); setTimeout(()=>setBlinkOpp(false), 350); });

    // 결과: surrender면 즉시 결과 화면으로, 그 외엔 텍스트 보여주고 5초 뒤 룰렛(서버 이벤트가 오면 그걸 우선)
    socket.on("game:result", (p: any) => {
      setShowdown({ you: p.youHandName, opp: p.oppHandName, winnerSeat: p.winnerSeat });
      if (p.reason === "surrender") {
        nav("/result", { replace: true, state: { winnerSeat: p.winnerSeat, round: p.round, reason: "surrender" } });
      } else {
        // 5초 뒤 서버가 roulette 이벤트를 안 주면 폴백으로 클라에서도 시작
        const t = setTimeout(() => {
          setRoulette((r) => r.active ? r : { active: true, bullets: Math.max(1, (round || 1)), loser: p.winnerSeat === "TIE" ? null : (p.winnerSeat === "P1" ? "P2" : "P1") });
        }, 5000);
        return () => clearTimeout(t);
      }
    });

    socket.on("game:roulette", (p: any) => {
      setRoulette({ active: true, bullets: p.bullets, loser: p.loserSeat });
    });

    return () => {
      socket.off("game:state", onState);
      socket.off("game:phase"); socket.off("game:swap:blink");
      socket.off("game:result"); socket.off("game:roulette");
    };
  }, [nav, round, mySeat]);

  // ---------------- 액션 ----------------
  function toggleCard(idx: number) {
    if (!isMyTurn) return; // 내 차례 아닐 땐 선택 불가(시각만)
    setSelected((sel) => (sel.includes(idx) ? sel.filter((i) => i !== idx) : [...sel, idx]));
  }
  function onReady() {
    if (!isMyTurn) return;
    const keep = [0, 1].filter((i) => !selected.includes(i));
    if (!roomId) return;
    socket.emit("game:ready", { roomId, keepIndexes: keep });
    setSelected([]);
  }
  function onSurrender() {
    if (!roomId) return;
    if (window.confirm("Are you sure you want to surrender?")) {
      socket.emit("game:surrender", { roomId }); // 서버가 즉시 결과 방송 → 바로 /result 로 이동
    }
  }

  // ---------------- 뷰 ----------------
  // 공개된 공유 카드 갯수(Flop/Turn/River 규칙)
  const revealed = useMemo(() => {
    if (phase.toLowerCase() === "flop") return 3;
    if (phase.toLowerCase() === "turn") return 4;
    if (phase.toLowerCase() === "river") return 5;
    return 0; // Dealing
  }, [phase]);

  // 룰렛 단계면 전용 화면
  if (roulette.active) {
    return (
      <div className="center-col">
        <NamesBar you={youInfo.nickname} opp={oppInfo.nickname} myTurn={false} oppTurn={false} />
        <div className="h1">Russian Roulette</div>
        <div className="sub">ROUND {round}</div>
        <Roulette bullets={roulette.bullets} loser={roulette.loser || "P2"} />
      </div>
    );
  }

  return (
    <div className="center-col">
      <NamesBar you={youInfo.nickname} opp={oppInfo.nickname} myTurn={isMyTurn} oppTurn={!isMyTurn} />

      <div className="h1">Phase: {phase}</div>
      <div className="sub">ROUND {round}</div>

      {/* 상대 카드 (맨 위, 2장 뒷면) */}
      <div className={`row opp top ${blinkOpp ? "blink" : ""}`}>
        {[0,1].map(i => <CardBack key={i} />)}
      </div>

      {/* 공유 카드 (중앙 일렬, 공개 규칙 적용) */}
      <div className="row board middle">
        {board.slice(0, revealed).map((c, i) => <CardView key={i} card={c} />)}
      </div>

      {/* 내 카드 (하단) */}
      <div className="row mine bottom">
        {you.map((c, i) => (
          <div key={i} onClick={() => toggleCard(i)} className={selected.includes(i) ? "sel" : ""}>
            <CardView card={c} />
          </div>
        ))}
      </div>

      {/* 액션 */}
      <div className="row btns">
        <button className="btn btn-big" disabled={!isMyTurn} onClick={onReady}>
          Ready {readyCount}/2
        </button>
        <button className="btn btn-big" onClick={onSurrender}>Surrender</button>
      </div>

      {/* 쇼다운 텍스트 */}
      {showdown && showdown.winnerSeat && (
        <div className="card center" style={{ marginTop: 12 }}>
          <div className="big">
            {showdown.winnerSeat === "TIE" ? "Tie" :
              (showdown.winnerSeat === mySeat ? "You Win" : "You Lose")}
          </div>
          <div className="sub">
            {`Your hand: ${showdown.you || "-"}`}
            {"  |  "}
            {`Opponent: ${showdown.opp || "-"}`}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== UI Pieces ===== */
function NamesBar({ you, opp, myTurn, oppTurn }:{ you:string; opp:string; myTurn:boolean; oppTurn:boolean }){
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

function CardBack(){ return <div className="box card-rect">🂠</div>; }

function CardView({ card }:{ card:Card }){
  if (card.back) return <CardBack/>;
  if (card.isJoker) return <div className="box card-rect">JOKER</div>;
  const suits = ["♠","♥","♦","♣"];
  const ranks:{[k:number]:string} = {11:"J",12:"Q",13:"K",14:"A"};
  const r = card.r ? (ranks[card.r]||String(card.r)) : "?";
  const s = (card.s!=null && card.s>=0)? suits[card.s]:"?";
  return <div className="box card-rect">{r}{s}</div>;
}

/* === Roulette Visualization === */
function Roulette({ bullets, loser }:{ bullets:number; loser:Seat }){
  const [index,setIndex] = useState(0);        // 현재 포인터가 가리키는 챔버(0-5)
  const [finished,setFinished] = useState(false);
  const [hit,setHit] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    // 5초 대기 후 회전 시작
    const wait = setTimeout(()=>{
      const spins = 12 + Math.floor(Math.random()*12); // 랜덤 회전 수
      const target = Math.floor(Math.random()*6);       // 화살표에 멈출 위치
      const totalSteps = spins*6 + target;              // 정확히 target에 정지
      let step = 0;

      const t = setInterval(()=>{
        step++; setIndex(prev => (prev+1)%6);
        if (step >= totalSteps){
          clearInterval(t);
          setFinished(true);
          // 장전된 챔버 무작위 선택(bullets 개수만큼)
          const chambers = [0,1,2,3,4,5];
          shuffle(chambers);
          const loaded = new Set(chambers.slice(0, Math.min(6, bullets)));
          setHit(loaded.has(target));
        }
      }, 150); // 속도는 고정, 마지막 step에서 정확히 멈춤
    }, 5000);

    return ()=>clearTimeout(wait);
  }, [bullets]);

  return (
    <div className="roulette">
      <div className="arrow">▲</div>
      <div className="wheel" ref={wheelRef}>
        {Array.from({length:6}).map((_,i)=>(
          <div key={i} className={`chamber ${i===index ? "on":""}`} />
        ))}
      </div>
      <div className="center sub" style={{marginTop:12}}>Player {loser} pulls the trigger...</div>
      {finished && (
        <div className="big" style={{ color: hit ? "#e74c3c" : "#2ecc71", marginTop: 8 }}>
          {hit ? "BANG!" : "SAFE"}
        </div>
      )}
    </div>
  );
}

/* utils */
function shuffle<T>(a:T[]):T[]{ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;}

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

  // 좌석 판단
  const mySeat: Seat = useMemo(() => {
    if (init.yourSeat) return init.yourSeat;
    const saved = sessionStorage.getItem("mySeat") as Seat | null;
    if (saved === "P1" || saved === "P2") return saved;
    const role = sessionStorage.getItem("seatRole");
    return role === "PLAYER2" ? "P2" : "P1";
  }, [init.yourSeat]);

  // 기본 상태
  const [roomId, setRoomId] = useState<string>(init.roomId || "");
  const [youName, setYouName] = useState(init.you?.nickname || (mySeat === "P1" ? "PLAYER1" : "PLAYER2"));
  const [oppName, setOppName] = useState(init.opponent?.nickname || (mySeat === "P1" ? "PLAYER2" : "PLAYER1"));

  const [phase, setPhase] = useState("Dealing");
  const [round, setRound] = useState(init.round || 1);
  const [board, setBoard] = useState<Card[]>([]);
  const [you, setYou] = useState<Card[]>([]);
  const [opp, setOpp] = useState<Card[]>([{ back: true }, { back: true }]); // 항상 뒷면
  const [turn, setTurn] = useState<Seat>("P1");
  const [readyCount, setReadyCount] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [blinkOpp, setBlinkOpp] = useState(false);

  // 쇼다운/룰렛
  const [showdown, setShowdown] = useState<{ you?: string; opp?: string; winnerSeat?: Seat | "TIE" } | null>(null);
  const [count3, setCount3] = useState<number | null>(null); // 쇼다운 3초
  const [toRoulette, setToRoulette] = useState<number | null>(null); // 5초 카운트
  const [roulette, setRoulette] = useState<{ active: boolean; bullets: number; loser: Seat | null; hit?: boolean }>({
    active: false, bullets: 0, loser: null
  });
  const [flash, setFlash] = useState<"red" | "white" | null>(null);

  // 공개된 공유 카드 수
  const revealed = useMemo(() => {
    const p = phase.toLowerCase();
    if (p === "flop") return 3;
    if (p === "turn") return 4;
    if (p === "river") return 5;
    return 0;
  }, [phase]);

  const isMyTurn = turn === mySeat;
  const readyMode = phase.toLowerCase() === "dealing";

  // 소켓 바인딩
  useEffect(() => {
    const onState = (p: any) => {
      if (p.roomId) setRoomId(p.roomId);
      setPhase(p.phase); setRound(p.round);
      setBoard(p.board || []);
      setYou(p.you || []);
      if (p.youName) setYouName(p.youName);
      if (p.opponentName) setOppName(p.opponentName);
      if (p.turn) setTurn(p.turn);
      if (typeof p.readyCount === "number") setReadyCount(p.readyCount);
      if (typeof p.opSelected === "number") { setBlinkOpp(true); setTimeout(()=>setBlinkOpp(false), 300); }
    };
    socket.on("game:state", onState);
    socket.on("game:phase", (p:any)=>{ setPhase(p.phase); setRound(p.round); if (p.turn) setTurn(p.turn); });

    socket.on("game:result", (p:any)=>{
      // 족보 결과 수신 → 텍스트 + 3초 카운트
      setShowdown({ you: p.youHandName, opp: p.oppHandName, winnerSeat: p.winnerSeat });
      setCount3(3);
    });

    socket.on("game:roulette", (p:any)=>{
      setToRoulette(null);
      setRoulette({ active:true, bullets:p.bullets, loser:p.loserSeat });
    });

    return ()=> {
      socket.off("game:state", onState);
      socket.off("game:phase");
      socket.off("game:result");
      socket.off("game:roulette");
    };
  }, []);

  // 3초 카운트 → 5초 카운트
  useEffect(()=>{
    if (count3==null) return;
    if (count3<=0){
      setCount3(null);
      setToRoulette(5);
      return;
    }
    const t=setTimeout(()=>setCount3((v)=> (v??1)-1),1000);
    return ()=>clearTimeout(t);
  },[count3]);

  // 5초 카운트 → 클라 폴백으로 룰렛 시작
  useEffect(()=>{
    if (toRoulette==null) return;
    if (toRoulette<=0){
      setToRoulette(null);
      setRoulette((r)=> r.active ? r : { active:true, bullets: Math.max(1, round), loser: (showdown?.winnerSeat==="TIE"? null : (showdown?.winnerSeat==="P1"?"P2":"P1")) });
      return;
    }
    const t=setTimeout(()=>setToRoulette((v)=> (v??1)-1),1000);
    return ()=>clearTimeout(t);
  },[toRoulette, round, showdown]);

  // 선택
  function toggleCard(i:number){
    if (!isMyTurn || readyMode) return;
    setSelected((s)=> s.includes(i) ? s.filter(x=>x!==i) : (s.length>=2? s : [...s,i]));
  }

  // Ready/Exchange
  function onAction(){
    if (!roomId) return;
    if (readyMode){
      socket.emit("game:ready", { roomId, keepIndexes: [0,1] });
    } else {
      const keep = [0,1].filter(i=> !selected.includes(i));
      socket.emit("game:ready", { roomId, keepIndexes: keep });
      setSelected([]);
    }
  }

  // 항복
  function onSurrender(){
    if (!roomId) return;
    if (window.confirm("Are you sure you want to surrender?")){
      socket.emit("game:surrender", { roomId });
    }
  }

  return (
    <div className="page game">
      {/* 상단 닉네임/턴 */}
      <div className="namesbar">
        <div className="namepill"><span className={`dot-sm ${isMyTurn ? "on":""}`} />{youName}</div>
        <div className="namepill">{oppName}<span className={`dot-sm ${!isMyTurn ? "on":""}`} /></div>
      </div>

      {/* 중앙 영역을 넉넉하게 사용 */}
      <div className="stack">
        <div className="title-sm">Phase: {phase}</div>
        <div className="sub">ROUND {round}</div>

        {/* 상대 카드 (항상 뒷면 2장) */}
        <div className={`row opp ${blinkOpp?"blink":""}`}>
          <CardBack /><CardBack />
        </div>

        {/* 공유 카드 (일렬, 공개 규칙) */}
        <div className="row board">
          {board.slice(0, revealed).map((c,i)=><CardView key={i} card={c}/>)}
          {Array.from({length: Math.max(0,5-revealed)}).map((_,i)=><CardBack key={`b-${i}`} />)}
        </div>

        {/* 내 카드 */}
        <div className="row mine">
          {you.map((c,i)=>(
            <div key={i} onClick={()=>toggleCard(i)} className={selected.includes(i)? "sel":""}>
              <CardView card={c}/>
            </div>
          ))}
        </div>

        {/* 버튼 */}
        <div className="row btns">
          <button
            className="btn btn-big"
            disabled={readyMode ? false : !isMyTurn}
            onClick={onAction}
          >
            {readyMode ? `Ready ${readyCount}/2` : (isMyTurn ? "Exchange" : "Waiting")}
          </button>
          <button className="btn btn-big" onClick={onSurrender}>Surrender</button>
        </div>

        {/* 쇼다운 텍스트 + 카운트 */}
        {showdown && (
          <div className="card center">
            <div className="big">
              {showdown.winnerSeat==="TIE" ? "Tie" :
               showdown.winnerSeat===mySeat ? "You Win" : "You Lose"}
            </div>
            <div className="sub">
              {`Your: ${showdown.you || "-"}`}{"  |  "}
              {`Opponent: ${showdown.opp || "-"}`}
            </div>
            {count3!=null && <div className="sub" style={{marginTop:6}}>Showdown in {count3}s</div>}
            {toRoulette!=null && <div className="sub" style={{marginTop:6}}>Roulette in {toRoulette}s</div>}
          </div>
        )}

        {/* 룰렛 */}
        {roulette.active && (
          <Roulette
            bullets={roulette.bullets}
            loser={roulette.loser || "P2"}
            onDone={(hit)=>{
              const iGotHit = hit && roulette.loser===mySeat;
              setFlash(iGotHit? "red":"white");
              setTimeout(()=>{
                setFlash(null);
                // SAFE면 서버가 다음 라운드를 시작할 것. BANG이면 결과 화면으로.
                if (hit){
                  nav("/result", { replace:true, state:{
                    winnerSeat: roulette.loser==="P1"?"P2":"P1",
                    round
                  }});
                }
              }, 1000);
            }}
          />
        )}
      </div>

      {/* 전체 화면 깜박임 */}
      {flash && <div className={`flash ${flash}`}/>}
    </div>
  );
}

/* ========== 카드 컴포넌트 ========== */
function CardBack(){
  return <div className="card-rect back" aria-hidden="true"/>;
}
function CardView({ card }:{ card: Card }){
  if (card.back) return <CardBack/>;
  if (card.isJoker) return <div className="card-rect face">JOKER</div>;
  const suits = ["♠","♥","♦","♣"];
  const ranks:{[k:number]:string} = {11:"J",12:"Q",13:"K",14:"A"};
  const r = card.r ? (ranks[card.r] || String(card.r)) : "?";
  const s = (card.s!=null && card.s>=0) ? suits[card.s] : "?";
  return <div className="card-rect face">{r}{s}</div>;
}

/* ========== 룰렛 ========== */
function Roulette({ bullets, loser, onDone }:{
  bullets:number; loser:Seat; onDone:(hit:boolean)=>void;
}){
  const [angle,setAngle] = useState(0);
  const [running,setRunning] = useState(true);
  const [hit,setHit] = useState(false);

  useEffect(()=>{
    // 5초 대기 후 회전 시작
    const wait = setTimeout(()=>{
      // 6칸, 60도 단위. target에 정확히 정지.
      const spins = 6 + Math.floor(Math.random()*8);
      const target = Math.floor(Math.random()*6);
      const chambers=[0,1,2,3,4,5]; shuffle(chambers);
      const loaded = new Set(chambers.slice(0, Math.min(6, bullets)));

      const targetAngle = 360*spins + target*60; // 시계 방향
      const duration = 2200 + Math.random()*800;

      const t0 = performance.now();
      function step(t:number){
        const p = Math.min(1, (t - t0)/duration);
        // easeOutCubic
        const eased = 1 - Math.pow(1-p, 3);
        setAngle(targetAngle*eased);
        if (p<1) requestAnimationFrame(step);
        else {
          setRunning(false);
          const wasHit = loaded.has(target);
          setHit(wasHit);
          setTimeout(()=> onDone(wasHit), 500);
        }
      }
      requestAnimationFrame(step);
    }, 5000);
    return ()=>clearTimeout(wait);
  },[bullets,onDone]);

  return (
    <div className="roulette">
      <div className="pointer">▼</div>
      <div className="disc" style={{ transform:`rotate(${angle}deg)` }}>
        {Array.from({length:6}).map((_,i)=>(
          <div key={i} className="hole" style={{
            transform:`rotate(${i*60}deg) translate(0, -74px) rotate(${-i*60}deg)`
          }}/>
        ))}
      </div>
      <div className="sub" style={{marginTop:8}}>Player {loser} pulls the trigger...</div>
      {!running && (
        <div className="big" style={{ color: hit ? "#e74c3c" : "#2ecc71", marginTop: 4 }}>
          {hit ? "BANG!" : "SAFE"}
        </div>
      )}
    </div>
  );
}

/* util */
function shuffle<T>(a:T[]):T[]{ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

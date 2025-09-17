import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "../lib/socket";

type Seat = "P1" | "P2";
type Card = { r?: number; s?: number; isJoker?: boolean; back?: true };

export default function Game() {
  const nav = useNavigate();
  const loc = useLocation();
  const [phase, setPhase] = useState("Dealing");
  const [round, setRound] = useState(1);
  const [board, setBoard] = useState<Card[]>([]);
  const [you, setYou] = useState<Card[]>([]);
  const [opp, setOpp] = useState<Card[]>([]);
  const [readyCount, setReadyCount] = useState(0);
  const [turn, setTurn] = useState<Seat>("P1");
  const [selected, setSelected] = useState<number[]>([]);
  const [roulette, setRoulette] = useState<{active:boolean, bullets:number, loser:Seat|null}>({active:false, bullets:0, loser:null});
  const [result, setResult] = useState<{winnerSeat:Seat|"TIE", round:number}|null>(null);

  // 카드 선택 토글
  function toggleCard(idx:number){
    setSelected(sel => sel.includes(idx) ? sel.filter(i=>i!==idx) : [...sel, idx]);
  }

  // 서버 이벤트 연결
  useEffect(()=>{
    socket.on("game:state",(p:any)=>{
      setPhase(p.phase); setRound(p.round);
      setBoard(p.board); setYou(p.you); setOpp(p.opponent);
      setTurn(p.turn); setReadyCount(p.readyCount);
    });
    socket.on("game:phase",(p:any)=>{ setPhase(p.phase); setRound(p.round); });
    socket.on("game:swap:blink",(p:any)=>{
      // TODO: UI에서 상대 카드 깜빡 효과 구현 (지금은 console만)
      console.log("opponent swapped:",p);
    });
    socket.on("game:result",(p:any)=>{ setResult({winnerSeat:p.winnerSeat, round:p.round}); });
    socket.on("game:roulette",(p:any)=>{ setRoulette({active:true, bullets:p.bullets, loser:p.loserSeat}); });

    return ()=>{
      socket.off("game:state"); socket.off("game:phase"); socket.off("game:swap:blink");
      socket.off("game:result"); socket.off("game:roulette");
    };
  },[]);

  // Ready 버튼 클릭 → 선택한 것 빼고 유지
  function onReady(){
    const keep = [0,1].filter(i=>!selected.includes(i));
    socket.emit("game:ready",{roomId:(loc.state as any)?.roomId, keepIndexes:keep});
    setSelected([]);
  }

  // 항복 버튼
  function onSurrender(){
    if(window.confirm("Are you sure you want to surrender?")){
      socket.emit("game:surrender",{roomId:(loc.state as any)?.roomId});
    }
  }

  // 결과가 뜨면 5초 뒤 홈으로
  useEffect(()=>{
    if(result){
      const t=setTimeout(()=>nav("/result",{replace:true,state:result}),5000);
      return ()=>clearTimeout(t);
    }
  },[result,nav]);

  return (
    <div className="center-col">
      <div className="h1">Phase: {phase}</div>
      <div className="sub">ROUND {round}</div>

      {/* 보드 카드 */}
      <div className="row" style={{gap:8,margin:"12px 0"}}>
        {board.map((c,i)=><CardView key={i} card={c}/>)}
      </div>

      {/* 내 카드 */}
      <div className="row" style={{gap:12,marginTop:12}}>
        {you.map((c,i)=>
          <div key={i} onClick={()=>toggleCard(i)} style={{border:selected.includes(i)?"3px solid red":"none"}}>
            <CardView card={c}/>
          </div>
        )}
      </div>

      {/* 버튼 */}
      <div className="row" style={{marginTop:16}}>
        <button className="btn" onClick={onReady}>Ready {readyCount}/2</button>
        <button className="btn" onClick={onSurrender}>Surrender</button>
      </div>

      {/* 상대 카드 (뒷면) */}
      <div className="row" style={{gap:8,marginTop:24}}>
        {opp.map((c,i)=><CardView key={i} card={c}/>)}
      </div>

      {/* 룰렛 표시 */}
      {roulette.active && <Roulette bullets={roulette.bullets} loser={roulette.loser!} />}
    </div>
  );
}

// --- 카드 컴포넌트 ---
function CardView({card}:{card:Card}){
  if(card.back) return <div className="box">🂠</div>;
  if(card.isJoker) return <div className="box">JOKER</div>;
  const suits = ["♠","♥","♦","♣"];
  const ranks = {11:"J",12:"Q",13:"K",14:"A"};
  const r = card.r ? (ranks[card.r]||card.r) : "?";
  const s = (card.s!=null && card.s>=0)? suits[card.s]:"?";
  return <div className="box">{r}{s}</div>;
}

// --- 룰렛 뷰 ---
function Roulette({bullets, loser}:{bullets:number, loser:Seat}){
  const [pos,setPos]=useState(0);
  const [spinning,setSpinning]=useState(true);
  const [hit,setHit]=useState(false);

  useEffect(()=>{
    const spins=Math.floor(Math.random()*10)+10;
    let i=0;
    const t=setInterval(()=>{
      setPos(p=>(p+1)%6);
      i++;
      if(i>=spins){
        clearInterval(t);
        setSpinning(false);
        // 총알 채워진 곳
        const chambers=Array.from({length:6},(_,i)=>i);
        const loaded=shuffle(chambers).slice(0,bullets);
        if(loaded.includes(pos)) setHit(true);
      }
    },200);
    return ()=>clearInterval(t);
  },[bullets,pos]);

  return (
    <div className="card center" style={{marginTop:32}}>
      <div className="sub">Roulette for {loser}</div>
      <div className="big">{hit?"BANG!":"SAFE"}</div>
    </div>
  );
}

function shuffle<T>(a:T[]):T[]{ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;}

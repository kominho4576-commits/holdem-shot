import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "../lib/socket";

type Seat = "P1" | "P2";
type Card = { r?: number; s?: number; isJoker?: boolean; back?: true };

export default function Game() {
  const nav = useNavigate();
  const loc = useLocation();

  const [roomId, setRoomId] = useState<string>((loc.state as any)?.roomId || "");
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

  useEffect(()=>{
    const onState = (p:any) => {
      setRoomId(p.roomId); setPhase(p.phase); setRound(p.round);
      setBoard(p.board); setYou(p.you); setOpp(p.opponent);
      setTurn(p.turn); setReadyCount(p.readyCount);
    };
    socket.on("game:state", onState);
    socket.on("game:phase",(p:any)=>{ setPhase(p.phase); setRound(p.round); });
    socket.on("game:swap:blink",(p:any)=>{ /* TODO highlight */ });
    socket.on("game:result",(p:any)=>{ setResult({winnerSeat:p.winnerSeat, round:p.round}); });
    socket.on("game:roulette",(p:any)=>{ setRoulette({active:true, bullets:p.bullets, loser:p.loserSeat}); });
    return ()=>{
      socket.off("game:state", onState);
      socket.off("game:phase"); socket.off("game:swap:blink");
      socket.off("game:result"); socket.off("game:roulette");
    };
  },[]);

  function toggleCard(idx:number){
    setSelected(sel => sel.includes(idx) ? sel.filter(i=>i!==idx) : [...sel, idx]);
  }

  function onReady(){
    const keep = [0,1].filter(i=>!selected.includes(i));
    if(!roomId) return;
    socket.emit("game:ready",{roomId, keepIndexes:keep});
    setSelected([]);
  }

  function onSurrender(){
    if(!roomId) return;
    if(window.confirm("Are you sure you want to surrender?")){
      socket.emit("game:surrender",{roomId});
    }
  }

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

      <div className="row card-row">
        {board.map((c,i)=><CardView key={i} card={c}/>)}
      </div>

      <div className="row mine">
        {you.map((c,i)=>
          <div key={i} onClick={()=>toggleCard(i)} className={selected.includes(i)?"sel":""}>
            <CardView card={c}/>
          </div>
        )}
      </div>

      <div className="row btns">
        <button className="btn btn-big" onClick={onReady}>Ready {readyCount}/2</button>
        <button className="btn btn-big" onClick={onSurrender}>Surrender</button>
      </div>

      <div className="row opp">
        {opp.map((c,i)=><CardView key={i} card={c}/>)}
      </div>

      {roulette.active && <Roulette bullets={roulette.bullets} loser={roulette.loser!} />}
    </div>
  );
}

function CardView({card}:{card:Card}){
  if(card.back) return <div className="box card-rect">🂠</div>;
  if(card.isJoker) return <div className="box card-rect">JOKER</div>;
  const suits = ["♠","♥","♦","♣"];
  const ranks:{[k:number]:string} = {11:"J",12:"Q",13:"K",14:"A"};
  const r = card.r ? (ranks[card.r]||String(card.r)) : "?";
  const s = (card.s!=null && card.s>=0)? suits[card.s]:"?";
  return <div className="box card-rect">{r}{s}</div>;
}

function Roulette({bullets, loser}:{bullets:number, loser:Seat}){
  const [pos,setPos]=useState(0);
  const [hit,setHit]=useState(false);

  useEffect(()=>{
    const wait = setTimeout(()=>{ // 5초 대기 후 룰렛 돌리기
      const spins = Math.floor(Math.random()*10)+10;
      let i=0; const t=setInterval(()=>{
        setPos(p=>(p+1)%6);
        i++; if(i>=spins){ clearInterval(t);
          const chambers=[0,1,2,3,4,5];
          const loaded = shuffle(chambers).slice(0, Math.min(6, bullets));
          setHit(loaded.includes((pos)%6));
        }
      },180);
    }, 5000);
    return ()=>clearTimeout(wait);
  },[bullets]);

  return (
    <div className="card center" style={{marginTop:32}}>
      <div className="sub">Roulette for {loser}</div>
      <div className="big" style={{color: hit? "#e74c3c" : "#2ecc71"}}>{hit?"BANG!":"SAFE"}</div>
    </div>
  );
}
function shuffle<T>(a:T[]):T[]{ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;}

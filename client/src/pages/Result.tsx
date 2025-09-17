import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function Result(){
  const nav=useNavigate();
  const loc=useLocation();
  const state=loc.state as any;

  useEffect(()=>{
    const t=setTimeout(()=>nav("/",{replace:true}),5000);
    return ()=>clearTimeout(t);
  },[nav]);

  if(!state) return <div className="center-col"><div className="h1">Result</div></div>;

  const win = state.winnerSeat==="P1";
  return (
    <div className="center-col">
      <div className="h1">{win?"Victory":"Defeat"}</div>
      <div className="card center">
        <div>Winner: {state.winnerSeat}</div>
        <div>Round: {state.round}</div>
      </div>
    </div>
  );
}

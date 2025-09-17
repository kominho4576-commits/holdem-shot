import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ServerPill from "../components/ServerPill";
import { socket } from "../lib/socket";

export default function Home() {
  const nav = useNavigate();
  const [nickname, setNickname] = useState("");
  const [createdCode, setCreatedCode] = useState("");  // 서버가 준 코드만 표시
  const [joinCode, setJoinCode] = useState("");
  const once = useRef(false);

  // 서버에 닉네임 등록
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    socket.emit("home:hello", { nickname });
  }, []);

  // 방/매치 이벤트 → 즉시 네비게이트
  useEffect(() => {
    const toMatch = () => nav("/match", { replace: true });
    const toGame = (p:any) => nav("/game", { replace: true, state: p });

    socket.on("match:queued", toMatch);
    socket.on("match:paired", toMatch);
    socket.on("room:joined", toMatch);       // 코드 매치에서 대기 화면으로
    socket.on("match:started", toGame);      // 바로 게임으로

    // 코드 생성 결과
    socket.on("room:created", (p:{roomId:string}) => setCreatedCode(p.roomId));
    socket.on("room:join:error", (e) => alert(e.message || "Join failed"));

    return () => {
      socket.off("match:queued", toMatch);
      socket.off("match:paired", toMatch);
      socket.off("room:joined", toMatch);
      socket.off("match:started", toGame);
      socket.off("room:created");
      socket.off("room:join:error");
    };
  }, [nav]);

  function onQuick() {
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER1";
    socket.emit("home:hello", { nickname: nick });
    socket.emit("match:quick");
  }

  function onCreateRoom() {
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER1";
    setCreatedCode("..."); // 서버 응답 대기
    socket.emit("home:hello", { nickname: nick });
    socket.emit("room:create");
  }

  function onJoinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter 6-letter code");
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER2";
    socket.emit("home:hello", { nickname: nick });
    socket.emit("room:join", { roomId: code });
  }

  return (
    <div className="center-col">
      <div className="h1">Hold’em&Shot.io</div>

      <div className="card card-home">
        {/* Row1 */}
        <div className="row wrap">
          <input className="input grow" placeholder="Nickname" value={nickname}
                 onChange={(e)=>setNickname(e.target.value)} />
          <button className="btn btn-big" onClick={onQuick}>Quick Match</button>
        </div>

        {/* Row2 */}
        <div className="row wrap">
          <button className="btn btn-big" onClick={onCreateRoom}>Create Room</button>
          <div className="input codebox fixed" aria-label="room-code">{createdCode}</div>
        </div>

        {/* Row3 */}
        <div className="row wrap">
          <input className="input grow" placeholder="Enter Code"
                 value={joinCode} onChange={(e)=>setJoinCode(e.target.value.toUpperCase())}/>
          <button className="btn btn-big" onClick={onJoinRoom}>Join Room</button>
        </div>
      </div>

      <div style={{width:"min(520px,92vw)"}}>
        <ServerPill />
      </div>
    </div>
  );
}

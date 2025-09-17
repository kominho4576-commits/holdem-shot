import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ServerPill from "../components/ServerPill";
import { socket } from "../lib/socket";

function six() {
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, ()=> ABC[Math.floor(Math.random()*ABC.length)]).join("");
}

export default function Home() {
  const nav = useNavigate();
  const [nickname, setNickname] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const once = useRef(false);

  // 서버에 닉네임 등록
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    socket.emit("home:hello", { nickname });
    socket.on("home:hello:ack", () => {});
    return () => {
      socket.off("home:hello:ack");
    };
  }, []);

  // 방 입장/매칭 이벤트
  useEffect(() => {
    const toMatch = () => nav("/match", { replace: true });
    socket.on("match:queued", toMatch);
    socket.on("match:paired", toMatch);
    return () => {
      socket.off("match:queued", toMatch);
      socket.off("match:paired", toMatch);
    };
  }, [nav]);

  function onQuick() {
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER1";
    socket.emit("home:hello", { nickname: nick });
    socket.emit("match:quick");
  }

  function onCreateRoom() {
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER1";
    socket.emit("home:hello", { nickname: nick });
    socket.emit("room:create");
    // 서버에서 코드 알려주지만, 스케치처럼 오른쪽 빈칸에 미리 보여주기 위해 프론트에서도 생성 표시
    setCreateCode(six());
  }

  function onJoinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter 6-letter code");
    const nick = nickname.trim().length ? nickname.trim() : "PLAYER2";
    socket.emit("home:hello", { nickname: nick });
    socket.emit("room:join", { roomId: code });
  }

  // 서버에서 실제 생성된 코드 반영
  useEffect(() => {
    const onCreated = (p: { roomId: string }) => setCreateCode(p.roomId);
    socket.on("room:created", onCreated);
    socket.on("room:join:error", (e) => alert(e.message || "Join failed"));
    return () => {
      socket.off("room:created", onCreated);
      socket.off("room:join:error");
    };
  }, []);

  return (
    <div className="center-col">
      <div className="h1">Hold’em&Shot.io</div>

      <div className="card">
        <div className="row">
          <input
            className="input"
            placeholder="Nickname"
            value={nickname}
            onChange={(e)=>setNickname(e.target.value)}
          />
          <button className="btn" onClick={onQuick}>Quick Match</button>
        </div>

        <div className="row">
          <button className="btn" onClick={onCreateRoom}>Create Room</button>
          <div className="input codebox" aria-label="room-code">{createCode}</div>
        </div>

        <div className="row">
          <input
            className="input"
            placeholder="Enter Code"
            value={joinCode}
            onChange={(e)=>setJoinCode(e.target.value.toUpperCase())}
          />
          <button className="btn" onClick={onJoinRoom}>Join Room</button>
        </div>
      </div>

      <div style={{width:"min(520px,92vw)"}}>
        <ServerPill />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../lib/socket";

export default function Home() {
  const nav = useNavigate();
  const [nickname, setNickname] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // nickname 등록
  useEffect(() => {
    socket.emit("home:hello", { nickname });
    const ack = (p: any) => {
      if (!nickname && p?.nickname) setNickname(p.nickname);
    };
    socket.on("home:hello:ack", ack);
    return () => socket.off("home:hello:ack", ack);
  }, [nickname]);

  // 매치 이벤트 바인딩
  useEffect(() => {
    const onQueued = () => nav("/match", { replace: true });
    const onPaired = (p: any) => {
      if (p?.role) sessionStorage.setItem("seatRole", p.role);
      nav("/match", { replace: true });
    };
    const onStarted = (p: any) => {
      if (p?.yourSeat) sessionStorage.setItem("mySeat", p.yourSeat);
      nav("/game", { replace: true, state: p });
    };

    socket.on("match:queued", onQueued);
    socket.on("match:paired", onPaired);
    socket.on("match:started", onStarted);
    return () => {
      socket.off("match:queued", onQueued);
      socket.off("match:paired", onPaired);
      socket.off("match:started", onStarted);
    };
  }, [nav]);

  // 룸 관련
  useEffect(() => {
    const onCreated = (p: any) => {
      setCreatedCode(p.roomId || "");
      setShowCreate(true);
    };
    const onJoinError = (p: any) => alert(p?.message || "Join failed");

    socket.on("room:created", onCreated);
    socket.on("room:join:error", onJoinError);
    return () => {
      socket.off("room:created", onCreated);
      socket.off("room:join:error", onJoinError);
    };
  }, []);

  const handleQuick = () => {
    if (!nickname.trim()) {
      alert("Enter a nickname first");
      return;
    }
    socket.emit("home:hello", { nickname: nickname.trim() });
    socket.emit("match:quick");
  };

  const handleCreate = () => {
    if (!nickname.trim()) {
      alert("Enter a nickname first");
      return;
    }
    socket.emit("home:hello", { nickname: nickname.trim() });
    socket.emit("room:create");
  };

  const handleJoinOpen = () => {
    setShowJoin(true);
    setJoinCode("");
  };

  const handleJoinConfirm = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    socket.emit("room:join", { roomId: code });
  };

  return (
    <div className="page home">
      <div className="title">Hold’em&Shot.io</div>

      {/* 상단: 닉네임 + 퀵 매치 나란히 */}
      <div className="card home-card">
        <div className="form-grid">
          <input
            className="input"
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <button className="btn btn-solid" onClick={handleQuick}>Quick Match</button>
        </div>

        {/* 하단: 반반 버튼 */}
        <div className="two-grid">
          <button className="btn" onClick={handleCreate}>Create Room</button>
          <button className="btn" onClick={handleJoinOpen}>Join Room</button>
        </div>
      </div>

      {/* Create Room Sheet */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div className="modal-title">Room Created</div>
          <div className="code-big">{createdCode || "------"}</div>
          <div className="two-grid">
            <button className="btn" onClick={() => setShowCreate(false)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Join Room Sheet */}
      {showJoin && (
        <Modal onClose={() => setShowJoin(false)}>
          <div className="modal-title">Join Room</div>
          <input
            className="input"
            placeholder="Enter Code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <div className="two-grid">
            <button className="btn" onClick={() => setShowJoin(false)}>Close</button>
            <button className="btn btn-solid" onClick={handleJoinConfirm}>Confirm</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: any; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

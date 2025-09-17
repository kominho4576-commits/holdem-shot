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

  useEffect(() => {
    socket.emit("home:hello", { nickname });
    const ack = (p: any) => {
      if (!nickname && p?.nickname) setNickname(p.nickname);
    };
    socket.on("home:hello:ack", ack);
    return () => socket.off("home:hello:ack", ack);
  }, [nickname]);

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

  const mustName = () => {
    if (!nickname.trim()) {
      alert("Enter a nickname first");
      return false;
    }
    socket.emit("home:hello", { nickname: nickname.trim() });
    return true;
  };

  const handleQuick = () => {
    if (!mustName()) return;
    socket.emit("match:quick");
  };

  const handleCreate = () => {
    if (!mustName()) return;
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

      <div className="card home-card">
        {/* 모바일에서 버튼 어긋남 방지: 열 폭 자동, 버튼은 고정최대폭 */}
        <div className="form-grid">
          <input
            className="input"
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <button className="btn btn-solid btn-qm" onClick={handleQuick}>
            Quick Match
          </button>
        </div>

        <div className="two-grid">
          <button className="btn" onClick={handleCreate}>Create Room</button>
          <button className="btn" onClick={handleJoinOpen}>Join Room</button>
        </div>
      </div>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div className="modal-title">Room Created</div>
          <div className="code-big">{createdCode || "------"}</div>
          <div className="two-grid">
            <button className="btn" onClick={() => setShowCreate(false)}>Close</button>
          </div>
        </Modal>
      )}

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

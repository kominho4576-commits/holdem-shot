import { useEffect, useMemo, useState } from "react";
import { isOnline, onOnlineChange, pingServer, socket } from "../lib/socket";

const aiNames = [
  "RoboJoe","Maverick","NeonFox","IvyBot","ZeroNine","DeltaAI",
  "Helix","Quartz","Nova","Pixel","Orbit","Zephyr",
];
function randomAI() {
  return aiNames[Math.floor(Math.random() * aiNames.length)];
}

export default function HomePage() {
  const [nickname, setNickname] = useState("");
  const [serverUp, setServerUp] = useState(isOnline());
  const [busy, setBusy] = useState<"quick" | "create" | "join" | null>(null);

  useEffect(() => {
    const off = onOnlineChange(setServerUp);
    return () => off();
  }, []);

  async function refreshServer() {
    const ok = await pingServer();
    setServerUp(ok);
  }

  // 오프라인 즉시 AI와 시작
  function startOfflineQuick() {
    const me = nickname.trim() || "PLAYER";
    const ai = randomAI();
    // Game.tsx에서 mode=offline 처리
    window.location.href = `/game?mode=offline&me=${encodeURIComponent(me)}&op=${encodeURIComponent(ai)}`;
  }

  // 퀵매치: 오프라인이면 AI, 온라인이면 서버 매칭
  function onQuickMatch() {
    if (!serverUp) {
      startOfflineQuick();
      return;
    }
    if (busy) return;
    setBusy("quick");
    const me = (nickname || "").trim() || "PLAYER";
    socket.emit(
      "quick:join",
      { nickname: me },
      (resp: { ok: boolean; roomId?: string; error?: string }) => {
        setBusy(null);
        if (!resp?.ok || !resp.roomId) {
          alert(resp?.error ?? "Matching failed. Starting offline vs AI.");
          startOfflineQuick();
          return;
        }
        window.location.href = `/game?room=${resp.roomId}&nick=${encodeURIComponent(me)}`;
      }
    );
  }

  function onCreateRoom() {
    if (!serverUp) {
      alert("Offline. Create Room is available only online.");
      return;
    }
    if (busy) return;
    setBusy("create");
    const me = (nickname || "").trim() || "PLAYER";
    socket.emit(
      "room:create",
      { nickname: me },
      (resp: { ok: boolean; roomId?: string; error?: string }) => {
        setBusy(null);
        if (!resp?.ok || !resp.roomId) {
          alert(resp?.error ?? "Create room failed.");
          return;
        }
        window.location.href = `/game?room=${resp.roomId}&nick=${encodeURIComponent(me)}`;
      }
    );
  }

  function onJoinRoom() {
    if (!serverUp) {
      alert("Offline. Join Room is available only online.");
      return;
    }
    const code = prompt("Enter 6-character room code");
    if (!code || busy) return;
    setBusy("join");
    const me = (nickname || "").trim() || "PLAYER";
    socket.emit(
      "room:join",
      { code: code.trim().toUpperCase(), nickname: me },
      (resp: { ok: boolean; roomId?: string; error?: string }) => {
        setBusy(null);
        if (!resp?.ok || !resp.roomId) {
          alert(resp?.error ?? "Join failed.");
          return;
        }
        window.location.href = `/game?room=${resp.roomId}&nick=${encodeURIComponent(me)}`;
      }
    );
  }

  const quickLabel = useMemo(() => {
    if (!serverUp) return "Quick Match (vs AI)";
    return busy === "quick" ? "Matching..." : "Quick Match";
  }, [serverUp, busy]);

  return (
    <div className="page home">
      <h1 className="title">Hold’em&Shot.io</h1>

      <div className="home-card" role="region" aria-label="Match controls">
        {/* 서버 상태 표시 */}
        <div className="server-status">
          <span className={`dot ${serverUp ? "green" : "red"}`} aria-hidden />
          <span className="label">
            Server: {serverUp ? "Online" : "Offline"}
          </span>
          <button className="link-btn" onClick={refreshServer}>
            Refresh
          </button>
        </div>

        {/* 닉네임 + 퀵매치 (가로 배치, 겹침 방지) */}
        <div className="row nowrap">
          <input
            className="input"
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={18}
            autoCapitalize="off"
            autoCorrect="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") onQuickMatch();
            }}
          />
          <button
            className="btn primary quick-btn"
            onClick={onQuickMatch}
            disabled={busy === "quick"}
            aria-busy={busy === "quick"}
            aria-label="Quick Match"
          >
            {quickLabel}
          </button>
        </div>

        {/* Create / Join */}
        <div className="row two">
          <button
            className="btn ghost"
            onClick={onCreateRoom}
            disabled={!serverUp || busy === "create"}
            title={!serverUp ? "Online only" : undefined}
          >
            Create Room
          </button>
          <button
            className="btn ghost"
            onClick={onJoinRoom}
            disabled={!serverUp || busy === "join"}
            title={!serverUp ? "Online only" : undefined}
          >
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
}

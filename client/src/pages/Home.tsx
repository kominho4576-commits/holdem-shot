// client/src/pages/Home.tsx
import { useEffect, useMemo, useRef, useState } from "react";
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
  const navigatedRef = useRef(false); // 중복 네비게이션 방지

  useEffect(() => {
    const off = onOnlineChange(setServerUp);

    // 서버가 방을 만들면 바로 code를 줌 (createRoom 성공시)
    const onRoomCreated = ({ code }: { code: string }) => {
      setBusy(null);
      if (!code || navigatedRef.current) return;
      navigatedRef.current = true;
      const me = (nickname || "PLAYER").trim();
      window.location.href = `/game?room=${encodeURIComponent(code)}&nick=${encodeURIComponent(me)}`;
    };

    // 어떤 경로든 방에 조인되면 상태 브로드캐스트에 code가 포함됨
    const onState = (payload: any) => {
      setBusy(null);
      const code = payload?.code;
      if (!code || navigatedRef.current) return;
      navigatedRef.current = true;
      const me = (nickname || "PLAYER").trim();
      window.location.href = `/game?room=${encodeURIComponent(code)}&nick=${encodeURIComponent(me)}`;
    };

    // joinRoom 실패/코드 틀림 등
    const onRoomError = (err: { message?: string }) => {
      setBusy(null);
      alert("❌ " + (err?.message || "Operation failed."));
    };

    socket.on("roomCreated", onRoomCreated);
    socket.on("state", onState);
    socket.on("error:room", onRoomError);

    return () => {
      off();
      socket.off("roomCreated", onRoomCreated);
      socket.off("state", onState);
      socket.off("error:room", onRoomError);
    };
  }, [nickname]);

  async function refreshServer() {
    const ok = await pingServer();
    setServerUp(ok);
  }

  // 오프라인 즉시 AI와 시작
  function startOfflineQuick() {
    const me = nickname.trim() || "PLAYER";
    const ai = randomAI();
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
    // 🔑 서버 index.ts와 동일한 이벤트명
    socket.emit("quickMatch", { nickname: me });
    // 성공 시 서버가 우리 소켓을 방에 조인시키고 "state" 브로드캐스트 → onState에서 이동
  }

  function onCreateRoom() {
    if (!serverUp) {
      alert("Offline. Create Room is available only online.");
      return;
    }
    if (busy) return;
    setBusy("create");
    const me = (nickname || "").trim() || "PLAYER";
    // 🔑 서버 index.ts와 동일한 이벤트명
    socket.emit("createRoom", { nickname: me });
    // 성공 시 서버가 "roomCreated"로 code 전달 → onRoomCreated에서 이동
  }

  function onJoinRoom() {
    if (!serverUp) {
      alert("Offline. Join Room is available only online.");
      return;
    }
    const code = prompt("Enter 6-character room code");
    if (!code) return;

    const c = code.trim().toUpperCase();
    // 0,1,O,I 제외한 6자리: A-H J-K M N P-Z, 2-9
    const valid = /^[A-HJ-KMNP-Z2-9]{6}$/.test(c);
    if (!valid) {
      alert("❌ Invalid code. Use 6 chars (A–Z except O/I, 2–9).");
      return;
    }

    if (busy) return;
    setBusy("join");
    const me = (nickname || "").trim() || "PLAYER";
    // 🔑 서버 index.ts와 동일한 이벤트명
    socket.emit("joinRoom", { code: c, nickname: me });
    // 성공 시 서버가 방에 조인시키고 "state" 브로드캐스트 → onState에서 이동
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

        {/* 닉네임 + 퀵매치 */}
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

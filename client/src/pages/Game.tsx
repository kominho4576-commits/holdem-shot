// client/src/pages/Game.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../lib/socket";

/** ---------- URL Params ---------- */
function useQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get("mode") || "online",
    room: params.get("room") || "",
    nick: params.get("nick") || "PLAYER",
  };
}

/** ---------- Types (클라 표시용) ---------- */
type Phase = "dealing" | "flop" | "turn" | "river" | "showdown" | "roulette";
type Card = { rank: string; suit: string }; // 서버와 동일 형태 사용
type PlayerPub = { id: string; nickname: string; isAI: boolean; ready: boolean };

type ServerState = {
  code: string;
  phase: Phase;
  round: number;
  board: Card[];
  players: PlayerPub[];
  turnIndex: 0 | 1;
  exchangeStep: 0 | 1; // 0: 선턴, 1: 후턴
};

/** ---------- 스타일 헬퍼 ---------- */
const S = {
  page: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gridTemplateRows: "auto 1fr",
    height: "100vh",
    background: "#f7f7fb",
  } as React.CSSProperties,
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: "1px solid #e9e7ff",
    background: "#fff",
  } as React.CSSProperties,
  dot: (on: boolean) =>
    ({
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: on ? "#2ecc71" : "#ddd",
      boxShadow: "0 0 0 2px rgba(0,0,0,0.06)",
    }) as React.CSSProperties,
  title: { fontWeight: 900, color: "#6e63d3", fontSize: 20 } as React.CSSProperties,
  main: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gridTemplateRows: "1fr",
    gap: 12,
    padding: 12,
  } as React.CSSProperties,
  pane: {
    background: "#fff",
    border: "2px solid #6e63d3",
    borderRadius: 16,
    padding: 12,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,
  sectionTitle: { fontWeight: 800, color: "#6e63d3", marginBottom: 8 } as React.CSSProperties,
  playersRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  playerTag: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
    fontSize: 14,
    background: "#f1efff",
    borderRadius: 10,
    padding: "6px 8px",
  } as React.CSSProperties,
  gridCenter: {
    display: "grid",
    placeItems: "center",
    flex: 1,
  } as React.CSSProperties,
  controlsRow: {
    display: "flex",
    gap: 8,
    marginTop: 8,
  } as React.CSSProperties,
  btn: (primary = false) =>
    ({
      flex: 1,
      height: 44,
      borderRadius: 12,
      border: "2px solid #6e63d3",
      background: primary ? "#6e63d3" : "#fff",
      color: primary ? "#fff" : "#6e63d3",
      fontWeight: 800,
      cursor: "pointer",
    }) as React.CSSProperties,
  small: { fontSize: 12, color: "#6e63d3", fontWeight: 700 } as React.CSSProperties,
};

/** ---------- 카드 UI ---------- */
function CardBack({ w = 72, h = 104, flash = false }: { w?: number; h?: number; flash?: boolean }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 12,
        border: "2px solid #6e63d3",
        background:
          "repeating-linear-gradient(45deg, #e9e7ff, #e9e7ff 6px, #d7d3ff 6px, #d7d3ff 12px)",
        boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
        outline: flash ? "4px solid rgba(255,200,0,0.9)" : "none",
        transition: "outline 120ms",
      }}
    />
  );
}

function CardFront({
  card,
  w = 72,
  h = 104,
  selected = false,
  onClick,
}: {
  card: Card;
  w?: number;
  h?: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  const suitMap: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣", X: "★" };
  const color = card.suit === "H" || card.suit === "D" ? "#e74c3c" : "#2c3e50";
  return (
    <button
      onClick={onClick}
      style={{
        width: w,
        height: h,
        borderRadius: 12,
        border: selected ? "4px solid #fff" : "2px solid #6e63d3",
        background: "#fff",
        boxShadow: selected
          ? "0 0 0 3px #6e63d3, 0 6px 14px rgba(0,0,0,0.12)"
          : "0 4px 10px rgba(0,0,0,0.06)",
        cursor: onClick ? "pointer" : "default",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ textAlign: "center", lineHeight: 1 }}>
        <div style={{ fontSize: 24, color, fontWeight: 900 }}>
          {card.rank === "JOKER" ? "JOKER" : card.rank}
        </div>
        <div style={{ fontSize: 24, color }}>{suitMap[card.suit] ?? ""}</div>
      </div>
    </button>
  );
}

/** ---------- 룰렛 UI ---------- */
function RouletteView({
  bullets,
  startPos = 0,
  stopPos = 0,
  spins = 3,
  running = false,
  resultText,
}: {
  bullets: number[];
  startPos?: number;
  stopPos?: number;
  spins?: number;
  running?: boolean;
  resultText?: string;
}) {
  // 0..5 슬롯, 화살표는 12시
  const step = 60; // deg
  // 화살표 기준으로 stopPos가 오도록 바퀴를 반시계(-)로 회전
  const totalDeg = -(spins * 360 + ((stopPos - startPos + 6) % 6) * step);

  return (
    <div style={{ ...S.gridCenter }}>
      <div style={{ position: "relative", width: 260, height: 260 }}>
        {/* 화살표 */}
        <div
          style={{
            position: "absolute",
            top: -8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "10px solid transparent",
            borderRight: "10px solid transparent",
            borderTop: "18px solid #2c3e50",
            zIndex: 3,
          }}
        />
        {/* 바퀴 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "4px solid #6e63d3",
            transition: running ? "transform 4.8s cubic-bezier(0.17,0.84,0.44,1)" : undefined,
            transform: running ? `rotate(${totalDeg}deg)` : `rotate(0deg)`,
          }}
        >
          {/* 6 슬롯 */}
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const angle = i * step;
            const cx = 130 + Math.sin((angle * Math.PI) / 180) * 90;
            const cy = 130 - Math.cos((angle * Math.PI) / 180) * 90;
            const filled = bullets.includes(i);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: cx - 16,
                  top: cy - 16,
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "2px solid #6e63d3",
                  background: filled ? "#e74c3c" : "#fff",
                }}
              />
            );
          })}
        </div>
      </div>
      {resultText && (
        <div
          style={{
            marginTop: 12,
            fontWeight: 900,
            color: resultText === "BANG!" ? "#e74c3c" : "#2ecc71",
            fontSize: 28,
          }}
        >
          {resultText}
        </div>
      )}
    </div>
  );
}

/** ---------- 온라인 게임 화면 ---------- */
function OnlineGame() {
  const { room, nick } = useQuery();
  const [st, setSt] = useState<ServerState | null>(null);
  const [myId, setMyId] = useState<string | null>(socket.id ?? null);
  const [mySel, setMySel] = useState<Set<number>>(new Set()); // 0/1 선택
  const [oppFlash, setOppFlash] = useState(false);
  const [roulette, setRoulette] = useState<{
    bullets: number[];
    startPos: number;
    stopPos: number;
    spins: number;
    running: boolean;
    resultText?: string;
  } | null>(null);
  const [flashOverlay, setFlashOverlay] = useState<"red" | "white" | null>(null);

  // socket.id 초기화
  useEffect(() => {
    const onHello = (p: any) => setMyId(p?.id ?? socket.id);
    socket.on("hello", onHello);
    if (socket.connected && !myId) setMyId(socket.id);
    return () => {
      socket.off("hello", onHello);
    };
  }, [myId]);

  // 서버 상태 수신
  useEffect(() => {
    const onState = (payload: ServerState) => {
      // 교환 단계 변화 때 상대 깜빡 효과
      setOppFlash((prev) => {
        // 내가 아닌 턴에서 exchangeStep이 토글되면 한번 깜빡
        return true;
      });
      setTimeout(() => setOppFlash(false), 180);

      // 라운드 전환/페이즈 전환 시 내 선택 초기화
      setMySel(new Set());
      setSt(payload);
    };
    const onPhase = (_: any) => {
      // Phase 이벤트는 부가 알림. state가 실데이터.
    };

    const onRoundResult = (_: any) => {
      // 서버가 즉시 roulette:start를 내보내므로 여기선 표기만.
      // 별도 카운트다운은 서버 타이밍에 맡긴다.
    };

    const onRouletteStart = (p: {
      bullets: number;
      exempt: boolean;
      chambers: number;
      bulletSlots: number[];
      startPos?: number;
      spins?: number;
      stopPos?: number;
    }) => {
      // 러시안룰렛 화면으로 전환
      setSt((old) => (old ? { ...old, phase: "roulette" } : old));
      setRoulette({
        bullets: p.bulletSlots ?? [],
        startPos: p.startPos ?? 0,
        stopPos: p.stopPos ?? 0,
        spins: p.spins ?? 3,
        running: true,
      });
    };

    const onRouletteResult = (p: { bang: boolean; loser: 0 | 1 }) => {
      // 회전 애니메이션은 약 4.8s로 맞춤 → 결과 표시만 업데이트
      setRoulette((r) => (r ? { ...r, running: false, resultText: p.bang ? "BANG!" : "SAFE" } : r));

      // 화면 깜빡: 내가 맞으면 빨강, 상대가 맞으면 하양
      setSt((cur) => {
        if (!cur) return cur;
        const meIdx = cur.players.findIndex((pl) => pl.id === myId);
        if (meIdx === -1) return cur;
        if (p.bang) setFlashOverlay(meIdx === p.loser ? "red" : "white");
        setTimeout(() => setFlashOverlay(null), 280);
        return cur;
      });
    };

    const onGameEnd = (p: { winner: 0 | 1; loser: 0 | 1 }) => {
      // 1초 후 결과 화면 이동 → 결과 화면에서 3초 카운트 후 홈 복귀 예정
      setTimeout(() => {
        const meIdx =
          st?.players?.findIndex((pl) => pl.id === myId) ?? -1;
        const iWon = meIdx !== -1 && p.winner === meIdx;
        window.location.href = `/result?win=${iWon ? 1 : 0}`;
      }, 1000);
    };

    socket.on("state", onState);
    socket.on("phase", onPhase);
    socket.on("round:result", onRoundResult);
    socket.on("roulette:start", onRouletteStart);
    socket.on("roulette:result", onRouletteResult);
    socket.on("game:end", onGameEnd);

    return () => {
      socket.off("state", onState);
      socket.off("phase", onPhase);
      socket.off("round:result", onRoundResult);
      socket.off("roulette:start", onRouletteStart);
      socket.off("roulette:result", onRouletteResult);
      socket.off("game:end", onGameEnd);
    };
  }, [myId, st?.players]);

  const myIdx = useMemo(() => {
    if (!st || !myId) return -1;
    return st.players.findIndex((p) => p.id === myId);
  }, [st, myId]);

  const oppIdx = useMemo(() => {
    if (myIdx === -1 || !st) return -1;
    return (myIdx === 0 ? 1 : 0) as 0 | 1;
  }, [myIdx, st]);

  const isMyTurn = useMemo(() => {
    if (!st || myIdx === -1) return false;
    if (!["flop", "turn", "river"].includes(st.phase)) return false;
    const expected =
      st.exchangeStep === 0 ? st.turnIndex : (st.turnIndex === 0 ? 1 : 0);
    return expected === myIdx;
  }, [st, myIdx]);

  /** Ready / Exchange / Surrender */
  function onReadyOrExchange() {
    if (!st) return;
    if (st.phase === "dealing") {
      socket.emit("ready", { code: st.code, ready: true });
      return;
    }
    if (["flop", "turn", "river"].includes(st.phase)) {
      if (!isMyTurn) return; // 내 차례가 아니면 무시
      const indices = Array.from(mySel).filter((i) => i === 0 || i === 1).slice(0, 2);
      socket.emit("exchange", { code: st.code, indices });
      setMySel(new Set());
      return;
    }
  }

  function onSurrender() {
    if (!st) return;
    if (!confirm("Are you sure you want to surrender?")) return;
    socket.emit("surrender", { code: st.code });
  }

  /** 카드 선택 (최대 2장) */
  function toggleSelect(i: 0 | 1) {
    if (!st) return;
    if (!["flop", "turn", "river"].includes(st.phase)) return;
    if (!isMyTurn) return;
    setMySel((old) => {
      const next = new Set(old);
      if (next.has(i)) next.delete(i);
      else {
        if (next.size >= 2) return next;
        next.add(i);
      }
      return next;
    });
  }

  /** 보드 공개 수(phase에 맞게) */
  const revealCount = useMemo(() => {
    if (!st) return 0;
    if (st.phase === "flop") return 3;
    if (st.phase === "turn") return 4;
    if (st.phase === "river" || st.phase === "showdown" || st.phase === "roulette") return 5;
    return 0;
  }, [st]);

  // 플레이어 라벨/턴표시
  function PlayerBadge({ who }: { who: 0 | 1 }) {
    const p = st?.players?.[who];
    const isTurn = isMyTurn && who === myIdx;
    return (
      <div style={S.playerTag}>
        <span style={S.dot(isTurn)} />
        <span>{p?.nickname || (who === 0 ? "PLAYER1" : "PLAYER2")}</span>
      </div>
    );
  }

  // 상대가 없는 경우
  if (!st || myIdx === -1 || oppIdx === -1) {
    return (
      <div style={S.page}>
        <div style={S.topBar}>
          <div style={S.title}>Hold’em & SHOT</div>
          <div style={{ marginLeft: "auto", ...S.small }}>Room: {room || "-"}</div>
        </div>
        <div style={S.gridCenter as any}>
          <div style={{ fontSize: 18, color: "#6e63d3", fontWeight: 800 }}>
            Waiting for opponent…
          </div>
        </div>
      </div>
    );
  }

  // 메인 화면 (좌: 홀덤 / 우: 룰렛) — phase에 따라 보이기
  const phase = st.phase;

  return (
    <div style={S.page}>
      {/* 상단바 */}
      <div style={S.topBar}>
        <div style={S.title}>Hold’em & SHOT</div>
        <div style={{ marginLeft: 12, fontWeight: 800, color: "#6e63d3" }}>
          Phase: {phase.toUpperCase()}
        </div>
        <div style={{ marginLeft: 12, fontWeight: 800, color: "#6e63d3" }}>
          ROUND: {st.round}
        </div>
        <div style={{ marginLeft: "auto", ...S.small }}>Room: {st.code}</div>
      </div>

      <div style={S.main}>
        {/* 홀덤 패널 */}
        <div
          style={{
            ...S.pane,
            opacity: phase === "roulette" ? 0.35 : 1,
            filter: phase === "roulette" ? "grayscale(0.2)" : "none",
          }}
        >
          <div style={S.playersRow}>
            <PlayerBadge who={0} />
            <PlayerBadge who={1} />
          </div>

          {/* 상대 카드 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            <CardBack flash={oppFlash} />
            <CardBack flash={oppFlash} />
          </div>

          {/* 공유 카드 5장 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => {
              const card = st.board[i];
              const opened = i < revealCount;
              return opened && card ? (
                <CardFront key={i} card={card} />
              ) : (
                <CardBack key={i} />
              );
            })}
          </div>

          {/* 내 카드 2장 — 서버는 내 카드 내용을 브로드캐스트하지 않음(보안) → 앞면 표현은 UX용(오프라인에선 실제 카드 표시) */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            {/* 온라인에서는 앞면 정보가 없으므로 뒷면에 선택 테두리만 표현 */}
            {[0, 1].map((i) => (
              <div key={i} onClick={() => toggleSelect(i as 0 | 1)} style={{ cursor: "pointer" }}>
                <CardBack />
                {mySel.has(i as 0 | 1) && (
                  <div
                    style={{
                      position: "relative",
                      top: -104,
                      width: 72,
                      height: 104,
                      borderRadius: 12,
                      outline: "4px solid #fff",
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* 컨트롤 */}
          <div style={S.controlsRow}>
            <button
              style={S.btn(true)}
              onClick={onReadyOrExchange}
              disabled={
                phase === "dealing"
                  ? false
                  : !isMyTurn // 내 차례만 교환 가능
              }
            >
              {phase === "dealing" ? "Ready" : "Exchange"}
            </button>
            <button style={S.btn(false)} onClick={onSurrender}>
              Surrender
            </button>
          </div>
        </div>

        {/* 룰렛 패널 */}
        <div
          style={{
            ...S.pane,
            opacity: phase === "roulette" ? 1 : 0.35,
            filter: phase === "roulette" ? "none" : "grayscale(0.2)",
          }}
        >
          <div style={S.sectionTitle}>Russian Roulette</div>
          {phase !== "roulette" ? (
            <div style={{ ...S.gridCenter, color: "#6e63d3", fontWeight: 800 }}>
              Will spin after showdown…
            </div>
          ) : roulette ? (
            <RouletteView
              bullets={roulette.bullets}
              startPos={roulette.startPos}
              stopPos={roulette.stopPos}
              spins={roulette.spins}
              running={roulette.running}
              resultText={roulette.resultText}
            />
          ) : (
            <div style={{ ...S.gridCenter }}>Preparing…</div>
          )}
        </div>
      </div>

      {/* 깜빡임 오버레이 */}
      {flashOverlay && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: flashOverlay === "red" ? "rgba(231,76,60,0.45)" : "rgba(255,255,255,0.65)",
            animation: "flash 280ms ease",
            pointerEvents: "none",
          }}
        />
      )}
      <style>{`@keyframes flash{from{opacity:0}50%{opacity:1}to{opacity:0}}`}</style>
    </div>
  );
}

/** ---------- 오프라인(간소화) ---------- */
function OfflineGame() {
  // 간이 시뮬: 라운드가 진행되고, 결과는 랜덤. 룰렛은 정확히 동작.
  const [phase, setPhase] = useState<Phase>("dealing");
  const [round, setRound] = useState(1);
  const [board, setBoard] = useState<Card[]>([
    { rank: "?", suit: "S" },
    { rank: "?", suit: "H" },
    { rank: "?", suit: "D" },
    { rank: "?", suit: "C" },
    { rank: "?", suit: "S" },
  ]);
  const [exchangeStep, setExchangeStep] = useState<0 | 1>(0);
  const [turnIndex, setTurnIndex] = useState<0 | 1>(Math.random() < 0.5 ? 0 : 1);
  const [mySel, setMySel] = useState<Set<number>>(new Set());
  const [roulette, setRoulette] = useState<{
    bullets: number[];
    startPos: number;
    stopPos: number;
    spins: number;
    running: boolean;
    resultText?: string;
  } | null>(null);
  const [flashOverlay, setFlashOverlay] = useState<"red" | "white" | null>(null);

  function nextPhase() {
    if (phase === "dealing") {
      setPhase("flop");
    } else if (phase === "flop") {
      setPhase("turn");
    } else if (phase === "turn") {
      setPhase("river");
    } else if (phase === "river") {
      setPhase("showdown");
      setTimeout(() => startRoulette(), 800); // 쇼다운 표기 후 잠시 뒤 룰렛
    }
  }

  function onReadyOrExchange() {
    if (phase === "dealing") {
      nextPhase();
      return;
    }
    if (["flop", "turn", "river"].includes(phase)) {
      if (exchangeStep === 0) setExchangeStep(1);
      else {
        setExchangeStep(0);
        nextPhase();
      }
      setMySel(new Set());
      return;
    }
  }

  function startRoulette() {
    setPhase("roulette");
    const base = Math.min(round, 6);
    const bulletSlots: number[] = [];
    while (bulletSlots.length < base) {
      const n = (Math.random() * 6) | 0;
      if (!bulletSlots.includes(n)) bulletSlots.push(n);
    }
    const startPos = (Math.random() * 6) | 0;
    const stopPos = (Math.random() * 6) | 0;
    const spins = 2 + ((Math.random() * 4) | 0);
    setRoulette({
      bullets: bulletSlots,
      startPos,
      stopPos,
      spins,
      running: true,
    });
    setTimeout(() => {
      const bang = bulletSlots.includes(stopPos);
      setRoulette((r) => (r ? { ...r, running: false, resultText: bang ? "BANG!" : "SAFE" } : r));
      setFlashOverlay(bang ? "red" : null); // 싱글플레이 기준 내가 맞는 것으로 처리
      setTimeout(() => setFlashOverlay(null), 280);
      setTimeout(() => {
        if (bang) {
          window.location.href = `/result?win=0`;
        } else {
          // 생존 → 다음 라운드
          setRound((r) => r + 1);
          setPhase("dealing");
          setExchangeStep(0);
          setTurnIndex(turnIndex === 0 ? 1 : 0);
          setRoulette(null);
        }
      }, 1000);
    }, 4800);
  }

  return (
    <div style={S.page}>
      <div style={S.topBar}>
        <div style={S.title}>Hold’em & SHOT (Offline)</div>
        <div style={{ marginLeft: 12, fontWeight: 800, color: "#6e63d3" }}>
          Phase: {phase.toUpperCase()}
        </div>
        <div style={{ marginLeft: 12, fontWeight: 800, color: "#6e63d3" }}>ROUND: {round}</div>
      </div>

      <div style={S.main}>
        {/* 홀덤 */}
        <div
          style={{
            ...S.pane,
            opacity: phase === "roulette" ? 0.35 : 1,
            filter: phase === "roulette" ? "grayscale(0.2)" : "none",
          }}
        >
          <div style={S.playersRow}>
            <div style={S.playerTag}>
              <span style={S.dot(phase !== "dealing" && exchangeStep === (turnIndex === 0 ? 0 : 1))} />
              <span>PLAYER1</span>
            </div>
            <div style={S.playerTag}>
              <span style={S.dot(phase !== "dealing" && exchangeStep === (turnIndex === 1 ? 0 : 1))} />
              <span>PLAYER2</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            <CardBack />
            <CardBack />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            {Array.from({ length: 5 }).map((_, i) =>
              i < (phase === "flop" ? 3 : phase === "turn" ? 4 : phase === "river" || phase === "showdown" || phase === "roulette" ? 5 : 0) ? (
                <CardFront key={i} card={{ rank: "?", suit: ["S", "H", "D", "C", "S"][i] }} />
              ) : (
                <CardBack key={i} />
              )
            )}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            {[0, 1].map((i) => (
              <div key={i} onClick={() => {
                if (!["flop","turn","river"].includes(phase)) return;
                setMySel((old) => {
                  const next = new Set(old);
                  if (next.has(i)) next.delete(i);
                  else {
                    if (next.size >= 2) return next;
                    next.add(i);
                  }
                  return next;
                });
              }}>
                <CardBack />
                {mySel.has(i) && (
                  <div
                    style={{
                      position: "relative",
                      top: -104,
                      width: 72,
                      height: 104,
                      borderRadius: 12,
                      outline: "4px solid #fff",
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <div style={S.controlsRow}>
            <button style={S.btn(true)} onClick={onReadyOrExchange}>
              {phase === "dealing" ? "Ready" : "Exchange"}
            </button>
            <button
              style={S.btn(false)}
              onClick={() => {
                if (!confirm("Are you sure you want to surrender?")) return;
                window.location.href = "/result?win=0";
              }}
            >
              Surrender
            </button>
          </div>
        </div>

        {/* 룰렛 */}
        <div
          style={{
            ...S.pane,
            opacity: phase === "roulette" ? 1 : 0.35,
            filter: phase === "roulette" ? "none" : "grayscale(0.2)",
          }}
        >
          <div style={S.sectionTitle}>Russian Roulette</div>
          {phase !== "roulette" ? (
            <div style={{ ...S.gridCenter, color: "#6e63d3", fontWeight: 800 }}>
              Will spin after showdown…
            </div>
          ) : roulette ? (
            <RouletteView
              bullets={roulette.bullets}
              startPos={roulette.startPos}
              stopPos={roulette.stopPos}
              spins={roulette.spins}
              running={roulette.running}
              resultText={roulette.resultText}
            />
          ) : (
            <div style={{ ...S.gridCenter }}>Preparing…</div>
          )}
        </div>
      </div>

      {flashOverlay && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: flashOverlay === "red" ? "rgba(231,76,60,0.45)" : "rgba(255,255,255,0.65)",
            animation: "flash 280ms ease",
            pointerEvents: "none",
          }}
        />
      )}
      <style>{`@keyframes flash{from{opacity:0}50%{opacity:1}to{opacity:0}}`}</style>
    </div>
  );
}

/** ---------- 엔트리 ---------- */
export default function GamePage() {
  const { mode } = useQuery();
  if (mode === "offline") return <OfflineGame />;
  return <OnlineGame />;
}

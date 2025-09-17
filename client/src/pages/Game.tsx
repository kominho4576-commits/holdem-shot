// client/src/pages/Game.tsx
import React, { useEffect, useState } from "react";
import { socket } from "../lib/socket";

type Card = { rank: string; suit: string };
type Player = { id: string; nickname: string; isAI: boolean; ready: boolean };

export default function GamePage() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room") || "";
  const myNick = params.get("nick") || "PLAYER";

  const [phase, setPhase] = useState<string>("matching");
  const [round, setRound] = useState<number>(1);
  const [players, setPlayers] = useState<Player[]>([]);
  const [board, setBoard] = useState<Card[]>([]);
  const [turnIndex, setTurnIndex] = useState<number>(0);
  const [exchangeStep, setExchangeStep] = useState<number>(0);
  const [myCards, setMyCards] = useState<Card[]>([]);
  const [oppCards, setOppCards] = useState<number>(2);
  const [selected, setSelected] = useState<number[]>([]);
  const [roulette, setRoulette] = useState<any>(null);
  const [result, setResult] = useState<any>(null);

  // 상태 수신
  useEffect(() => {
    socket.emit("joinRoom", { code: room, nickname: myNick });

    socket.on("state", (s: any) => {
      setPhase(s.phase);
      setRound(s.round);
      setBoard(s.board);
      setPlayers(s.players);
      setTurnIndex(s.turnIndex);
      setExchangeStep(s.exchangeStep);
    });

    socket.on("round:result", (data: any) => {
      setResult(data);
      // 5초 후 러시안룰렛
      setTimeout(() => {
        setResult(null);
      }, 5000);
    });

    socket.on("roulette:start", (data: any) => {
      setRoulette({ ...data, show: true, result: null });
    });
    socket.on("roulette:result", (data: any) => {
      setRoulette((r: any) => ({ ...r, result: data }));
    });
    socket.on("game:end", (data: any) => {
      // 결과 화면으로 이동
      const win = data.winner === getMeIndex();
      window.location.href = `/result?win=${win ? 1 : 0}`;
    });

    return () => {
      socket.off("state");
      socket.off("round:result");
      socket.off("roulette:start");
      socket.off("roulette:result");
      socket.off("game:end");
    };
  }, []);

  // 내 index
  function getMeIndex() {
    return players.findIndex((p) => p.nickname === myNick);
  }

  function toggleSelect(i: number) {
    if (selected.includes(i)) {
      setSelected(selected.filter((x) => x !== i));
    } else {
      if (selected.length < 2) setSelected([...selected, i]);
    }
  }

  function onReady() {
    socket.emit("ready", { code: room, ready: true });
  }

  function onExchange() {
    socket.emit("exchange", { code: room, indices: selected });
    setSelected([]);
  }

  function onSurrender() {
    if (window.confirm("Are you sure you want to surrender?")) {
      socket.emit("surrender", { code: room });
    }
  }

  // 카드 UI
  function renderCard(c: Card, i: number, faceDown = false, selectable = false) {
    const sel = selected.includes(i);
    return (
      <div
        key={i}
        onClick={() => selectable && toggleSelect(i)}
        style={{
          width: 80,
          height: 120,
          border: "2px solid #333",
          borderRadius: 8,
          margin: 4,
          background: faceDown ? "#999" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: selectable ? "pointer" : "default",
          outline: sel ? "4px solid #fff" : "none",
        }}
      >
        {!faceDown && (
          <span style={{ fontSize: 20, fontWeight: "bold" }}>
            {c.rank}
            {c.suit}
          </span>
        )}
      </div>
    );
  }

  // 러시안룰렛 UI
  function renderRoulette() {
    if (!roulette) return null;
    const slots = Array.from({ length: 6 }, (_, i) =>
      roulette.bulletSlots?.includes(i)
    );
    return (
      <div style={{ textAlign: "center", marginTop: 40 }}>
        <h2>Russian Roulette</h2>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          {slots.map((hasBullet, i) => (
            <div
              key={i}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "2px solid #333",
                background:
                  roulette.result && roulette.result.stopPos === i
                    ? hasBullet
                      ? "red"
                      : "lime"
                    : "#eee",
              }}
            />
          ))}
        </div>
        {roulette.result && (
          <h3
            style={{
              color: roulette.result.bang ? "red" : "green",
              fontWeight: 900,
              fontSize: 32,
            }}
          >
            {roulette.result.bang ? "BANG!" : "SAFE"}
          </h3>
        )}
      </div>
    );
  }

  return (
    <div
      className="page game"
      style={{
        padding: 20,
        textAlign: "center",
        color: "#fff",
        background: "#2b2463",
        minHeight: "100vh",
      }}
    >
      <h1>Round {round}</h1>
      <h2>Phase: {phase}</h2>

      {/* 플레이어 */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {players.map((p, i) => (
          <div key={p.id} style={{ textAlign: "center", flex: 1 }}>
            <h3>
              {p.nickname}{" "}
              {i === turnIndex && phase !== "showdown" && "🟢"}
            </h3>
            {i === getMeIndex() ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                {myCards.map((c, j) =>
                  renderCard(c, j, false, phase !== "showdown")
                )}
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                {Array.from({ length: oppCards }).map((_, j) =>
                  renderCard({ rank: "?", suit: "?" }, j, true)
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 공유 카드 */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
        {board.map((c, i) =>
          renderCard(
            c.rank === "?" ? { rank: "?", suit: "?" } : c,
            i,
            c.rank === "?"
          )
        )}
      </div>

      {/* 버튼들 */}
      <div style={{ marginTop: 20 }}>
        {phase === "dealing" && (
          <button className="btn primary" onClick={onReady}>
            Ready
          </button>
        )}
        {["flop", "turn", "river"].includes(phase) &&
          getMeIndex() === turnIndex &&
          exchangeStep === 0 && (
            <button className="btn primary" onClick={onExchange}>
              Exchange
            </button>
          )}
        <button className="btn ghost" onClick={onSurrender}>
          Surrender
        </button>
      </div>

      {/* 결과 */}
      {result && (
        <div style={{ marginTop: 30 }}>
          <h2>
            {result.winner === -1
              ? "Tie"
              : players[result.winner]?.nickname + " Wins!"}
          </h2>
          <p>{result.summary}</p>
        </div>
      )}

      {/* 러시안룰렛 */}
      {renderRoulette()}
    </div>
  );
}

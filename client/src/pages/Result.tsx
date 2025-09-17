// client/src/pages/Result.tsx
import React, { useEffect, useState } from "react";

/** ---------- URL Params ---------- */
function useQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    win: params.get("win") === "1",
  };
}

export default function ResultPage() {
  const { win } = useQuery();
  const [count, setCount] = useState(3);

  useEffect(() => {
    const t = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(t);
          window.location.href = "/";
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: win
          ? "linear-gradient(135deg, #6e63d3 0%, #9f95ff 100%)"
          : "linear-gradient(135deg, #e74c3c 0%, #ff8a75 100%)",
        color: "#fff",
        fontFamily:
          "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 64, fontWeight: 900, marginBottom: 16 }}>
        {win ? "VICTORY!" : "DEFEAT"}
      </h1>
      <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 32 }}>
        Returning to Home in {count}s…
      </p>
      <button
        style={{
          background: "#fff",
          color: win ? "#6e63d3" : "#e74c3c",
          border: "none",
          borderRadius: 12,
          padding: "12px 24px",
          fontSize: 18,
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}
        onClick={() => (window.location.href = "/")}
      >
        Go Home Now
      </button>
    </div>
  );
}

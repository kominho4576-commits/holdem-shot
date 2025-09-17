import { io, Socket } from "socket.io-client";

const URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  "http://localhost:8080";

export const socket: Socket = io(URL, {
  transports: ["websocket"],
  autoConnect: true, // 홈에서 hello 보내며 확인
});

export type MatchStarted = {
  roomId: string;
  you: { id: string; nickname: string; isAI?: boolean };
  opponent: { id: string; nickname: string; isAI?: boolean };
  round: number;
};

// 헬스체크
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/health`, { cache: "no-store" });
    const j = await res.json();
    return !!j.ok;
  } catch {
    return false;
  }
}

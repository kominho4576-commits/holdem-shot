// client/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

/**
 * 서버 URL 우선순위
 * 1) VITE_SERVER_URL (Render Static Site의 Env에 설정)
 * 2) 현재 페이지 origin (동일 도메인 배치 시)
 */
const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${window.location.protocol}//${window.location.host}`;

/** socket.io 클라이언트 (웹소켓 강제) */
export const socket: Socket = io(SERVER_URL, {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: true,
});

/** 디버그/표시용으로 서버 URL을 외부에서 참조할 때 사용 */
export function getServerUrl() {
  return SERVER_URL;
}

/** (선택) 헬스체크 – 필요 없으면 사용하지 않아도 됨 */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

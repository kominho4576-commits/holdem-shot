// client/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

/**
 * 서버 URL 설정
 * - 개발 시: http://localhost:8080
 * - 배포 시: Render 등 서버 주소
 * - Vercel 클라에서 접근할 때는 .env에 넣어서 VITE_SERVER_URL로 불러오는 게 안전함
 */
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:8080";

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket"],
});

/** 서버 연결 상태 (초록/빨강불 표시용) */
let online = false;
const listeners: ((on: boolean) => void)[] = [];

socket.on("connect", () => {
  online = true;
  listeners.forEach((cb) => cb(true));
});

socket.on("disconnect", () => {
  online = false;
  listeners.forEach((cb) => cb(false));
});

/**
 * 현재 온라인 여부
 */
export function isOnline() {
  return online;
}

/**
 * 온라인 상태 변화 구독
 */
export function onOnlineChange(cb: (on: boolean) => void) {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * 서버 health 체크
 */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

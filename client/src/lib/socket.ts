// client/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

// 서버 URL: .env 없으면 같은 도메인 사용
export const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${window.location.protocol}//${window.location.host}`;

export const socket: Socket = io(SERVER_URL, {
  transports: ["websocket"],
  withCredentials: true,
  autoConnect: true,
});

// 간단한 온라인 상태 헬퍼
let online = false;
const listeners = new Set<(v: boolean) => void>();

function emit(v: boolean) {
  online = v;
  listeners.forEach((cb) => cb(v));
}

socket.on("connect", () => emit(true));
socket.on("disconnect", () => emit(false));
socket.on("connect_error", () => emit(false));

export function isOnline() {
  return online || socket.connected;
}

export function onOnlineChange(cb: (v: boolean) => void) {
  listeners.add(cb);
  cb(isOnline());
  return () => listeners.delete(cb);
}

// /health 핑
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

// 초기에 한번 핑해서 상태 세팅
(async () => {
  const ok = await pingServer();
  emit(ok && socket.connected ? true : ok);
})();

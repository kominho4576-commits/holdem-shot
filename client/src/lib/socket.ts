// client/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

// 같은 오리진(서버가 정적도 같이 서빙)일 때는 URL 생략
const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined;

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket"],
});

let online = false;
const listeners: ((on: boolean) => void)[] = [];

socket.on("connect", () => { online = true; listeners.forEach((cb)=>cb(true)); });
socket.on("disconnect", () => { online = false; listeners.forEach((cb)=>cb(false)); });

export function isOnline(){ return online; }
export function onOnlineChange(cb:(on:boolean)=>void){ listeners.push(cb); return ()=>{ const i=listeners.indexOf(cb); if(i>=0) listeners.splice(i,1);} }
export async function pingServer(): Promise<boolean> {
  try { const res = await fetch("/health"); const j = await res.json(); return !!j.ok; } catch { return false; }
}

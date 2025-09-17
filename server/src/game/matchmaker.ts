/**
 * matchmaker.ts
 * - QuickMatch/Room 기반의 매칭 관리
 */

import type { Room } from "./types.js";
import { customAlphabet } from "nanoid";

// 0,1,O,I 제외 → 헷갈리는 문자 제거
const nano6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

// ===== 인메모리 상태 =====
export const rooms = new Map<string, Room>();
export let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

// ===== 공용 유틸 =====
export function generateRoomCode(): string {
  return nano6();
}
export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}
export function isRoomFull(room: Room): boolean {
  return room.players.length >= 2;
}

// ===== Quick Match =====
export function enqueueQuick(socketId: string, nickname: string) {
  quickQueue.waiting = { socketId, nickname, enqueuedAt: Date.now() };
  return quickQueue.waiting;
}
export function cancelQuick(socketId: string) {
  if (quickQueue.waiting?.socketId === socketId) {
    quickQueue.waiting = null;
  }
}
export function tryMatch(socketId: string, nickname: string) {
  if (quickQueue.waiting && quickQueue.waiting.socketId !== socketId) {
    const other = quickQueue.waiting;
    quickQueue.waiting = null;
    const roomId = generateRoomCode();
    const room: Room = {
      id: roomId,
      createdAt: Date.now(),
      players: [
        { id: other.socketId, nickname: other.nickname },
        { id: socketId, nickname },
      ],
      stage: "matching",
      round: 1,
      timers: { aiFallback: null },
      meta: {
        mode: "quick",
        firstTurnPlayerId: Math.random() < 0.5 ? other.socketId : socketId,
      },
    };
    rooms.set(roomId, room);
    return room;
  }
  return null;
}

// ===== 코드 방 =====
export function createRoom(ownerId: string, nickname: string) {
  const roomId = generateRoomCode();
  const room: Room = {
    id: roomId,
    createdAt: Date.now(),
    players: [{ id: ownerId, nickname }],
    stage: "matching",
    round: 1,
    timers: { aiFallback: null },
    meta: { mode: "code" },
  };
  rooms.set(roomId, room);
  return room;
}
export function joinRoom(roomId: string, user: { id: string; nickname: string }) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  if (room.players.length >= 2) throw new Error("Room full");
  room.players.push(user);
  return room;
}
export function leaveRoom(roomId: string, userId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players = room.players.filter((p) => p.id !== userId);
  if (room.players.length === 0) {
    if (room.timers.aiFallback) clearTimeout(room.timers.aiFallback);
    rooms.delete(roomId);
  }
}
export function findRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return undefined;
}

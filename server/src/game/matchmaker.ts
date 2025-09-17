/**
 * matchmaker.ts
 * - QuickMatch/Room 기반의 매칭 관리
 * - index.ts에서 불러다 사용
 */

import type { Room, ServerUser } from "./types.js";
import { customAlphabet } from "nanoid";

const nano6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

// 인메모리 룸/큐 관리
export const rooms = new Map<string, Room>();
export let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

// 퀵매치 대기열에 추가
export function enqueueQuick(socketId: string, nickname: string) {
  quickQueue.waiting = { socketId, nickname, enqueuedAt: Date.now() };
  return quickQueue.waiting;
}

// 대기중인 상대 있으면 매칭
export function tryMatch(socketId: string, nickname: string) {
  if (quickQueue.waiting && quickQueue.waiting.socketId !== socketId) {
    const other = quickQueue.waiting;
    quickQueue.waiting = null;
    const roomId = nano6();

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
      meta: { mode: "quick" },
    };
    rooms.set(roomId, room);
    return room;
  }
  return null;
}

// 코드 방 생성
export function createRoom(ownerId: string, nickname: string) {
  const roomId = nano6();
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

// 코드 방 입장
export function joinRoom(roomId: string, user: ServerUser) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  if (room.players.length >= 2) throw new Error("Room full");

  room.players.push(user);
  return room;
}

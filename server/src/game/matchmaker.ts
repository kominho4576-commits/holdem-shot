/**
 * matchmaker.ts
 * - QuickMatch/Room 기반의 매칭 관리
 * - index.ts에서 필요 시 불러다 사용할 수 있는 순수 유틸
 */

import type { Room, ServerUser } from "./types.js";  // ✅ 같은 디렉터리
import { customAlphabet } from "nanoid";

// 0,1,O,I 제외한 6자리 코드
const nano6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

// ===== 인메모리 룸/큐 =====
export const rooms = new Map<string, Room>();

export let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

// ===== 공용 유틸 =====
export function generateRoomCode(): string {
  // 드물게 중복될 수 있으니 몇 번 재시도
  for (let i = 0; i < 5; i++) {
    const code = nano6();
    if (!rooms.has(code)) return code;
  }
  return nano6();
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function isRoomFull(room: Room): boolean {
  return room.players.length >= 2;
}

// ===== Quick Match =====

// 퀵매치 대기열에 추가
export function enqueueQuick(socketId: string, nickname: string) {
  quickQueue.waiting = { socketId, nickname, enqueuedAt: Date.now() };
  return quickQueue.waiting;
}

// 대기열 취소(연결 끊김 등)
export function cancelQuick(socketId: string) {
  if (quickQueue.waiting?.socketId === socketId) {
    quickQueue.waiting = null;
  }
}

// 대기중인 상대가 있으면 매칭해서 룸 생성
export function tryMatch(socketId: string, nickname: string) {
  if (quickQueue.waiting && quickQueue.waiting.socketId !== socketId) {
    const other = quickQueue.waiting;
    quickQueue.waiting = null;

    const roomId = generateRoomCode();
    const room: Room = {
      id: roomId,
      createdAt: Date.now(),
      players: [
        { id: other.socketId, nickname: other.nickname, isAI: false }, // ✅ isAI 추가
        { id: socketId,      nickname,               isAI: false },     // ✅ isAI 추가
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
    players: [{ id: ownerId, nickname, isAI: false }], // ✅ isAI 추가
    stage: "matching",
    round: 1,
    timers: { aiFallback: null },
    meta: { mode: "code" },
  };
  rooms.set(roomId, room);
  return room;
}

// 코드 방 입장 (기본은 사람이므로 isAI=false)
export function joinRoom(roomId: string, user: ServerUser, isAI = false) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  if (room.players.length >= 2) throw new Error("Room full");

  room.players.push({ id: user.id, nickname: user.nickname, isAI }); // ✅ isAI 반영
  return room;
}

// 방 떠나기(연결 끊김/나가기)
export function leaveRoom(roomId: string, userId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== userId);

  if (room.players.length === 0) {
    if (room.timers.aiFallback) clearTimeout(room.timers.aiFallback);
    rooms.delete(roomId);
  }
}

// 소켓이 포함된 방 찾기
export function findRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return undefined;
}

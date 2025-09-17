/**
 * matchmaker.ts
 * - QuickMatch/Room 기반의 매칭 관리
 * - index.ts에서 불러다 사용
 */

import type { Room, ServerUser } from "./types.js";
import { customAlphabet } from "nanoid";

// 0,1,O,I 를 제외한 대문자+숫자 (6자리)
const nano6 = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

// ===== 인메모리 룸/큐 =====
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

// 퀵매치 대기열에 추가
export function enqueueQuick(socketId: string, nickname: string) {
  quickQueue.waiting = { socketId, nickname, enqueuedAt: Date.now() };
  return quickQueue.waiting;
}

// 대기열 취소 (연결 끊김 등)
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
        { id: other.socketId, nickname: other.nickname },
        { id: socketId, nickname },
      ],
      stage: "matching",
      round: 1,
      // setTimeout 핸들 타입 안전하게
      timers: { aiFallback: null as ReturnType<typeof setTimeout> | null },
      meta: {
        mode: "quick",
        // 선공 랜덤 선택이 필요하면 여기서 기록(서버/클라이언트 어디서 쓰든 일관되게)
        firstTurnPlayerId: Math.random() < 0.5 ? other.socketId : socketId,
      },
    };

    rooms.set(roomId, room);
    return room;
  }
  return null;
}

// ===== 코드 방 =====

// 코드 방 생성
export function createRoom(ownerId: string, nickname: string) {
  const roomId = generateRoomCode();
  const room: Room = {
    id: roomId,
    createdAt: Date.now(),
    players: [{ id: ownerId, nickname }],
    stage: "matching",
    round: 1,
    timers: { aiFallback: null as ReturnType<typeof setTimeout> | null },
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

// 방 떠나기 (연결 끊김/나가기)
export function leaveRoom(roomId: string, userId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== userId);

  // 타이머 정리
  if (room.players.length === 0) {
    if (room.timers.aiFallback) {
      clearTimeout(room.timers.aiFallback);
    }
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

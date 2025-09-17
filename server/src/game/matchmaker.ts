/**
 * matchmaker.ts
 * - QuickMatch/Room 기반의 매칭 관리
 * - index.ts에서 불러다 사용
 */

import type { Room, ServerUser } from "./types.js";
import { customAlphabet } from "nanoid";

// ===== 방 코드 설정 =====
// 0, 1, O, I 제외 (시각적 혼동 방지)
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 6;

const nano6 = customAlphabet(CODE_ALPHABET, CODE_LEN);

// ===== 인메모리 룸/큐 =====
export const rooms = new Map<string, Room>();

/** QuickMatch 대기열 - 1명만 보관 */
export let quickQueue: {
  waiting: { socketId: string; nickname: string; enqueuedAt: number } | null;
} = { waiting: null };

// 대기열 만료(고아 상태) 정리 위한 타임아웃(ms)
const QUEUE_TTL = 15_000;

// ===== 공용 유틸 =====
export function generateRoomCode(): string {
  // 충돌 방지: 드물지만 혹시 같은 코드가 존재하면 재시도
  for (let i = 0; i < 5; i++) {
    const code = nano6();
    if (!rooms.has(code)) return code;
  }
  // 매우 드문 경우 fallback
  return `${nano6()}`;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function isRoomFull(room: Room): boolean {
  return room.players.length >= 2;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input);
  return code.length === CODE_LEN && [...code].every(ch => CODE_ALPHABET.includes(ch));
}

// 내부에서 쓰는 가드
function assertRoomExists(roomId: string): Room {
  const r = rooms.get(roomId);
  if (!r) throw new Error("Room not found");
  return r;
}

function now() {
  return Date.now();
}

// 오래된 대기열 정리
function sweepQueue() {
  const w = quickQueue.waiting;
  if (w && now() - w.enqueuedAt > QUEUE_TTL) {
    quickQueue.waiting = null;
  }
}

// ===== Quick Match =====

/** 퀵매치 대기열에 추가 (기존 항목이 자신이면 갱신만) */
export function enqueueQuick(socketId: string, nickname: string) {
  sweepQueue();
  // 자기 자신이 이미 대기 중이면 타임스탬프 갱신
  if (quickQueue.waiting?.socketId === socketId) {
    quickQueue.waiting.enqueuedAt = now();
    quickQueue.waiting.nickname = nickname;
    return quickQueue.waiting;
  }
  quickQueue.waiting = { socketId, nickname, enqueuedAt: now() };
  return quickQueue.waiting;
}

/** 대기열 취소(연결 끊김 등) */
export function cancelQuick(socketId: string) {
  if (quickQueue.waiting?.socketId === socketId) {
    quickQueue.waiting = null;
  }
}

/** 대기 중 상대가 있으면 매칭해서 룸 생성 */
export function tryMatch(socketId: string, nickname: string) {
  sweepQueue();

  const other = quickQueue.waiting;
  if (!other) return null;
  if (other.socketId === socketId) return null; // 자기 자신과 매칭 금지

  // 매칭 성사 → 대기열 비우고 방 생성
  quickQueue.waiting = null;

  const roomId = generateRoomCode();

  const room: Room = {
    id: roomId,
    createdAt: now(),
    players: [
      { id: other.socketId, nickname: other.nickname },
      { id: socketId, nickname },
    ],
    stage: "matching",
    round: 1,
    timers: { aiFallback: null as ReturnType<typeof setTimeout> | null },
    meta: {
      mode: "quick",
      // 선공 랜덤 배정(필요 시 클라/서버 로직에서 사용)
      firstTurnPlayerId: Math.random() < 0.5 ? other.socketId : socketId,
    },
  };

  rooms.set(roomId, room);
  return room;
}

// ===== 코드 방 =====

/** 코드 방 생성 */
export function createRoom(ownerId: string, nickname: string) {
  const roomId = generateRoomCode();
  const room: Room = {
    id: roomId,
    createdAt: now(),
    players: [{ id: ownerId, nickname }],
    stage: "matching",
    round: 1,
    timers: { aiFallback: null as ReturnType<typeof setTimeout> | null },
    meta: { mode: "code" }, // code 모드에는 선공 미지정(입장 완료 후 추첨)
  };
  rooms.set(roomId, room);
  return room;
}

/** 코드 방 입장 */
export function joinRoom(roomIdRaw: string, user: ServerUser) {
  const roomId = normalizeRoomCode(roomIdRaw);
  if (!isValidRoomCode(roomId)) throw new Error("Invalid room code");

  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  if (room.players.length >= 2) throw new Error("Room full");
  if (room.players.some(p => p.id === user.id)) return room; // 이미 포함되어 있으면 그대로 반환

  room.players.push(user);
  return room;
}

/** 방 떠나기(연결 끊김/나가기) */
export function leaveRoom(roomIdRaw: string, userId: string) {
  const roomId = normalizeRoomCode(roomIdRaw);
  const room = rooms.get(roomId);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== userId);

  // 남아있는 인원이 없으면 타이머 정리 후 방 제거
  if (room.players.length === 0) {
    if (room.timers.aiFallback) clearTimeout(room.timers.aiFallback);
    rooms.delete(roomId);
  }
}

/** 소켓이 포함된 방 찾기 */
export function findRoomBySocket(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return undefined;
}

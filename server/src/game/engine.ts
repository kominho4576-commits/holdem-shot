/**
 * engine.ts
 * - 라운드/페이즈 상태머신
 * - 카드 분배 · 교환(Ready) · 승패 판정 · 러시안룰렛 트리거
 * - 조커: 승패 후 효과만(패자 면제 / 상대 총알 +1). 포커 족보 계산에는 사용하지 않음.
 *
 * Socket 이벤트(서버→클라):
 *  - game:state            { roomId, round, phase, board, you, opponent, turn, readyCount }
 *  - game:swap:blink       { seat: 'P1'|'P2', indexes: number[] }  // 상대가 바꾼 카드 깜빡
 *  - game:phase            { phase, round }
 *  - game:result           { round, winnerSeat: 'P1'|'P2'|'TIE', reasons }
 *  - game:roulette         { loserSeat: 'P1'|'P2', bullets, round } // 러시안룰렛 화면으로 전환
 *
 * Socket 이벤트(클라→서버):
 *  - game:ready            { roomId, keepIndexes?: number[] } // 내 두 장 중 유지할 index (0~1). 나머지는 교환
 *  - game:surrender        { roomId }
 *
 * 페이즈:
 *  - 'Dealing' -> 'Flop' -> 'Turn' -> 'River' -> 'Showdown'
 */

import type { Room, ServerUser } from './types.js';
import { Server } from 'socket.io';
import { evaluate7, winnerSeat, type EvalResult } from './rules.js';

export type Phase = 'Dealing' | 'Flop' | 'Turn' | 'River' | 'Showdown';

type Seat = 'P1'|'P2';
type Card = { r: number; s: number; isJoker?: boolean }; // r:2~14(A=14), s:0~3

type Runtime = {
  deck: Card[];
  board: Card[];            // 5장
  hands: Record<Seat, Card[]>; // 각 2장
  ready: Set<Seat>;         // 이 페이즈에서 Ready한 좌석
  turn: Seat;               // 누가 교환 선택 중인지(표시용)
  phase: Phase;
  // 조커 소지 여부(해당 라운드)
  jokers: Record<Seat, number>; // 손패 2장 중 조커 개수
};

const rtMap = new Map<string, Runtime>(); // room.id -> runtime

// ---------- 카드 유틸 ----------
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  // Joker 2장
  deck.push({ r: 15, s: -1, isJoker: true });
  deck.push({ r: 15, s: -1, isJoker: true });
  return shuffle(deck);
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw(deck: Card[], n: number): Card[] {
  return deck.splice(0, n);
}

// 공개용(상대 개인카드는 뒷면 처리)
function maskCard(_c: Card): { back: true } { return { back: true } as any; }
function openCard(c: Card) {
  return { r: c.r, s: c.s, isJoker: !!c.isJoker };
}

// ---------- 런타임 초기화 ----------
function initRound(room: Room): Runtime {
  const deck = buildDeck();
  const runtime: Runtime = {
    deck,
    board: new Array<Card>(5),
    hands: { P1: [], P2: [] },
    ready: new Set<Seat>(),
    turn: 'P1',
    phase: 'Dealing',
    jokers: { P1: 0, P2: 0 },
  };

  // 개인 카드 2장씩
  runtime.hands.P1 = draw(deck, 2);
  runtime.hands.P2 = draw(deck, 2);
  runtime.jokers.P1 = runtime.hands.P1.filter(c => c.isJoker).length;
  runtime.jokers.P2 = runtime.hands.P2.filter(c => c.isJoker).length;

  // 보드(5장 뒷면)
  runtime.board = draw(deck, 5);

  return runtime;
}

// ---------- 브로드캐스트 ----------
function emitState(io: Server, room: Room) {
  const rt = rtMap.get(room.id)!;
  const [p1, p2] = room.players;
  const seatOf = (id: string): Seat => (id === p1.id ? 'P1' : 'P2');

  // 각 소켓에 개인화된 state 전송
  room.players.forEach((u) => {
    if (u.isAI) return;
    const me = seatOf(u.id);
    const opp: Seat = me === 'P1' ? 'P2' : 'P1';

    const payload = {
      roomId: room.id,
      round: room.round,
      phase: rt.phase,
      board: rt.board.map(openCard),                // 공개 카드(항상 뒷면 이미지지만 값은 보냄)
      you: rt.hands[me].map(openCard),              // 내 카드 앞면
      opponent: rt.hands[opp].map(maskCard),        // 상대 카드 뒷면
      turn: rt.turn,
      readyCount: rt.ready.size,
    };
    io.to(u.id).emit('game:state', payload);
  });
}

function emitPhase(io: Server, room: Room) {
  const rt = rtMap.get(room.id)!;
  io.to(room.id).emit('game:phase', { phase: rt.phase, round: room.round });
}

// ---------- 페이즈 전환 ----------
function advancePhase(io: Server, room: Room) {
  const rt = rtMap.get(room.id)!;
  rt.ready.clear();

  switch (rt.phase) {
    case 'Dealing':
      rt.phase = 'Flop';
      rt.turn = 'P1';
      break;
    case 'Flop':
      rt.phase = 'Turn';
      rt.turn = 'P2'; // 설명: 플랍 이후엔 이전 라운드의 마지막 다음 차례… 간단화해서 P2로
      break;
    case 'Turn':
      rt.phase = 'River';
      rt.turn = 'P1';
      break;
    case 'River':
      rt.phase = 'Showdown';
      break;
    case 'Showdown':
      // 다음 라운드로 넘어갈 준비는 resolveRound에서 처리
      break;
  }

  emitPhase(io, room);
  emitState(io, room);
}

// ---------- 교환 처리 ----------
function applySwap(rt: Runtime, seat: Seat, keepIndexes?: number[]) {
  // keepIndexes: 0~1 중 유지할 인덱스. 미지정이면 아무 것도 유지하지 않고 두 장 교체 X (규칙상 0~2장 교환 가능)
  const keep = new Set<number>(keepIndexes ?? []);
  const newHand: Card[] = [];

  for (let i = 0; i < 2; i++) {
    if (keep.has(i)) newHand.push(rt.hands[seat][i]);
    else newHand.push(draw(rt.deck, 1)[0]);
  }

  // 어떤 카드가 바뀌었는지(상대 깜빡임 표시)
  const changed: number[] = [];
  for (let i = 0; i < 2; i++) {
    if (newHand[i] !== rt.hands[seat][i]) changed.push(i);
  }

  rt.hands[seat] = newHand;
  rt.jokers[seat] = newHand.filter(c => c.isJoker).length;
  return changed;
}

// ---------- 쇼다운 ----------
function resolveRound(io: Server, room: Room) {
  const rt = rtMap.get(room.id)!;
  const evalP1: EvalResult = evaluate7(rt.hands.P1, rt.board);
  const evalP2: EvalResult = evaluate7(rt.hands.P2, rt.board);

  const wSeat = winnerSeat(evalP1, evalP2); // 'P1' | 'P2' | 'TIE'

  io.to(room.id).emit('game:result', {
    round: room.round,
    winnerSeat: wSeat,
    reasons: { p1: evalP1.rankName, p2: evalP2.rankName },
  });

  // 러시안룰렛 트리거(패자만)
  if (wSeat !== 'TIE') {
    const loser: Seat = wSeat === 'P1' ? 'P2' : 'P1';
    const bulletsBase = Math.min(6, room.round); // 라운드마다 1씩 증가(최대 6)
    let bullets = bulletsBase;

    // 조커 효과
    if (rt.jokers[loser] > 0) {
      // 패자 조커 → 면제
      io.to(room.id).emit('game:roulette', { loserSeat: loser, bullets: 0, round: room.round });
    } else {
      if (rt.jokers[wSeat] > 0) bullets += 1; // 승자 조커 → 상대 총알 +1
      io.to(room.id).emit('game:roulette', { loserSeat: loser, bullets, round: room.round });
    }
  }

  // 다음 라운드 준비 (클라에서 결과/룰렛 처리 후 'game:next' 이벤트를 보낼 수 있게 설계 가능)
  // 여기서는 서버가 곧바로 라운드 리셋해도 되고, 클라 합의형으로 따로 받게 해도 됨.
  // 요구사항: "매 판이 끝날 때 그 판의 정보는 지워야 됨" → 라운드 증가와 함께 초기화.
  room.round += 1;
  const nextRt = initRound(room);
  rtMap.set(room.id, nextRt);

  // 다음 라운드 시작 페이즈/상태 전달(클라에서는 5s 후 홈 이동 등 자체 처리)
  setTimeout(() => {
    emitPhase(io, room);
    emitState(io, room);
  }, 100); // 약간의 텀
}

// ---------- 외부 노출 ----------
export function startRound(io: Server, room: Room) {
  const rt = initRound(room);
  rtMap.set(room.id, rt);

  // 페이즈: Dealing에서 시작
  emitPhase(io, room);
  emitState(io, room);

  // Flop으로 전환 (UI상 "Phase: Dealing"을 잠깐 보여주고 바로 전개)
  setTimeout(() => {
    advancePhase(io, room); // -> Flop
  }, 300);
}

export function wireGameHandlers(io: Server, room: Room) {
  const [p1, p2] = room.players.filter(p => !p.isAI);

  const seatOf = (sid: string): Seat => (sid === p1?.id ? 'P1' : 'P2');

  // Ready(교환) 처리
  [p1, p2].forEach(u => {
    if (!u) return;
    io.to(u.id).socketsJoin(room.id); // 안전망
    const s = io.sockets.sockets.get(u.id);
    if (!s) return;

    s.on('game:ready', (payload: { roomId: string; keepIndexes?: number[] }) => {
      if (payload?.roomId !== room.id) return;
      const rt = rtMap.get(room.id);
      if (!rt) return;
      const seat = seatOf(s.id);

      // 교환 실행
      const changed = applySwap(rt, seat, payload.keepIndexes);

      // 상대 깜빡임
      const otherSeat: Seat = seat === 'P1' ? 'P2' : 'P1';
      const other = otherSeat === 'P1' ? p1 : p2;
      if (other) io.to(other.id).emit('game:swap:blink', { seat, indexes: changed });

      rt.ready.add(seat);

      // 두 명 모두 Ready → 다음 페이즈
      if (rt.ready.size >= 2) {
        // 보드 공개 처리(플랍/턴/리버 시점에서 이미 보드는 정해져 있음)
        advancePhase(io, room);
        if (rt.phase === 'Showdown') {
          resolveRound(io, room);
        }
      } else {
        emitState(io, room);
      }
    });

    s.on('game:surrender', (payload: { roomId: string }) => {
      if (payload?.roomId !== room.id) return;
      const seat = seatOf(s.id);
      const loser: Seat = seat;
      const winner: Seat = loser === 'P1' ? 'P2' : 'P1';
      io.to(room.id).emit('game:result', {
        round: room.round,
        winnerSeat: winner,
        reasons: { surrender: true },
      });

      // 항복은 즉시 게임 종료로 본다(요구: 패배 처리)
      room.stage = 'ended';
      rtMap.delete(room.id);
    });
  });
}

export function onPlayerDisconnect(roomId: string, socketId: string) {
  // 필요 시 중도 이탈 처리 등 확장 가능
  // 간단히 런타임만 정리
  const rt = rtMap.get(roomId);
  if (!rt) return;
  // 두 명 중 한 명이 나가면 다음 라운드 초기화 등은 상위에서 방 제거 로직으로 처리
}

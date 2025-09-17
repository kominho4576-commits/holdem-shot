/**
 * 공용 게임 타입
 */

export type Stage =
  | "matching"
  | "dealing"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "roulette"
  | "result";

/** 서버에서 관리하는 유저(소켓 기준) */
export interface ServerUser {
  id: string;          // socket id
  nickname: string;
  isAI?: boolean;
}

/** 룸의 부가정보 */
export interface RoomMeta {
  /** 매칭 방식 */
  mode: "quick" | "code";
  /**
   * 이번 라운드 선공 플레이어(소켓 id).
   * 라운드 시작 시 랜덤 배정. 없으면 클라이언트/서버 로직에서 추첨 가능.
   */
  firstTurnPlayerId?: string;
}

/** 룸에 쓰는 타이머 핸들 모음 */
export interface Timers {
  aiFallback: ReturnType<typeof setTimeout> | null;
}

/** 룸 상태(필요 속성만 엄격 지정, 나머지는 확장 가능) */
export interface Room {
  id: string;
  createdAt: number;
  players: ServerUser[];
  stage: Stage | string;
  round: number;
  timers: Timers;
  meta: RoomMeta;
}

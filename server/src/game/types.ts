// server/src/game/types.ts

// 간단 사용자 정보 (소켓 기준)
export type ServerUser = {
  id: string;        // socket.id
  nickname: string;  // 닉네임
};

// 매치메이커/대기열에서 쓰는 방의 플레이어
export type RoomPlayer = {
  id: string;        // socket.id
  nickname: string;  // 표시용 닉네임
  isAI: boolean;     // ✅ 반드시 포함 (빌드 에러 원인)
};

// 매치메이커가 관리하는 방 정보 (게임 엔진과 별개)
export type Room = {
  id: string; // 6자리 코드
  createdAt: number;
  players: RoomPlayer[];
  stage: "matching" | "playing" | "ended";
  round: number;
  timers: {
    aiFallback: ReturnType<typeof setTimeout> | null;
  };
  meta: {
    mode: "quick" | "code";
    firstTurnPlayerId?: string; // 선턴 고정이 필요할 때 사용
  };
};

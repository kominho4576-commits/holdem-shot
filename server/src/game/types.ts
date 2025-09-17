// server/src/types.ts

// 한 장의 카드
export type Card = {
  rank: string; // "2" ~ "A", 또는 "JOKER"
  suit: string; // "S","H","D","C", 또는 "X"(조커)
};

// 서버에 등록된 사용자
export type ServerUser = {
  id: string;        // socket.id
  nickname: string;  // 플레이어 닉네임
};

// 서버 내부에서 관리하는 플레이어
export type RoomPlayer = {
  id: string;        // socket.id
  nickname: string;  // 표시용 닉네임
};

// 룸 정보
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
    firstTurnPlayerId?: string;
  };
};

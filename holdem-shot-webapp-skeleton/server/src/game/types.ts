export type ServerUser = {
  id: string;             // socket.id 또는 'AI:<roomId>'
  nickname: string;       // 입력 없으면 PLAYER1/2, AI는 랜덤
  isAI?: boolean;
  readyAt?: number | null;
};

export type Room = {
  id: string;             // 6자리 코드(퀵매치는 내부적으로도 사용)
  createdAt: number;
  players: ServerUser[];  // 최대 2명
  stage: "matching" | "playing" | "ended";
  round: number;          // 1부터 시작
  timers: {
    aiFallback?: NodeJS.Timeout | null; // 퀵매치 8s 타임아웃
  };
  meta: {
    mode: "quick" | "code"; // 퀵매치 / 코드방
  };
};

// 클라이언트로 보내는 최소 매칭 페이로드
export type MatchPayload = {
  roomId: string;
  you: ServerUser;
  opponent: ServerUser;
  round: number;
};

export type ServerUser = {
  id: string;
  nickname: string;
  isAI?: boolean;
  readyAt?: number | null;
};

export type Room = {
  id: string;
  createdAt: number;
  players: ServerUser[];
  stage: "matching" | "playing" | "ended";
  round: number;
  timers: { aiFallback?: NodeJS.Timeout | null };
  meta: { mode: "quick" | "code" };
};

export type MatchPayload = {
  roomId: string;
  you: ServerUser;
  opponent: ServerUser;
  round: number;
};

export type Phase = 'DEAL'|'FLOP'|'EX1'|'TURN'|'EX2'|'RIVER'|'EX3'|'COMPARE'|'ROULETTE'|'RESULT'

export type PlayerView = {
  id: string
  nickname: string
  hearts: number
  private: string[]
  hasJoker: boolean
  ready: boolean
}

export type GameStatePayload = {
  roomId: string
  phase: Phase
  round: number
  board: string[]
  players: Record<string, PlayerView>
  isAI: boolean
}

export type ComparePayload = {
  tie: boolean
  winnerId?: string
  loserId?: string
  detail?: { a?: string; b?: string }
}

export type RoulettePayload = {
  round: number
  chambers: number[]   // 6 length; 1 = bullet, 0 = empty
  top: number          // index 0..5 that lands at arrow
  rotatedSteps: number
  skipped: boolean
  text: 'SAFE'|'BANG!'
  hit: boolean
}

export type ResultPayload = {
  winnerId: string
  loserId: string
  reason: string
  message: string
}

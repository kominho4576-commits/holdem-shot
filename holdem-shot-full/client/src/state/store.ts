import { create } from 'zustand'
import { GameStatePayload, ComparePayload, RoulettePayload, ResultPayload, Phase } from './gameTypes'

type Route = 'home'|'match'|'game'|'result'

type Store = {
  route: Route
  setRoute: (r: Route) => void

  serverOnline: boolean
  setServerOnline: (v: boolean) => void

  codeGenerated?: string
  setCodeGenerated: (c?: string) => void

  myId: string
  setMyId: (id: string) => void

  nickname: string
  setNickname: (n: string) => void

  roomId?: string
  game?: GameStatePayload
  lastCompare?: ComparePayload
  lastRoulette?: RoulettePayload
  lastResult?: ResultPayload

  setGame: (g?: GameStatePayload) => void
  setCompare: (c?: ComparePayload) => void
  setRoulette: (r?: RoulettePayload) => void
  setResult: (r?: ResultPayload) => void

  resetRoundVisuals: () => void
}

export const useStore = create<Store>((set) => ({
  route: 'home',
  setRoute: (r) => set({ route: r }),

  serverOnline: false,
  setServerOnline: (v) => set({ serverOnline: v }),

  codeGenerated: undefined,
  setCodeGenerated: (c) => set({ codeGenerated: c }),

  myId: '',
  setMyId: (id) => set({ myId: id }),

  nickname: '',
  setNickname: (n) => set({ nickname: n }),

  roomId: undefined,
  game: undefined,
  lastCompare: undefined,
  lastRoulette: undefined,
  lastResult: undefined,

  setGame: (g) => set({ game: g, roomId: g?.roomId }),
  setCompare: (c) => set({ lastCompare: c }),
  setRoulette: (r) => set({ lastRoulette: r }),
  setResult: (r) => set({ lastResult: r }),

  resetRoundVisuals: () => set({ lastCompare: undefined, lastRoulette: undefined })
}))

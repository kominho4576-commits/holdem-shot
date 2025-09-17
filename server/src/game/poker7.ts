// server/src/game/poker7.ts
export type Suit = "S" | "H" | "D" | "C" | "X"; // X = Joker
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A" | "JOKER";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface HandEval {
  /** 0~8 (High,Pair,TwoPair,Trips,Straight,Flush,FullHouse,Quads,StraightFlush) */
  category: number;
  /** tie-break vector (내림차순 값) */
  tiebreak: number[];
  /** 사람이 읽을 수 있는 요약 */
  name: string;
  /** 선택된 5장 (조커 제외) */
  best5: Card[];
}

/** 내부: 랭크 숫자값 (A=14). JOKER는 0 처리해서 무시 */
const RVAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  J: 11, Q: 12, K: 13, A: 14, JOKER: 0,
};

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** 카드 정규화(대문자 처리 등) */
function norm(c: Card): Card {
  return { rank: c.rank, suit: c.suit };
}

function byDesc(a: number, b: number) { return b - a; }

/** 5장 족보 평가 */
function evaluate5(cards: Card[]): HandEval {
  const hand = cards.map(norm);
  const vals = hand.map(c => RVAL[c.rank]).sort(byDesc);

  // 랭크 카운트
  const count: Record<number, number> = {};
  for (const v of vals) count[v] = (count[v] || 0) + 1;

  // 수트 카운트
  const suitCount: Record<Suit, number> = { S:0, H:0, D:0, C:0, X:0 };
  for (const c of hand) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;

  // Flush?
  const flushSuit = (["S","H","D","C"] as Suit[]).find(s => suitCount[s] === 5);

  // Straight? (A-5 wheel 처리)
  const uniq = [...new Set(vals)].filter(v => v > 0).sort(byDesc);
  let straightHigh = 0;
  if (uniq.length >= 5 && uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
  // wheel (A,5,4,3,2)
  if (!straightHigh && uniq.includes(14)) {
    const wheel = [5,4,3,2,14];
    if (wheel.every(v => uniq.includes(v))) straightHigh = 5;
  }

  // Straight Flush?
  let isSF = false;
  if (flushSuit && straightHigh) {
    const flushVals = hand
      .filter(c => c.suit === flushSuit)
      .map(c => RVAL[c.rank])
      .sort(byDesc);
    const u2 = [...new Set(flushVals)];
    if (u2.length >= 5 && u2[0] - u2[4] === 4) isSF = true;
    if (!isSF && u2.includes(14)) {
      const wheel = [5,4,3,2,14];
      if (wheel.every(v => u2.includes(v))) isSF = true;
    }
  }

  // rank pattern
  const groups = Object.entries(count)
    .map(([v, n]) => ({ v: +v, n }))
    .sort((a, b) => b.n - a.n || b.v - a.v); // 우선 카운트, 다음 값

  let category = 0;
  let tiebreak: number[] = [];

  if (isSF) {
    category = 8;
    tiebreak = [straightHigh];
  } else if (groups[0].n === 4) {
    // Quads
    category = 7;
    const quad = groups[0].v;
    const kicker = groups.find(g => g.v !== quad)!.v;
    tiebreak = [quad, kicker];
  } else if (groups[0].n === 3 && groups[1]?.n === 2) {
    // Full House
    category = 6;
    tiebreak = [groups[0].v, groups[1].v];
  } else if (flushSuit) {
    category = 5;
    tiebreak = vals;
  } else if (straightHigh) {
    category = 4;
    tiebreak = [straightHigh];
  } else if (groups[0].n === 3) {
    category = 3;
    const kickers = groups.filter(g => g.n === 1).map(g => g.v).sort(byDesc).slice(0,2);
    tiebreak = [groups[0].v, ...kickers];
  } else if (groups[0].n === 2 && groups[1]?.n === 2) {
    category = 2;
    const highPair = Math.max(groups[0].v, groups[1].v);
    const lowPair  = Math.min(groups[0].v, groups[1].v);
    const kicker = groups.find(g => g.n === 1)!.v;
    tiebreak = [highPair, lowPair, kicker];
  } else if (groups[0].n === 2) {
    category = 1;
    const kickers = groups.filter(g => g.n === 1).map(g => g.v).sort(byDesc).slice(0,3);
    tiebreak = [groups[0].v, ...kickers];
  } else {
    category = 0;
    tiebreak = vals;
  }

  const name = humanName(category, tiebreak);
  return { category, tiebreak, name, best5: clone(cards) };
}

function humanName(cat: number, tb: number[]): string {
  const rmap: Record<number,string> = {
    8: "Straight Flush",
    7: "Four of a Kind",
    6: "Full House",
    5: "Flush",
    4: "Straight",
    3: "Three of a Kind",
    2: "Two Pair",
    1: "One Pair",
    0: "High Card",
  };
  const rankLabel = (v:number) =>
    ({11:"J",12:"Q",13:"K",14:"A"} as any)[v] ?? String(v);
  let tail = "";
  if (cat === 8 || cat === 4) tail = `, High ${rankLabel(tb[0])}`;
  if (cat === 7) tail = `, ${rankLabel(tb[0])}s`;
  if (cat === 6) tail = `, ${rankLabel(tb[0])}s over ${rankLabel(tb[1])}s`;
  if (cat === 5 || cat === 0) tail = `, ${tb.map(rankLabel).join("-")}`;
  if (cat === 3) tail = `, ${rankLabel(tb[0])}s`;
  if (cat === 2) tail = `, ${rankLabel(tb[0])}s & ${rankLabel(tb[1])}s`;
  if (cat === 1) tail = `, ${rankLabel(tb[0])}s`;
  return `${rmap[cat]}${tail}`;
}

/**
 * 7장 중 최적 5장 평가 (조커는 제외)
 * @param seven 7장(개인2+커뮤니티5) – 조커(rank:'JOKER' 또는 suit:'X')는 자동 제외
 */
export function evaluate7(seven: Card[]): HandEval {
  const pool = seven.filter(c => c.rank !== "JOKER" && c.suit !== "X");
  if (pool.length < 5) {
    // 조커만 많아서 5장 미만인 극단 상황 → 가능한 카드로 High Card 취급
    return evaluate5(pool);
  }

  // 조합 21개 모두 평가
  let best: HandEval | null = null;
  const n = pool.length;
  for (let a=0;a<n-4;a++) for (let b=a+1;b<n-3;b++)
  for (let c=a+2;c<n-2;c++) for (let d=a+3;d<n-1;d++)
  for (let e=a+4;e<n;e++) {
    const five = [pool[a], pool[b], pool[c], pool[d], pool[e]];
    const ev = evaluate5(five);
    if (!best) { best = ev; continue; }
    if (compare(ev, best) > 0) best = ev;
  }
  return best!;
}

export function compare(a: HandEval, b: HandEval): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i=0;i<len;i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0; // 완전 동일
}

/** 사람이 읽을 비교 설명 */
export function describeBestHand(my: HandEval, opp: HandEval): string {
  if (compare(my, opp) > 0) return `You win: ${my.name} vs ${opp.name}`;
  if (compare(my, opp) < 0) return `You lose: ${my.name} vs ${opp.name}`;
  return `Tie: ${my.name} = ${opp.name}`;
}

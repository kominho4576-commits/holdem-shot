/**
 * rules.ts
 * - 7장(개인 2 + 보드 5)에서 최적 5장 족보 평가
 * - Joker(두 장)는 포커 평가에서 제외. (본 게임에서 조커는 승/패 후 효과 전용)
 */

type Seat = 'P1'|'P2';

export type Card = { r: number; s: number; isJoker?: boolean };
export type EvalResult = {
  score: number;      // 숫자가 클수록 강함
  rankName: string;   // "Two Pair" 등
  breakdown: number[];// 타이브레이커용
};

// 카테고리 우선 순위
const CAT = {
  HIGH: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  TRIPS: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL: 7,
  QUADS: 8,
  STRAIGHT_FLUSH: 9,
};

function byRankDesc(a: number, b: number){ return b - a; }

function ranks(cards: Card[]): number[] {
  return cards.filter(c => !c.isJoker).map(c => c.r).sort(byRankDesc);
}

function isStraight(rs: number[]): number | null {
  // A(14)~5(5)까지 체크, A-5 휠(5-high) 포함
  const uniq = Array.from(new Set(rs)).sort((a,b)=>b-a);
  if (uniq.includes(14)) uniq.push(1); // A as 1
  let streak = 1;
  for (let i=0;i<uniq.length-1;i++){
    if (uniq[i]-1 === uniq[i+1]) {
      streak++;
      if (streak>=5) return Math.max(uniq[i+1]+4,5); // 최고 랭크 반환(휠=5)
    } else streak=1;
  }
  return null;
}

function flushSuit(cards: Card[]): number | null {
  const cnt = new Map<number, number>();
  for (const c of cards) if (!c.isJoker) cnt.set(c.s, (cnt.get(c.s)||0)+1);
  for (const [s, n] of cnt) if (n>=5) return s;
  return null;
}

function score5(cards: Card[]): EvalResult {
  // cards(5) 는 조커가 없는 상태로 들어온다고 가정
  const rs = cards.map(c=>c.r).sort(byRankDesc);
  const s = cards[0].s; // only for flush check — but we receive 5 chosen cards already of same suit when needed

  // counts
  const cnt = new Map<number, number>();
  rs.forEach(r => cnt.set(r, (cnt.get(r)||0)+1));
  const groups = Array.from(cnt.entries()).sort((a,b)=> (b[1]-a[1]) || (b[0]-a[0]));

  const straightHigh = isStraight(rs);

  const sameSuit = cards.every(c=>c.s===cards[0].s);
  if (sameSuit && straightHigh) {
    return { score: CAT.STRAIGHT_FLUSH*1e6 + straightHigh*1e3, rankName: 'Straight Flush', breakdown: [straightHigh] };
  }
  if (groups[0][1]===4) {
    const four = groups[0][0]; const kicker = groups.find(g=>g[0]!==four)![0];
    return { score: CAT.QUADS*1e6 + four*1e3 + kicker, rankName: 'Four of a Kind', breakdown: [four, kicker] };
  }
  if (groups[0][1]===3 && groups[1][1]===2) {
    return { score: CAT.FULL*1e6 + groups[0][0]*1e3 + groups[1][0], rankName: 'Full House', breakdown: [groups[0][0], groups[1][0]] };
  }
  if (sameSuit) {
    return { score: CAT.FLUSH*1e6 + rs[0]*1e4 + rs[1]*1e3 + rs[2]*1e2 + rs[3]*10 + rs[4], rankName: 'Flush', breakdown: rs };
  }
  if (straightHigh) {
    return { score: CAT.STRAIGHT*1e6 + straightHigh*1e3, rankName: 'Straight', breakdown: [straightHigh] };
  }
  if (groups[0][1]===3) {
    const trips = groups[0][0];
    const kickers = groups.filter(g=>g[0]!==trips).map(g=>g[0]).sort(byRankDesc).slice(0,2);
    return { score: CAT.TRIPS*1e6 + trips*1e4 + kickers[0]*1e2 + kickers[1], rankName: 'Three of a Kind', breakdown: [trips, ...kickers] };
  }
  if (groups[0][1]===2 && groups[1][1]===2) {
    const hi = Math.max(groups[0][0], groups[1][0]);
    const lo = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups.find(g=>g[1]===1)![0];
    return { score: CAT.TWO_PAIR*1e6 + hi*1e4 + lo*1e2 + kicker, rankName: 'Two Pair', breakdown: [hi, lo, kicker] };
  }
  if (groups[0][1]===2) {
    const pair = groups[0][0];
    const kicks = groups.filter(g=>g[1]===1).map(g=>g[0]).sort(byRankDesc).slice(0,3);
    return { score: CAT.PAIR*1e6 + pair*1e4 + kicks[0]*1e2 + kicks[1]*10 + kicks[2], rankName: 'One Pair', breakdown: [pair, ...kicks] };
  }
  return { score: CAT.HIGH*1e6 + rs[0]*1e4 + rs[1]*1e3 + rs[2]*1e2 + rs[3]*10 + rs[4], rankName: 'High Card', breakdown: rs };
}

// 7장 중 최적 5장 선택
export function evaluate7(hand2: Card[], board5: Card[]): EvalResult {
  const pool = [...hand2, ...board5].filter(c => !c.isJoker);
  // 플러시 먼저 빠르게 체크하여 후보 줄이기
  const suit = flushSuit(pool);
  let best: EvalResult | null = null;

  // 21조합
  for (let i=0;i<pool.length;i++){
    for (let j=i+1;j<pool.length;j++){
      for (let k=j+1;k<pool.length;k++){
        for (let l=k+1;l<pool.length;l++){
          for (let m=l+1;m<pool.length;m++){
            const five = [pool[i], pool[j], pool[k], pool[l], pool[m]];
            // suit가 있으면 해당 슈트 5장인 경우 우선 평가
            if (suit!=null) {
              const suitFive = five.filter(c=>c.s===suit);
              if (suitFive.length===5) {
                const sc = score5(suitFive);
                if (!best || sc.score > best.score) best = sc;
                continue;
              }
            }
            const sc = score5(five);
            if (!best || sc.score > best.score) best = sc;
          }
        }
      }
    }
  }
  // 모든 카드가 조커여서 pool이 0인 극단 케이스 → High Card(가짜 0들)
  return best ?? { score: 0, rankName: 'High Card', breakdown: [0,0,0,0,0] };
}

export function winnerSeat(a: EvalResult, b: EvalResult): Seat | 'TIE' {
  if (a.score > b.score) return 'P1';
  if (a.score < b.score) return 'P2';
  // 완전동일 → 무승부
  return 'TIE';
}

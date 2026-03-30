import type { Card, Rank } from './cards'

export type HiLoLowScore = readonly [number, number, number, number, number]

function rankToLowValue(r: Rank): number {
  if (r === 'A') return 1
  if (r === 'T') return 10
  if (r === 'J') return 11
  if (r === 'Q') return 12
  if (r === 'K') return 13
  return Number(r)
}

function combinations5(cards: Card[], out: Card[][]): void {
  const n = cards.length
  const pick: Card[] = []
  function dfs(start: number): void {
    if (pick.length === 5) {
      out.push([...pick])
      return
    }
    for (let i = start; i < n; i++) {
      pick.push(cards[i])
      dfs(i + 1)
      pick.pop()
    }
  }
  dfs(0)
}

/**
 * Positive means `a` is the better (lower) 8-or-better low.
 */
export function compareHiLoLowScores(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 13
    const bv = b[i] ?? 13
    if (av !== bv) return bv - av
  }
  return 0
}

function evaluateFiveCardEightOrBetter(cards: Card[]): HiLoLowScore | null {
  const vals = cards.map((c) => rankToLowValue(c.rank))
  const uniq = new Set(vals)
  if (uniq.size !== 5) return null
  const sorted = [...vals].sort((a, b) => b - a) as [
    number,
    number,
    number,
    number,
    number,
  ]
  if (sorted[0] > 8) return null
  return sorted
}

export function bestEightOrBetterLowScore(cards: Card[]): HiLoLowScore | null {
  if (cards.length < 5) return null
  const combos: Card[][] = []
  combinations5(cards, combos)
  let best: HiLoLowScore | null = null
  for (const combo of combos) {
    const s = evaluateFiveCardEightOrBetter(combo)
    if (!s) continue
    if (!best || compareHiLoLowScores(s, best) > 0) best = s
  }
  return best
}

function displayRank(v: number): string {
  if (v === 1) return 'A'
  return String(v)
}

export function hiLoLowHandLabel(score: HiLoLowScore): string {
  return `${displayRank(score[0])}-${displayRank(score[1])}-${displayRank(score[2])}-${displayRank(score[3])}-${displayRank(score[4])} low`
}

import type { Card, Rank } from './cards'

export type RazzLowScore = readonly [number, number, number, number, number]
export type RazzVisibleScore = readonly number[]

function rankToRazzValue(r: Rank): number {
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

function evaluateFiveCardRazz(cards: Card[]): RazzLowScore {
  const vals = cards
    .map((c) => rankToRazzValue(c.rank))
    .sort((a, b) => b - a) as [number, number, number, number, number]
  return vals
}

/** Positive means `a` is the better (lower) razz hand. */
export function compareRazzLowScores(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 13
    const bv = b[i] ?? 13
    if (av !== bv) return bv - av
  }
  return 0
}

export function bestRazzLowScore(cards: Card[]): RazzLowScore | null {
  if (cards.length < 5) return null
  const combos: Card[][] = []
  combinations5(cards, combos)
  let best: RazzLowScore | null = null
  for (const combo of combos) {
    const s = evaluateFiveCardRazz(combo)
    if (!best || compareRazzLowScores(s, best) > 0) best = s
  }
  return best
}

/** For exposed boards (2-4 cards), lower tuple is better in razz. */
export function razzVisibleScore(upcards: Card[]): RazzVisibleScore {
  return upcards.map((c) => rankToRazzValue(c.rank)).sort((a, b) => b - a)
}

function displayRank(v: number): string {
  if (v === 1) return 'A'
  if (v === 10) return 'T'
  if (v === 11) return 'J'
  if (v === 12) return 'Q'
  if (v === 13) return 'K'
  return String(v)
}

export function razzHandLabel(score: RazzLowScore): string {
  return `${displayRank(score[0])}-${displayRank(score[1])} low`
}


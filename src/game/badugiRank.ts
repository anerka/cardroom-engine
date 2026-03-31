import type { Card, Rank } from './cards'

export type BadugiScore = readonly [number, number, number, number, number]

function rankToLowValue(r: Rank): number {
  if (r === 'A') return 1
  if (r === 'T') return 10
  if (r === 'J') return 11
  if (r === 'Q') return 12
  if (r === 'K') return 13
  return Number(r)
}

/**
 * Positive => a is better (lower) badugi hand.
 */
export function compareBadugiScores(a: BadugiScore, b: BadugiScore): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  for (let i = 1; i < 5; i++) {
    if (a[i] !== b[i]) return b[i] - a[i]
  }
  return 0
}

function subsets(cards: Card[]): Card[][] {
  const out: Card[][] = []
  const n = cards.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const s: Card[] = []
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) s.push(cards[i])
    }
    out.push(s)
  }
  return out
}

function isValidBadugiSubset(cards: Card[]): boolean {
  const suits = new Set(cards.map((c) => c.suit))
  if (suits.size !== cards.length) return false
  const ranks = new Set(cards.map((c) => c.rank))
  return ranks.size === cards.length
}

export function bestBadugiScore(cards: Card[]): BadugiScore | null {
  if (cards.length === 0) return null
  let best: BadugiScore | null = null
  for (const sub of subsets(cards)) {
    if (!isValidBadugiSubset(sub)) continue
    const vals = sub.map((c) => rankToLowValue(c.rank)).sort((a, b) => b - a)
    const pad = [13, 13, 13, 13]
    for (let i = 0; i < vals.length; i++) pad[i] = vals[i]
    const score = [sub.length, pad[0], pad[1], pad[2], pad[3]] as BadugiScore
    if (!best || compareBadugiScores(score, best) > 0) best = score
  }
  return best
}

export function badugiHandLabel(score: BadugiScore): string {
  const cards = score[0]
  return `${cards}-card badugi`
}

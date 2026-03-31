import type { Card, Rank } from './cards'

export type DeuceLowScore = readonly [number, number, number, number, number, number, number]

function rankToDeuceValue(r: Rank): number {
  if (r === 'A') return 14
  if (r === 'T') return 10
  if (r === 'J') return 11
  if (r === 'Q') return 12
  if (r === 'K') return 13
  return Number(r)
}

function isFlush(cards: Card[]): boolean {
  if (cards.length === 0) return false
  const s = cards[0].suit
  return cards.every((c) => c.suit === s)
}

function isStraight(valsDesc: number[]): boolean {
  const uniq = [...new Set(valsDesc)].sort((a, b) => a - b)
  if (uniq.length !== 5) return false
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] !== uniq[i - 1] + 1) return false
  }
  return true
}

/**
 * [categoryPenalty, pairPenalty, high, next, next, next, low]
 * lower is better in 2-7 lowball
 */
export function bestDeuceToSevenLowScore(cards: Card[]): DeuceLowScore | null {
  if (cards.length < 5) return null
  const vals = cards.map((c) => rankToDeuceValue(c.rank)).sort((a, b) => b - a)
  const counts = new Map<number, number>()
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = [...counts.values()].sort((a, b) => b - a)
  let pairPenalty = 0
  if (groups[0] === 4) pairPenalty = 5
  else if (groups[0] === 3 && groups[1] === 2) pairPenalty = 4
  else if (groups[0] === 3) pairPenalty = 3
  else if (groups[0] === 2 && groups[1] === 2) pairPenalty = 2
  else if (groups[0] === 2) pairPenalty = 1
  const categoryPenalty = (isFlush(cards) ? 1 : 0) + (isStraight(vals) ? 1 : 0)
  return [categoryPenalty, pairPenalty, vals[0], vals[1], vals[2], vals[3], vals[4]]
}

export function compareDeuceScores(a: DeuceLowScore, b: DeuceLowScore): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 99
    const bv = b[i] ?? 99
    if (av !== bv) return bv - av
  }
  return 0
}

export function deuceHandLabel(score: DeuceLowScore): string {
  const [cat, pair, a, b] = score
  const bad = cat > 0 || pair > 0 ? ' (rough)' : ''
  return `${a}-${b} low${bad}`
}

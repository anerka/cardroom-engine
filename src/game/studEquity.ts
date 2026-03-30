import type { Card } from './cards'
import { freshDeck, shuffle } from './cards'
import { bestHandScore, compareScores, type HandScore } from './pokerRank'
import { bestRazzLowScore, compareRazzLowScores, type RazzLowScore } from './razzRank'

function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`
}

/**
 * Cards the viewer has seen: own hole + own up + every opponent's upcards.
 */
export function buildUnknownPoolForViewer(
  players: Array<{ hole: Card[]; up: Card[] }>,
  viewerIndex: number,
): Card[] {
  const seen = new Set<string>()
  for (const c of players[viewerIndex].hole) seen.add(cardKey(c))
  for (const c of players[viewerIndex].up) seen.add(cardKey(c))
  for (let i = 0; i < players.length; i++) {
    if (i === viewerIndex) continue
    for (const c of players[i].up) seen.add(cardKey(c))
  }
  return freshDeck().filter((c) => !seen.has(cardKey(c)))
}

/**
 * Monte Carlo equity for seven-card stud from the acting player's perspective.
 * Opponents are modeled with known upcards only; missing cards are drawn uniformly
 * from the unknown pool (no peeking at your hole cards).
 */
export function estimateStudShowdownEquity(
  players: Array<{ hole: Card[]; up: Card[]; folded: boolean }>,
  viewerIndex: number,
  unknownPool: Card[],
  iterations: number,
  rng: () => number,
): number {
  const needs = players.map((p, i) => {
    if (p.folded) return 0
    const known =
      i === viewerIndex ? p.hole.length + p.up.length : p.up.length
    return Math.max(0, 7 - known)
  })
  const totalNeed = needs.reduce((a, b) => a + b, 0)
  if (
    totalNeed === 0 ||
    unknownPool.length < totalNeed ||
    iterations <= 0
  ) {
    return 0.5
  }

  let share = 0

  for (let it = 0; it < iterations; it++) {
    const shuf = shuffle([...unknownPool], rng)
    let ptr = 0
    const hands: Card[][] = []

    for (let i = 0; i < players.length; i++) {
      const p = players[i]
      if (p.folded) {
        hands.push([])
        continue
      }
      const base =
        i === viewerIndex ? [...p.hole, ...p.up] : [...p.up]
      const n = needs[i]
      for (let k = 0; k < n; k++) {
        base.push(shuf[ptr++])
      }
      hands.push(base)
    }

    if (ptr !== totalNeed) continue

    const activeIdx: number[] = []
    const scores: HandScore[] = []
    for (let i = 0; i < players.length; i++) {
      if (players[i].folded) continue
      const sc = bestHandScore(hands[i])
      if (!sc) continue
      activeIdx.push(i)
      scores.push(sc)
    }
    if (activeIdx.length === 0) continue

    let best = 0
    for (let j = 1; j < scores.length; j++) {
      if (compareScores(scores[j], scores[best]) > 0) best = j
    }
    const winners: number[] = []
    for (let j = 0; j < scores.length; j++) {
      if (compareScores(scores[j], scores[best]) === 0) winners.push(activeIdx[j])
    }
    if (winners.includes(viewerIndex)) {
      share += 1 / winners.length
    }
  }

  return share / iterations
}

export function estimateRazzShowdownEquity(
  players: Array<{ hole: Card[]; up: Card[]; folded: boolean }>,
  viewerIndex: number,
  unknownPool: Card[],
  iterations: number,
  rng: () => number,
): number {
  const needs = players.map((p, i) => {
    if (p.folded) return 0
    const known =
      i === viewerIndex ? p.hole.length + p.up.length : p.up.length
    return Math.max(0, 7 - known)
  })
  const totalNeed = needs.reduce((a, b) => a + b, 0)
  if (
    totalNeed === 0 ||
    unknownPool.length < totalNeed ||
    iterations <= 0
  ) {
    return 0.5
  }

  let share = 0

  for (let it = 0; it < iterations; it++) {
    const shuf = shuffle([...unknownPool], rng)
    let ptr = 0
    const hands: Card[][] = []

    for (let i = 0; i < players.length; i++) {
      const p = players[i]
      if (p.folded) {
        hands.push([])
        continue
      }
      const base =
        i === viewerIndex ? [...p.hole, ...p.up] : [...p.up]
      const n = needs[i]
      for (let k = 0; k < n; k++) {
        base.push(shuf[ptr++])
      }
      hands.push(base)
    }

    if (ptr !== totalNeed) continue

    const activeIdx: number[] = []
    const scores: RazzLowScore[] = []
    for (let i = 0; i < players.length; i++) {
      if (players[i].folded) continue
      const sc = bestRazzLowScore(hands[i])
      if (!sc) continue
      activeIdx.push(i)
      scores.push(sc)
    }
    if (activeIdx.length === 0) continue

    let best = 0
    for (let j = 1; j < scores.length; j++) {
      if (compareRazzLowScores(scores[j], scores[best]) > 0) best = j
    }
    const winners: number[] = []
    for (let j = 0; j < scores.length; j++) {
      if (compareRazzLowScores(scores[j], scores[best]) === 0) winners.push(activeIdx[j])
    }
    if (winners.includes(viewerIndex)) {
      share += 1 / winners.length
    }
  }

  return share / iterations
}

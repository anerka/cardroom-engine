import type { Difficulty } from '../settings/types'
import type { Card } from './cards'
import { bestHandScore, compareScores, type HandScore } from './pokerRank'

export type AiAction = 'fold' | 'check' | 'call' | 'raise'

export interface AiContext {
  difficulty: Difficulty
  hole: Card[]
  up: Card[]
  toCall: number
  pot: number
  raiseIncrement: number
  canCheck: boolean
  canRaise: boolean
  stack: number
  street: 3 | 4 | 5 | 6 | 7
  activeOpponents: number
  raisesThisStreet: number
  humanIsLastAggressor: boolean
  /** Monte Carlo P(share pot at showdown) from fair information only (~0–1). */
  showdownEquity: number
  /**
   * Check-orbit with no bet yet: players who already checked before this seat
   * (0 = first to act). Used for steal / stab frequency.
   */
  checksBeforeMe: number
}

function noise(difficulty: Difficulty): number {
  if (difficulty === 'easy') return (Math.random() - 0.5) * 0.14
  if (difficulty === 'medium') return (Math.random() - 0.5) * 0.09
  return (Math.random() - 0.5) * 0.05
}

function handStrength01(score: HandScore | null): number {
  if (!score) return 0
  const cat = score[0] / 8
  const k = (score[1] ?? 0) / 12
  return Math.min(1, cat * 0.82 + k * 0.18)
}

function playStrength(full: number, visible: number): number {
  return Math.max(full, visible * 0.88 + full * 0.12)
}

function difficultyMargin(d: Difficulty): number {
  if (d === 'easy') return 0.02
  if (d === 'medium') return 0.038
  return 0.055
}

export function pickAiAction(ctx: AiContext): AiAction {
  const cards = [...ctx.hole, ...ctx.up]
  const scoreFull = bestHandScore(cards)
  const scoreVis = bestHandScore(ctx.up)
  let s = handStrength01(scoreFull)
  const v = handStrength01(scoreVis)
  s += noise(ctx.difficulty)
  s = Math.max(0, Math.min(1, s))
  const p = playStrength(s, v)
  const eq = ctx.showdownEquity

  const pressure = ctx.activeOpponents > 2 ? 0.025 : 0

  if (ctx.canCheck) {
    const pot = Math.max(1, ctx.pot)
    const ri = ctx.raiseIncrement
    const openShare = ri > 0 ? ri / (pot + ri) : 0
    const late =
      ctx.checksBeforeMe >= 2 ||
      ctx.checksBeforeMe >= Math.max(1, ctx.activeOpponents - 1)

    if (ctx.canRaise && ri > 0) {
      const marginOpen =
        difficultyMargin(ctx.difficulty) * 0.78 +
        (ctx.activeOpponents > 2 ? 0.022 : 0) -
        (late ? 0.014 : 0) +
        pressure * 0.4
      const needEq = openShare + marginOpen

      const valFreq =
        ctx.difficulty === 'hard' ? 0.55 : ctx.difficulty === 'medium' ? 0.4 : 0.28
      if (eq >= needEq && Math.random() < valFreq) return 'raise'

      if (
        eq >= needEq - 0.05 &&
        (p > 0.32 || v > 0.3 || eq > 0.26) &&
        Math.random() < (ctx.difficulty === 'hard' ? 0.38 : ctx.difficulty === 'medium' ? 0.26 : 0.16)
      ) {
        return 'raise'
      }

      const bluffBase =
        ctx.difficulty === 'hard' ? 0.16 : ctx.difficulty === 'medium' ? 0.1 : 0.055
      const lateBonus = late ? 0.09 : 0.035
      const boardRep = v > 0.46 ? 0.07 : 0
      const canBluff = eq < needEq - 0.02 && eq < 0.45
      if (canBluff && Math.random() < bluffBase + lateBonus + boardRep) {
        return 'raise'
      }
    }

    if (ctx.canRaise && Math.random() < (ctx.difficulty === 'hard' ? 0.2 : 0.11)) {
      if (p > 0.52 && eq > 0.24) return 'raise'
      if (v > 0.42 && eq > 0.28 && ctx.street >= 5) return 'raise'
    }

    if (eq < 0.12 && p < 0.22 && v < 0.2) return 'check'
    return 'check'
  }

  if (ctx.toCall > 0) {
    const potAfter = ctx.pot + ctx.toCall
    const potShare = ctx.toCall / potAfter

    const margin =
      difficultyMargin(ctx.difficulty) +
      (ctx.humanIsLastAggressor ? 0.048 : 0) +
      Math.min(0.065, Math.max(0, ctx.street - 3) * 0.014) +
      (ctx.raisesThisStreet >= 2 ? 0.038 * (ctx.raisesThisStreet - 1) : 0) +
      (ctx.activeOpponents > 2 ? -0.012 : 0)

    const needEquity = potShare + margin

    if (ctx.stack <= ctx.toCall) {
      return eq + noise(ctx.difficulty) * 0.04 >= potShare - 0.025 ? 'call' : 'fold'
    }

    if (ctx.canRaise) {
      const bar =
        ctx.street >= 6 ? 0.54 : ctx.street >= 5 ? 0.57 : ctx.street >= 4 ? 0.6 : 0.64
      const freq = ctx.difficulty === 'hard' ? 0.48 : ctx.difficulty === 'medium' ? 0.34 : 0.22
      if (eq > bar && Math.random() < freq) return 'raise'

      const semi =
        ctx.street >= 4 &&
        v > 0.4 &&
        eq > 0.3 &&
        eq < bar &&
        Math.random() < (ctx.difficulty === 'hard' ? 0.18 : 0.1)
      if (semi) return 'raise'
    }

    const eqAdj = eq + noise(ctx.difficulty) * 0.03
    if (eqAdj >= needEquity) return 'call'

    if (eqAdj >= needEquity - 0.035 && Math.random() < 0.12) return 'call'

    return 'fold'
  }

  if (ctx.canRaise && (eq > 0.52 || p > 0.52) && Math.random() < 0.35) return 'raise'
  return 'check'
}

export function compareAiHand(a: Card[], b: Card[]): number {
  const sa = bestHandScore(a)
  const sb = bestHandScore(b)
  if (!sa && !sb) return 0
  if (!sa) return -1
  if (!sb) return 1
  return compareScores(sa, sb)
}

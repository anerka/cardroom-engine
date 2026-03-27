import type { Difficulty } from '../settings/types'
import type { Card } from './cards'
import { bestHandScore, compareScores, type HandScore } from './pokerRank'

export type AiAction = 'fold' | 'check' | 'call' | 'raise'

export interface AiContext {
  difficulty: Difficulty
  /** Full known cards for this player (hole + up). */
  hole: Card[]
  up: Card[]
  toCall: number
  pot: number
  /** Cost to raise one limit increment (0 if cannot raise). */
  raiseIncrement: number
  canCheck: boolean
  canRaise: boolean
  stack: number
  street: 3 | 4 | 5 | 6 | 7
  /** Opponent count still in hand (not folded). */
  activeOpponents: number
  /** Aggression count on this street (opening bet = 1, each raise +1). */
  raisesThisStreet: number
  /** Human was last to increase the bet — tighten calling range. */
  humanIsLastAggressor: boolean
}

function noise(difficulty: Difficulty): number {
  if (difficulty === 'easy') return (Math.random() - 0.5) * 0.35
  if (difficulty === 'medium') return (Math.random() - 0.5) * 0.18
  return (Math.random() - 0.5) * 0.09
}

/** Map poker score to 0..1 for heuristics (not true equity). */
function handStrength01(score: HandScore | null): number {
  if (!score) return 0
  const cat = score[0] / 8
  const k = (score[1] ?? 0) / 12
  return Math.min(1, cat * 0.82 + k * 0.18)
}

/**
 * How strong we "look" and "are" for calling / raising — visible cards weigh
 * heavily (representation / semi-bluff), full hand for real strength.
 */
function playStrength(full: number, visible: number): number {
  return Math.max(full, visible * 0.88 + full * 0.12)
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

  const pressure = ctx.activeOpponents > 2 ? 0.04 : 0

  if (ctx.canCheck) {
    if (s < 0.26 - pressure && ctx.difficulty === 'easy' && Math.random() < 0.12) {
      return 'raise'
    }
    if (p < 0.32) return 'check'
    if (p > 0.58 && ctx.canRaise && Math.random() < 0.45) return 'raise'
    if (p > 0.48 && ctx.canRaise && v > 0.42 && Math.random() < 0.28) {
      return 'raise'
    }
    return 'check'
  }

  if (ctx.toCall > 0) {
    if (ctx.stack <= ctx.toCall) return 'call'

    const potAfter = ctx.pot + ctx.toCall
    const potOdds = ctx.pot / potAfter

    const junkFold =
      p < (ctx.difficulty === 'hard' ? 0.07 : ctx.difficulty === 'medium' ? 0.09 : 0.11) &&
      v < 0.14

    if (junkFold && Math.random() < (ctx.difficulty === 'easy' ? 0.5 : 0.68)) {
      return 'fold'
    }

    if (ctx.canRaise) {
      const strongRaise = p > 0.58 && Math.random() < (ctx.difficulty === 'hard' ? 0.52 : 0.38)
      const semiBluff =
        v > 0.4 &&
        s > 0.14 &&
        Math.random() <
          (ctx.difficulty === 'easy' ? 0.12 : ctx.difficulty === 'medium' ? 0.22 : 0.32)
      const thinValue =
        p > 0.45 &&
        p < 0.62 &&
        Math.random() < (ctx.difficulty === 'hard' ? 0.2 : 0.12)
      if (strongRaise || semiBluff || thinValue) return 'raise'
    }

    /** Minimum hand “strength” to call — was too low via old `p > 0.16` always-call. */
    const baseCall =
      ctx.difficulty === 'easy' ? 0.2 : ctx.difficulty === 'medium' ? 0.26 : 0.3
    const streetExtra = Math.min(0.1, Math.max(0, ctx.street - 3) * 0.025)
    const vsHuman = ctx.humanIsLastAggressor ? 0.11 : 0
    const vsMultiRaise =
      ctx.raisesThisStreet >= 2 ? 0.06 * (ctx.raisesThisStreet - 1) : 0
    const minStrengthToCall = Math.min(
      0.62,
      baseCall + streetExtra + vsHuman + vsMultiRaise,
    )

    /** Pot-odds path: only helps when pot is big vs price — not a free call. */
    const looseCallBias =
      ctx.difficulty === 'easy' ? 0.12 : ctx.difficulty === 'medium' ? 0.08 : 0.05
    const potOddsCallLine = potOdds - looseCallBias - (ctx.humanIsLastAggressor ? 0.1 : 0)

    const hasShowdownValue = p >= minStrengthToCall
    const hasPotOddsCall = p >= potOddsCallLine && p >= 0.14

    if (hasShowdownValue || hasPotOddsCall) {
      if (hasPotOddsCall && !hasShowdownValue) {
        const peelCap =
          ctx.humanIsLastAggressor && ctx.raisesThisStreet >= 2
            ? 0.18
            : ctx.humanIsLastAggressor
              ? 0.32
              : 0.55
        if (Math.random() > peelCap) return 'fold'
      }
      return 'call'
    }

    const desperatePeel =
      potOdds > 0.42 &&
      v > 0.36 &&
      ctx.street >= 5 &&
      !ctx.humanIsLastAggressor &&
      Math.random() < (ctx.difficulty === 'easy' ? 0.22 : 0.12)
    if (desperatePeel) return 'call'

    return Math.random() < (ctx.difficulty === 'easy' ? 0.18 : 0.12) ? 'call' : 'fold'
  }

  if (ctx.canRaise && p > 0.55) return 'raise'
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

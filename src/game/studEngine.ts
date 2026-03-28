import { pickAiAction, type AiContext } from './ai'
import {
  buildUnknownPoolForViewer,
  estimateStudShowdownEquity,
} from './studEquity'
import type { Card } from './cards'
import { compareDoorForBringIn, formatCard, freshDeck, shuffle } from './cards'
import { bestHandScore, bestVisibleScore, compareScores, handLabel } from './pokerRank'
import { buildPotLayers } from './sidePots'
import type { GameSettings } from '../settings/types'
import {
  STAKES_BY_TIER,
  TEMPO_HANDS_BY_PRESET,
} from '../settings/types'

/** Includes opening complete / first bet on a street. */
const MAX_RAISES_PER_STREET = 4

export interface TablePlayer {
  id: string
  isHuman: boolean
  name: string
  stack: number
  folded: boolean
  hole: Card[]
  up: Card[]
  /** Total chips put into pot this hand (for side pots). */
  contributedPot: number
  streetCommit: number
  allIn: boolean
}

export type SessionPhase =
  | 'idle'
  | 'betweenHands'
  | 'betting'
  | 'showdown'
  | 'handSummary'
  | 'youWonTable'
  | 'youBusted'

export interface EffectiveStakes {
  ante: number
  smallBet: number
  bigBet: number
  bringIn: number
}

export interface StudSnapshot {
  phase: SessionPhase
  players: TablePlayer[]
  dealerIndex: number
  pot: number
  street: 3 | 4 | 5 | 6 | 7
  bringInIndex: number | null
  actionIndex: number | null
  humanMustAct: boolean
  raisesThisStreet: number
  /** Current commitment to match this betting round (0 during check-orbit before a bet). */
  streetHighBet: number
  /** Seat index of the player who last increased the bet (bet/raise); null if none yet. */
  lastAggressorSeat: number | null
  stakes: EffectiveStakes
  level: number
  handNumber: number
  message: string
  lastSummary: string | null
}

export type HumanAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise' }

function seatLeftOf(i: number, n: number): number {
  return (i + 1) % n
}

function effectiveStakesFromSettings(
  settings: GameSettings,
  level: number,
): EffectiveStakes {
  const base = STAKES_BY_TIER[settings.stakes]
  const m = Math.pow(1.15, level)
  const r = (x: number) => Math.max(1, Math.round(x * m))
  return {
    ante: r(base.ante),
    smallBet: r(base.smallBet),
    bigBet: r(base.bigBet),
    bringIn: r(base.bringIn),
  }
}

function handsPerLevel(settings: GameSettings): number {
  if (settings.useAdvancedTempo) return settings.handsPerLevel
  return TEMPO_HANDS_BY_PRESET[settings.tempoPreset]
}

export class StudEngine {
  settings: GameSettings
  private rng: () => number
  players: TablePlayer[] = []
  dealerIndex = 0
  private deck: Card[] = []
  pot = 0
  street: 3 | 4 | 5 | 6 | 7 = 3
  bringInIndex: number | null = null
  actionIndex: number | null = null
  phase: SessionPhase = 'idle'
  raisesThisStreet = 0
  level = 0
  handNumber = 0
  message = ''
  lastSummary: string | null = null
  private highBet = 0
  /** When true, players in `checkPending` must check or open before the street advances. */
  private checkRound = false
  private checkPending = new Set<number>()
  /** Last seat that put in a raise / opening bet this street. */
  private lastAggressorSeat: number | null = null
  stakes: EffectiveStakes

  constructor(settings: GameSettings, rng: () => number = Math.random) {
    this.settings = settings
    this.rng = rng
    this.stakes = effectiveStakesFromSettings(settings, 0)
  }

  snapshot(): StudSnapshot {
    const humanMustAct =
      this.phase === 'betting' &&
      this.actionIndex !== null &&
      this.players[this.actionIndex]?.isHuman === true
    return {
      phase: this.phase,
      players: this.players.map((p) => ({ ...p, hole: [...p.hole], up: [...p.up] })),
      dealerIndex: this.dealerIndex,
      pot: this.pot,
      street: this.street,
      bringInIndex: this.bringInIndex,
      actionIndex: this.actionIndex,
      humanMustAct,
      raisesThisStreet: this.raisesThisStreet,
      streetHighBet: this.highBet,
      lastAggressorSeat: this.lastAggressorSeat,
      stakes: { ...this.stakes },
      level: this.level,
      handNumber: this.handNumber,
      message: this.message,
      lastSummary: this.lastSummary,
    }
  }

  startSession(): void {
    const baseStack = STAKES_BY_TIER[this.settings.stakes].startingStack
    this.players = []
    this.players.push({
      id: 'human',
      isHuman: true,
      name: 'You',
      stack: baseStack,
      folded: false,
      hole: [],
      up: [],
      contributedPot: 0,
      streetCommit: 0,
      allIn: false,
    })
    for (let i = 0; i < this.settings.opponentCount; i++) {
      this.players.push({
        id: `ai-${i}`,
        isHuman: false,
        name: `Bot ${i + 1}`,
        stack: baseStack,
        folded: false,
        hole: [],
        up: [],
        contributedPot: 0,
        streetCommit: 0,
        allIn: false,
      })
    }
    this.dealerIndex = Math.floor(this.rng() * this.players.length)
    this.level = 0
    this.handNumber = 0
    this.stakes = effectiveStakesFromSettings(this.settings, this.level)
    this.phase = 'betweenHands'
    this.message = 'Session started. Deal first hand when ready.'
    this.lastSummary = null
  }

  /** Call after hand summary to continue. */
  acknowledgeHandSummary(): void {
    if (this.phase !== 'handSummary') return
    this.lastSummary = null
    this.beginHand()
  }

  beginHand(): void {
    if (this.phase === 'youBusted' || this.phase === 'youWonTable') return
    const human = this.players.find((p) => p.isHuman)
    if (!human || human.stack <= 0) {
      this.phase = 'youBusted'
      this.message = 'You are out of chips.'
      this.actionIndex = null
      return
    }
    const alive = this.players.filter((p) => p.stack > 0)
    if (alive.length < 2) {
      this.phase = 'youWonTable'
      this.message = 'You cleared the table.'
      this.actionIndex = null
      return
    }

    this.handNumber += 1
    const hpl = handsPerLevel(this.settings)
    if (hpl > 0 && this.handNumber > 1 && (this.handNumber - 1) % hpl === 0) {
      this.level += 1
      this.stakes = effectiveStakesFromSettings(this.settings, this.level)
      this.message = `Stakes increased (level ${this.level}).`
    }

    this.players = this.players.filter((p) => p.stack > 0)
    if (this.players.length < 2) {
      this.beginHand()
      return
    }
    if (this.dealerIndex >= this.players.length) {
      this.dealerIndex = 0
    }

    const { ante } = this.stakes
    for (const p of this.players) {
      if (p.stack < ante) {
        p.stack = 0
      }
    }
    this.players = this.players.filter((p) => p.stack > 0)
    if (this.players.length < 2) {
      this.beginHand()
      return
    }

    this.resetForNewHand()
    this.deck = shuffle(freshDeck(), this.rng)
    this.pot = 0
    for (const p of this.players) {
      const pay = Math.min(ante, p.stack)
      p.stack -= pay
      p.contributedPot += pay
      this.pot += pay
    }

    for (const p of this.players) {
      p.hole = [this.deck.pop()!, this.deck.pop()!]
      p.up = [this.deck.pop()!]
    }

    let bi = 0
    for (let i = 1; i < this.players.length; i++) {
      const c = compareDoorForBringIn(
        this.players[i].up[0],
        this.players[bi].up[0],
      )
      if (c < 0) bi = i
    }
    this.bringInIndex = bi
    const bring = Math.min(this.stakes.bringIn, this.players[bi].stack)
    this.players[bi].stack -= bring
    this.players[bi].contributedPot += bring
    this.players[bi].streetCommit = bring
    this.pot += bring

    this.highBet = bring
    this.raisesThisStreet = 0
    this.lastAggressorSeat = null
    this.checkRound = false
    this.checkPending.clear()
    this.street = 3
    this.phase = 'betting'
    this.actionIndex = this.nextActorFrom(seatLeftOf(bi, this.players.length))
    this.message = `${this.players[bi].name} brings in ${bring}.`
  }

  private resetForNewHand(): void {
    for (const p of this.players) {
      p.folded = false
      p.hole = []
      p.up = []
      p.contributedPot = 0
      p.streetCommit = 0
      p.allIn = false
    }
    this.highBet = 0
    this.raisesThisStreet = 0
    this.checkRound = false
    this.checkPending.clear()
    this.bringInIndex = null
    this.lastAggressorSeat = null
  }

  private betUnit(): number {
    return this.street <= 4 ? this.stakes.smallBet : this.stakes.bigBet
  }

  private needsToAct(i: number): boolean {
    const p = this.players[i]
    if (p.folded || p.allIn) return false
    if (this.checkRound) return this.checkPending.has(i)
    return p.streetCommit < this.highBet
  }

  private anyNeedsToAct(): boolean {
    return this.players.some((_, i) => this.needsToAct(i))
  }

  private nextRaiseTarget(): number {
    if (this.street === 3 && this.highBet < this.stakes.smallBet) {
      return this.stakes.smallBet
    }
    return this.highBet + this.betUnit()
  }

  private raiseCost(p: TablePlayer): number {
    return this.nextRaiseTarget() - p.streetCommit
  }

  private nextActorFrom(start: number): number | null {
    const n = this.players.length
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      if (this.needsToAct(i)) return i
    }
    return null
  }

  private openingSeatFourthPlus(): number {
    const alive = this.players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.folded)
    if (alive.length === 0) return 0
    let bestScore = bestVisibleScore(this.players[alive[0].i].up)
    let bestIdx = alive[0].i
    for (const { i } of alive.slice(1)) {
      const s = bestVisibleScore(this.players[i].up)
      if (!bestScore || (s && compareScores(s, bestScore) > 0)) {
        bestScore = s
        bestIdx = i
      }
    }
    const tied: number[] = []
    for (const { i } of alive) {
      const s = bestVisibleScore(this.players[i].up)
      if (s && bestScore && compareScores(s, bestScore) === 0) tied.push(i)
    }
    tied.sort(
      (a, b) =>
        (a - this.dealerIndex - 1 + this.players.length) % this.players.length -
        (b - this.dealerIndex - 1 + this.players.length) % this.players.length,
    )
    return tied[0] ?? bestIdx
  }

  private advanceAfterBettingRound(): void {
    const inHand = this.players.filter((p) => !p.folded)
    if (inHand.length === 1) {
      this.awardPotToSingle(inHand[0].id)
      return
    }
    if (this.street === 7) {
      this.runShowdown()
      return
    }
    this.dealNextStreet()
  }

  private dealNextStreet(): void {
    for (const p of this.players) {
      if (p.folded) continue
      if (this.street <= 5) {
        p.up.push(this.deck.pop()!)
      } else if (this.street === 6) {
        p.hole.push(this.deck.pop()!)
      }
    }
    this.street = (this.street + 1) as 3 | 4 | 5 | 6 | 7
    for (const p of this.players) {
      p.streetCommit = 0
    }
    this.highBet = 0
    this.raisesThisStreet = 0
    this.lastAggressorSeat = null
    this.checkRound = true
    this.checkPending.clear()
    const opener = this.openingSeatFourthPlus()
    const n = this.players.length
    for (let k = 0; k < n; k++) {
      const i = (opener + k) % n
      const p = this.players[i]
      if (!p.folded && !p.allIn) this.checkPending.add(i)
    }
    this.phase = 'betting'
    this.actionIndex = this.nextActorFrom(opener)
    if (this.actionIndex === null) {
      this.advanceAfterBettingRound()
    }
  }

  private awardPotToSingle(winnerId: string): void {
    const w = this.players.find((p) => p.id === winnerId)
    if (w) {
      w.stack += this.pot
      this.lastSummary = `${w.name} wins ${this.pot} chips.`
    }
    this.pot = 0
    this.phase = 'handSummary'
    this.actionIndex = null
    this.message = 'Hand complete.'
    this.rotateDealer()
  }

  private rotateDealer(): void {
    if (this.players.length === 0) return
    this.dealerIndex = seatLeftOf(this.dealerIndex, this.players.length)
  }

  private runShowdown(): void {
    const contenders = this.players.filter((p) => !p.folded)
    const layers = buildPotLayers(
      contenders.map((p) => ({ id: p.id, contributed: p.contributedPot })),
    )
    const lines: string[] = []
    for (const layer of layers) {
      const eligible = contenders.filter((p) => layer.eligibleIds.includes(p.id))
      let best: ReturnType<typeof bestHandScore> = null
      for (const p of eligible) {
        const s = bestHandScore([...p.hole, ...p.up])
        if (!best || (s && compareScores(s, best) > 0)) best = s
      }
      const winners = eligible.filter((p) => {
        const s = bestHandScore([...p.hole, ...p.up])
        return s && best && compareScores(s, best) === 0
      })
      const share = Math.floor(layer.amount / winners.length)
      let rem = layer.amount - share * winners.length
      for (const w of winners) {
        const add = share + (rem > 0 ? 1 : 0)
        if (rem > 0) rem -= 1
        w.stack += add
      }
      const names = winners.map((w) => w.name).join(', ')
      lines.push(
        `${layer.amount} → ${names}${best ? ` (${handLabel(best)})` : ''}`,
      )
    }
    this.pot = 0
    this.lastSummary = lines.join(' · ')
    this.phase = 'handSummary'
    this.actionIndex = null
    this.message = 'Showdown.'
    this.rotateDealer()
  }

  legalHumanActions(): HumanAction['type'][] {
    if (!this.snapshot().humanMustAct) return []
    const i = this.actionIndex!
    const p = this.players[i]
    const toCall = Math.max(0, this.highBet - p.streetCommit)
    const rc = this.raiseCost(p)
    const canRaise =
      this.raisesThisStreet < MAX_RAISES_PER_STREET && rc > 0 && p.stack >= rc
    const out: HumanAction['type'][] = ['fold']
    if (this.checkRound && this.highBet === 0) {
      out.push('check')
      if (canRaise) out.push('raise')
      return out
    }
    if (toCall === 0) {
      out.push('check')
      if (canRaise) out.push('raise')
    } else {
      out.push('call')
      if (canRaise) out.push('raise')
    }
    return out
  }

  applyHuman(a: HumanAction): void {
    if (!this.snapshot().humanMustAct) return
    this.applyAction(this.actionIndex!, a)
    this.runAiLoop()
  }

  runAiLoop(): void {
    while (this.phase === 'betting' && this.actionIndex !== null) {
      const p = this.players[this.actionIndex]
      if (p.isHuman) break
      const ctx = this.buildAiContext(this.actionIndex)
      const choice = pickAiAction(ctx)
      const mapped: HumanAction =
        choice === 'check'
          ? { type: 'check' }
          : choice === 'call'
            ? { type: 'call' }
            : choice === 'raise'
              ? { type: 'raise' }
              : { type: 'fold' }
      this.applyAction(this.actionIndex, mapped)
    }
  }

  private buildAiContext(i: number): AiContext {
    const p = this.players[i]
    const toCall =
      this.checkRound && this.highBet === 0
        ? 0
        : Math.max(0, this.highBet - p.streetCommit)
    const rc = this.raiseCost(p)
    const canCheck = toCall === 0
    const canRaise =
      this.raisesThisStreet < MAX_RAISES_PER_STREET && rc > 0 && p.stack >= rc
    const activeOpponents = this.players.filter(
      (x, j) => j !== i && !x.folded,
    ).length
    const humanIdx = this.players.findIndex((x) => x.isHuman)
    const humanIsLastAggressor =
      humanIdx >= 0 &&
      this.lastAggressorSeat === humanIdx &&
      this.raisesThisStreet > 0

    const pool = buildUnknownPoolForViewer(
      this.players.map((pl) => ({ hole: pl.hole, up: pl.up })),
      i,
    )
    const mcIters =
      this.settings.difficulty === 'easy'
        ? 160
        : this.settings.difficulty === 'medium'
          ? 300
          : 440
    const showdownEquity = estimateStudShowdownEquity(
      this.players.map((pl) => ({
        hole: pl.hole,
        up: pl.up,
        folded: pl.folded,
      })),
      i,
      pool,
      mcIters,
      this.rng,
    )

    const aliveInBettingOrbit = this.players.filter(
      (pl) => !pl.folded && !pl.allIn,
    ).length
    const checksBeforeMe =
      this.checkRound && this.highBet === 0
        ? aliveInBettingOrbit - this.checkPending.size
        : 0

    return {
      difficulty: this.settings.difficulty,
      hole: p.hole,
      up: p.up,
      toCall,
      pot: this.pot,
      raiseIncrement: canRaise ? rc : 0,
      canCheck,
      canRaise,
      stack: p.stack,
      street: this.street,
      activeOpponents,
      raisesThisStreet: this.raisesThisStreet,
      humanIsLastAggressor,
      showdownEquity,
      checksBeforeMe,
    }
  }

  private applyAction(i: number, a: HumanAction): void {
    const p = this.players[i]
    const toCall = Math.max(0, this.highBet - p.streetCommit)

    if (a.type === 'fold') {
      p.folded = true
      this.checkPending.delete(i)
      this.afterAction(i)
      return
    }

    if (a.type === 'check') {
      if (toCall !== 0) return
      if (this.checkRound) this.checkPending.delete(i)
      this.afterAction(i)
      return
    }

    if (a.type === 'call') {
      if (this.checkRound && this.highBet === 0) return
      const pay = Math.min(p.stack, toCall)
      p.stack -= pay
      p.streetCommit += pay
      p.contributedPot += pay
      this.pot += pay
      if (p.stack === 0) p.allIn = true
      this.afterAction(i)
      return
    }

    if (a.type === 'raise') {
      if (this.raisesThisStreet >= MAX_RAISES_PER_STREET) return
      if (this.checkRound && this.highBet === 0) {
        this.checkRound = false
        this.checkPending.clear()
      }
      const newHigh = this.nextRaiseTarget()
      const cost = newHigh - p.streetCommit
      if (cost <= 0) return
      if (p.stack < cost) {
        const pay = p.stack
        p.stack = 0
        p.streetCommit += pay
        p.contributedPot += pay
        this.pot += pay
        p.allIn = true
        if (p.streetCommit > this.highBet) {
          this.highBet = p.streetCommit
          this.raisesThisStreet += 1
          this.lastAggressorSeat = i
        }
        this.afterAction(i)
        return
      }
      p.stack -= cost
      p.streetCommit += cost
      p.contributedPot += cost
      this.pot += cost
      this.highBet = newHigh
      this.raisesThisStreet += 1
      this.lastAggressorSeat = i
      if (p.stack === 0) p.allIn = true
      this.afterAction(i)
    }
  }

  private afterAction(fromSeat: number): void {
    const alive = this.players.filter((p) => !p.folded)
    if (alive.length === 1) {
      this.awardPotToSingle(alive[0].id)
      return
    }

    if (this.checkRound && this.checkPending.size === 0 && this.highBet === 0) {
      this.advanceAfterBettingRound()
      return
    }

    if (!this.anyNeedsToAct()) {
      this.advanceAfterBettingRound()
      return
    }

    const n = this.players.length
    this.actionIndex = this.nextActorFrom(seatLeftOf(fromSeat, n))
    if (this.actionIndex === null) {
      this.advanceAfterBettingRound()
    }
  }
}

export function formatPlayerCardsForLog(p: TablePlayer, revealAll: boolean): string {
  const up = p.up.map(formatCard).join(' ')
  if (revealAll) {
    const hole = p.hole.map(formatCard).join(' ')
    return `[${hole}] / ${up}`
  }
  return `[··] / ${up}`
}

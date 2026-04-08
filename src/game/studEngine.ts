import { pickAiAction, type AiContext } from './ai'
import {
  buildUnknownPoolForViewer,
  estimateStudHiLoShowdownEquity,
  estimateRazzShowdownEquity,
  estimateStudShowdownEquity,
} from './studEquity'
import type { Card } from './cards'
import { compareDoorForBringIn, formatCard, freshDeck, shuffle } from './cards'
import { bestHandScore, bestVisibleScore, compareScores, handLabel } from './pokerRank'
import {
  bestRazzLowScore,
  compareRazzLowScores,
  razzHandLabel,
  razzVisibleScore,
} from './razzRank'
import {
  bestEightOrBetterLowScore,
  compareHiLoLowScores,
  hiLoLowHandLabel,
} from './hiloRank'
import {
  bestBadugiScore,
  compareBadugiScores,
  badugiHandLabel,
} from './badugiRank'
import {
  bestDeuceToSevenLowScore,
  compareDeuceScores,
  deuceHandLabel,
} from './deuceRank'
import { buildPotLayers } from './sidePots'
import type { GameKind, GameSettings } from '../settings/types'
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
  | 'draw'
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

/** Cumulative human session stats; updated when each hand moves to handSummary. */
export interface SessionStats {
  handsPlayed: number
  handsWon: number
  handsFolded: number
  /** Wins by how many cards you held when you won (stud: 3 … 7). */
  winsByHeroCardCount: Record<3 | 4 | 5 | 6 | 7, number>
  /**
   * Wins where you still had at least N cards when you won — i.e. you had “stayed past”
   * the 3rd, 4th, 5th, or 6th card (N = 4…7).
   */
  winsAfterAtLeastCards: Record<4 | 5 | 6 | 7, number>
  biggestPotShareWon: number
  /** Largest full pot in a hand you won (any share). */
  biggestFullPotWhenWon: number
  totalChipsWonFromPots: number
  showdownsContested: number
  showdownsWon: number
}

function emptySessionStats(): SessionStats {
  return {
    handsPlayed: 0,
    handsWon: 0,
    handsFolded: 0,
    winsByHeroCardCount: { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 },
    winsAfterAtLeastCards: { 4: 0, 5: 0, 6: 0, 7: 0 },
    biggestPotShareWon: 0,
    biggestFullPotWhenWon: 0,
    totalChipsWonFromPots: 0,
    showdownsContested: 0,
    showdownsWon: 0,
  }
}

function cloneSessionStats(s: SessionStats): SessionStats {
  return {
    ...s,
    winsByHeroCardCount: { ...s.winsByHeroCardCount },
    winsAfterAtLeastCards: { ...s.winsAfterAtLeastCards },
  }
}

/** UI maps `chips` → bet/call WAV; `raise` → raise-over MP3. */
export type BettingSound = 'chips' | 'raise'

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
  sessionStats: SessionStats
  /**
   * Increments when a player calls or puts chips in as bet/raise.
   * UI should play `lastBettingSound` whenever this value increases (avoids Strict Mode drops).
   */
  bettingSoundNonce: number
  lastBettingSound: BettingSound | null
}

export type HumanAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise' }
  | { type: 'draw'; count: number; discardIndices?: number[] }

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

function isDrawGame(gameKind: GameKind): boolean {
  return gameKind === 'badugi' || gameKind === 'deuce7'
}

export class StudEngine {
  settings: GameSettings
  gameKind: GameKind
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
  sessionStats: SessionStats = emptySessionStats()
  private highBet = 0
  /** When true, players in `checkPending` must check or open before the street advances. */
  private checkRound = false
  private checkPending = new Set<number>()
  /** Last seat that put in a raise / opening bet this street. */
  private lastAggressorSeat: number | null = null
  private bettingSoundNonce = 0
  private lastBettingSound: BettingSound | null = null
  private drawRound = 0
  private drawPending = new Set<number>()
  stakes: EffectiveStakes

  constructor(
    settings: GameSettings,
    gameKind: GameKind = 'stud',
    rng: () => number = Math.random,
  ) {
    this.settings = settings
    this.gameKind = gameKind
    this.rng = rng
    this.stakes = effectiveStakesFromSettings(settings, 0)
  }

  snapshot(): StudSnapshot {
    const humanMustAct =
      (this.phase === 'betting' || this.phase === 'draw') &&
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
      sessionStats: cloneSessionStats(this.sessionStats),
      bettingSoundNonce: this.bettingSoundNonce,
      lastBettingSound: this.lastBettingSound,
    }
  }

  private emitBettingSound(kind: BettingSound): void {
    this.bettingSoundNonce += 1
    this.lastBettingSound = kind
  }

  startSession(): void {
    const tier = STAKES_BY_TIER[this.settings.stakes]
    const minStack = Math.max(tier.ante, tier.bringIn) * 2
    const baseStack = Math.max(minStack, this.settings.startingStack)
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
    this.sessionStats = emptySessionStats()
    this.bettingSoundNonce = 0
    this.lastBettingSound = null
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

    if (isDrawGame(this.gameKind)) {
      const holeCount = this.gameKind === 'badugi' ? 4 : 5
      for (const p of this.players) {
        p.hole = []
        p.up = []
        for (let k = 0; k < holeCount; k++) p.hole.push(this.deck.pop()!)
      }
      for (const p of this.players) p.streetCommit = 0
      this.highBet = 0
      this.raisesThisStreet = 0
      this.lastAggressorSeat = null
      this.checkRound = true
      this.checkPending.clear()
      const opener = seatLeftOf(this.dealerIndex, this.players.length)
      for (let k = 0; k < this.players.length; k++) {
        const i = (opener + k) % this.players.length
        const p = this.players[i]
        if (!p.folded && !p.allIn) this.checkPending.add(i)
      }
      this.street = 3
      this.drawRound = 0
      this.phase = 'betting'
      this.actionIndex = this.nextActorFrom(opener)
      this.message = 'Opening betting round.'
      return
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
      if (this.gameKind === 'razz' ? c > 0 : c < 0) bi = i
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
    this.drawPending.clear()
    this.drawRound = 0
    this.bringInIndex = null
    this.lastAggressorSeat = null
  }

  private betUnit(): number {
    if (isDrawGame(this.gameKind)) {
      return this.drawRound < 2 ? this.stakes.smallBet : this.stakes.bigBet
    }
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

  private activeNotAllInCount(): number {
    return this.players.filter((p) => !p.folded && !p.allIn).length
  }

  private nextRaiseTarget(): number {
    if (!isDrawGame(this.gameKind) && this.street === 3 && this.highBet < this.stakes.smallBet) {
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
    let bestRazz = razzVisibleScore(this.players[alive[0].i].up)
    let bestIdx = alive[0].i
    for (const { i } of alive.slice(1)) {
      if (this.gameKind === 'razz') {
        const s = razzVisibleScore(this.players[i].up)
        if (compareRazzLowScores(s, bestRazz) > 0) {
          bestRazz = s
          bestIdx = i
        }
      } else {
        const s = bestVisibleScore(this.players[i].up)
        if (!bestScore || (s && compareScores(s, bestScore) > 0)) {
          bestScore = s
          bestIdx = i
        }
      }
    }
    const tied: number[] = []
    for (const { i } of alive) {
      if (this.gameKind === 'razz') {
        const s = razzVisibleScore(this.players[i].up)
        if (compareRazzLowScores(s, bestRazz) === 0) tied.push(i)
      } else {
        const s = bestVisibleScore(this.players[i].up)
        if (s && bestScore && compareScores(s, bestScore) === 0) tied.push(i)
      }
    }
    tied.sort(
      (a, b) =>
        (a - this.dealerIndex - 1 + this.players.length) % this.players.length -
        (b - this.dealerIndex - 1 + this.players.length) % this.players.length,
    )
    return tied[0] ?? bestIdx
  }

  /**
   * After a street closes with unequal commitments (short all-in vs full bets),
   * return uncalled chips to anyone who bet more than the best anyone else matched.
   */
  private refundUncalledStreetBets(): void {
    const active = this.players.filter((p) => !p.folded)
    if (active.length < 2) return
    const snap = active.map((p) => ({ p, c: p.streetCommit }))
    for (const { p, c } of snap) {
      const maxOther = Math.max(0, ...snap.filter((x) => x.p !== p).map((x) => x.c))
      if (c > maxOther) {
        const refund = c - maxOther
        p.streetCommit -= refund
        p.contributedPot -= refund
        p.stack += refund
        this.pot -= refund
      }
    }
  }

  private advanceAfterBettingRound(): void {
    this.refundUncalledStreetBets()
    const inHand = this.players.filter((p) => !p.folded)
    if (inHand.length === 1) {
      this.awardPotToSingle(inHand[0].id)
      return
    }
    if (isDrawGame(this.gameKind)) {
      if (this.drawRound >= 3) {
        this.runShowdown()
      } else {
        this.beginDrawRound()
      }
      return
    }
    if (this.street === 7) {
      this.runShowdown()
      return
    }
    this.dealNextStreet()
  }

  private beginDrawRound(): void {
    this.phase = 'draw'
    this.drawRound += 1
    this.drawPending.clear()
    const opener = seatLeftOf(this.dealerIndex, this.players.length)
    for (let k = 0; k < this.players.length; k++) {
      const i = (opener + k) % this.players.length
      const p = this.players[i]
      if (!p.folded && !p.allIn) this.drawPending.add(i)
    }
    this.actionIndex = this.nextDrawActorFrom(opener)
    this.message = `Draw ${this.drawRound}: choose how many cards to draw.`
    if (this.actionIndex === null) this.finishDrawRound()
  }

  private nextDrawActorFrom(start: number): number | null {
    const n = this.players.length
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      if (this.drawPending.has(i)) return i
    }
    return null
  }

  private finishDrawRound(): void {
    if (this.activeNotAllInCount() <= 1) {
      if (this.drawRound >= 3) {
        this.runShowdown()
      } else {
        this.beginDrawRound()
      }
      return
    }
    for (const p of this.players) p.streetCommit = 0
    this.highBet = 0
    this.raisesThisStreet = 0
    this.lastAggressorSeat = null
    this.checkRound = true
    this.checkPending.clear()
    const opener = seatLeftOf(this.dealerIndex, this.players.length)
    for (let k = 0; k < this.players.length; k++) {
      const i = (opener + k) % this.players.length
      const p = this.players[i]
      if (!p.folded && !p.allIn) this.checkPending.add(i)
    }
    this.street = (3 + this.drawRound) as 3 | 4 | 5 | 6 | 7
    this.phase = 'betting'
    this.actionIndex = this.nextActorFrom(opener)
    this.message = `Betting after draw ${this.drawRound}.`
    if (this.actionIndex === null) this.advanceAfterBettingRound()
  }

  private dealNextStreet(): void {
    this.normalizeAllInFromStack()
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
    const human = this.players.find((p) => p.isHuman)
    const humanStackBefore = human?.stack ?? 0
    const humanFolded = human?.folded ?? true
    const humanTotalCards = human ? human.hole.length + human.up.length : 0
    const endStreet = this.street
    const potSize = this.pot

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

    const humanPotShare = (human?.stack ?? 0) - humanStackBefore
    this.applySessionHandEnd({
      potSize,
      humanPotShare,
      endStreet,
      humanFolded,
      humanTotalCards,
      humanParticipatedInShowdown: false,
    })
  }

  private rotateDealer(): void {
    if (this.players.length === 0) return
    this.dealerIndex = seatLeftOf(this.dealerIndex, this.players.length)
  }

  private dealerLeftOrder(ids: string[]): string[] {
    const seatById = new Map(this.players.map((p, i) => [p.id, i]))
    return [...ids].sort((a, b) => {
      const ai = seatById.get(a) ?? 0
      const bi = seatById.get(b) ?? 0
      const ad = (ai - this.dealerIndex - 1 + this.players.length) % this.players.length
      const bd = (bi - this.dealerIndex - 1 + this.players.length) % this.players.length
      return ad - bd
    })
  }

  private distributeChipsByDealerOrder(
    amount: number,
    winners: TablePlayer[],
  ): void {
    if (winners.length === 0 || amount <= 0) return
    const orderedIds = this.dealerLeftOrder(winners.map((w) => w.id))
    const ordered = orderedIds
      .map((id) => winners.find((w) => w.id === id))
      .filter((w): w is TablePlayer => Boolean(w))
    const share = Math.floor(amount / ordered.length)
    let rem = amount - share * ordered.length
    for (const w of ordered) {
      const add = share + (rem > 0 ? 1 : 0)
      if (rem > 0) rem -= 1
      w.stack += add
    }
  }

  private runShowdown(): void {
    const contenders = this.players.filter((p) => !p.folded)
    const humanParticipatedInShowdown = contenders.some((p) => p.isHuman)
    const human = this.players.find((p) => p.isHuman)
    const humanStackBefore = human?.stack ?? 0
    const humanFolded = human?.folded ?? true
    const humanTotalCards = human ? human.hole.length + human.up.length : 0
    const potSize = this.pot

    const layers = buildPotLayers(
      contenders.map((p) => ({ id: p.id, contributed: p.contributedPot })),
    )
    const lines: string[] = []
    for (const layer of layers) {
      const eligible = contenders.filter((p) => layer.eligibleIds.includes(p.id))
      let best: ReturnType<typeof bestHandScore> = null
      let bestLow: ReturnType<typeof bestRazzLowScore> = null
      let bestHiLoLow: ReturnType<typeof bestEightOrBetterLowScore> = null
      for (const p of eligible) {
        if (this.gameKind === 'stud') {
          const s = bestHandScore([...p.hole, ...p.up])
          if (!best || (s && compareScores(s, best) > 0)) best = s
        } else if (this.gameKind === 'razz') {
          const s = bestRazzLowScore([...p.hole, ...p.up])
          if (!bestLow || (s && compareRazzLowScores(s, bestLow) > 0)) bestLow = s
        } else if (this.gameKind === 'badugi') {
          // handled below
        } else if (this.gameKind === 'deuce7') {
          // handled below
        } else {
          const s = bestHandScore([...p.hole, ...p.up])
          if (!best || (s && compareScores(s, best) > 0)) best = s
          const l = bestEightOrBetterLowScore([...p.hole, ...p.up])
          if (l && (!bestHiLoLow || compareHiLoLowScores(l, bestHiLoLow) > 0)) {
            bestHiLoLow = l
          }
        }
      }
      if (this.gameKind !== 'studhilo') {
        const winners = eligible.filter((p) => {
          if (this.gameKind === 'stud') {
            const s = bestHandScore([...p.hole, ...p.up])
            return s && best && compareScores(s, best) === 0
          }
          if (this.gameKind === 'razz') {
            const s = bestRazzLowScore([...p.hole, ...p.up])
            return s && bestLow && compareRazzLowScores(s, bestLow) === 0
          }
          if (this.gameKind === 'badugi') {
            const s = bestBadugiScore(p.hole)
            const b = eligible
              .map((x) => bestBadugiScore(x.hole))
              .filter((x): x is NonNullable<typeof x> => Boolean(x))
              .sort((a, b) => (compareBadugiScores(a, b) > 0 ? -1 : 1))[0]
            return !!(s && b && compareBadugiScores(s, b) === 0)
          }
          const s = bestDeuceToSevenLowScore(p.hole)
          const b = eligible
            .map((x) => bestDeuceToSevenLowScore(x.hole))
            .filter((x): x is NonNullable<typeof x> => Boolean(x))
            .sort((a, b) => (compareDeuceScores(a, b) > 0 ? -1 : 1))[0]
          return !!(s && b && compareDeuceScores(s, b) === 0)
        })
        this.distributeChipsByDealerOrder(layer.amount, winners)
        const names = winners.map((w) => w.name).join(', ')
        const scoreLabel =
          this.gameKind === 'stud'
            ? best
              ? handLabel(best)
              : null
            : this.gameKind === 'razz'
              ? bestLow
                ? razzHandLabel(bestLow)
                : null
              : this.gameKind === 'badugi'
                ? (() => {
                    const b = eligible
                      .map((x) => bestBadugiScore(x.hole))
                      .filter((x): x is NonNullable<typeof x> => Boolean(x))
                      .sort((a, b) => (compareBadugiScores(a, b) > 0 ? -1 : 1))[0]
                    return b ? badugiHandLabel(b) : null
                  })()
                : (() => {
                    const d = eligible
                      .map((x) => bestDeuceToSevenLowScore(x.hole))
                      .filter((x): x is NonNullable<typeof x> => Boolean(x))
                      .sort((a, b) => (compareDeuceScores(a, b) > 0 ? -1 : 1))[0]
                    return d ? deuceHandLabel(d) : null
                  })()
        lines.push(
          `${layer.amount} → ${names}${scoreLabel ? ` (${scoreLabel})` : ''}`,
        )
        continue
      }

      const highWinners = eligible.filter((p) => {
        const s = bestHandScore([...p.hole, ...p.up])
        return s && best && compareScores(s, best) === 0
      })
      const lowWinners =
        bestHiLoLow === null
          ? []
          : eligible.filter((p) => {
              const s = bestEightOrBetterLowScore([...p.hole, ...p.up])
              return s && compareHiLoLowScores(s, bestHiLoLow) === 0
            })

      if (lowWinners.length === 0) {
        this.distributeChipsByDealerOrder(layer.amount, highWinners)
        const names = highWinners.map((w) => w.name).join(', ')
        lines.push(
          `${layer.amount} → ${names}${best ? ` (High: ${handLabel(best)})` : ''}`,
        )
        continue
      }

      let highAmount = Math.floor(layer.amount / 2)
      let lowAmount = Math.floor(layer.amount / 2)
      if (layer.amount % 2 === 1) {
        const unionWinnerIds = [...new Set([...highWinners, ...lowWinners].map((w) => w.id))]
        const firstId = this.dealerLeftOrder(unionWinnerIds)[0]
        if (firstId && lowWinners.some((w) => w.id === firstId) && !highWinners.some((w) => w.id === firstId)) {
          lowAmount += 1
        } else {
          highAmount += 1
        }
      }

      this.distributeChipsByDealerOrder(highAmount, highWinners)
      this.distributeChipsByDealerOrder(lowAmount, lowWinners)
      const highNames = highWinners.map((w) => w.name).join(', ')
      const lowNames = lowWinners.map((w) => w.name).join(', ')
      lines.push(
        `${layer.amount} → High: ${highNames}${best ? ` (${handLabel(best)})` : ''} · Low: ${lowNames}${bestHiLoLow ? ` (${hiLoLowHandLabel(bestHiLoLow)})` : ''}`,
      )
    }
    this.pot = 0
    this.lastSummary = lines.join(' · ')
    this.phase = 'handSummary'
    this.actionIndex = null
    this.message = 'Showdown.'
    this.rotateDealer()

    const humanPotShare = (human?.stack ?? 0) - humanStackBefore
    this.applySessionHandEnd({
      potSize,
      humanPotShare,
      endStreet: 7,
      humanFolded,
      humanTotalCards,
      humanParticipatedInShowdown,
    })
  }

  private applySessionHandEnd(opts: {
    potSize: number
    humanPotShare: number
    endStreet: 3 | 4 | 5 | 6 | 7
    humanFolded: boolean
    humanTotalCards: number
    humanParticipatedInShowdown: boolean
  }): void {
    this.sessionStats.handsPlayed += 1
    if (opts.humanFolded) this.sessionStats.handsFolded += 1

    if (opts.humanPotShare > 0) {
      this.sessionStats.handsWon += 1
      const c = Math.min(7, Math.max(3, opts.humanTotalCards)) as 3 | 4 | 5 | 6 | 7
      this.sessionStats.winsByHeroCardCount[c] += 1
      if (opts.humanTotalCards >= 4) this.sessionStats.winsAfterAtLeastCards[4] += 1
      if (opts.humanTotalCards >= 5) this.sessionStats.winsAfterAtLeastCards[5] += 1
      if (opts.humanTotalCards >= 6) this.sessionStats.winsAfterAtLeastCards[6] += 1
      if (opts.humanTotalCards >= 7) this.sessionStats.winsAfterAtLeastCards[7] += 1
      this.sessionStats.biggestPotShareWon = Math.max(
        this.sessionStats.biggestPotShareWon,
        opts.humanPotShare,
      )
      this.sessionStats.biggestFullPotWhenWon = Math.max(
        this.sessionStats.biggestFullPotWhenWon,
        opts.potSize,
      )
      this.sessionStats.totalChipsWonFromPots += opts.humanPotShare
    }

    if (opts.humanParticipatedInShowdown) {
      this.sessionStats.showdownsContested += 1
      if (opts.humanPotShare > 0) this.sessionStats.showdownsWon += 1
    }
  }

  legalHumanActions(): HumanAction['type'][] {
    if (!this.snapshot().humanMustAct) return []
    return this.legalActionTypesForSeat(this.actionIndex!)
  }

  /** Full increment raise; short-stack can still raise all-in via `canShortAllInRaise`. */
  private canFullRaise(i: number): boolean {
    const p = this.players[i]
    if (this.raisesThisStreet >= MAX_RAISES_PER_STREET) return false
    const rc = this.raiseCost(p)
    return rc > 0 && p.stack >= rc
  }

  /**
   * All-in for less than a full bet/raise (still puts full stack in when calling,
   * or raises to streetCommit+stack when that exceeds current high bet).
   */
  private canShortAllInRaise(i: number): boolean {
    const p = this.players[i]
    if (this.raisesThisStreet >= MAX_RAISES_PER_STREET) return false
    if (p.stack <= 0) return false
    const toCall = Math.max(0, this.highBet - p.streetCommit)
    if (this.checkRound && this.highBet === 0) {
      return p.stack > 0
    }
    if (toCall > 0 && p.stack < toCall) return false
    return p.streetCommit + p.stack > this.highBet
  }

  /** Legal actions for a seat (same rules as the human UI). */
  private legalActionTypesForSeat(i: number): HumanAction['type'][] {
    if (this.phase === 'draw') {
      const p = this.players[i]
      if (p.folded || p.allIn || !this.drawPending.has(i)) return []
      return ['draw']
    }
    const p = this.players[i]
    const toCall = Math.max(0, this.highBet - p.streetCommit)
    const canRaise = this.canFullRaise(i) || this.canShortAllInRaise(i)
    /* No fold when you can check for free — folding is never better than checking. */
    if (this.checkRound && this.highBet === 0) {
      const out: HumanAction['type'][] = ['check']
      if (canRaise) out.push('raise')
      return out
    }
    if (toCall === 0) {
      const out: HumanAction['type'][] = ['check']
      if (canRaise) out.push('raise')
      return out
    }
    const out: HumanAction['type'][] = ['fold', 'call']
    if (canRaise) out.push('raise')
    return out
  }

  /** Map an AI choice to a legal action so we never stall the betting round. */
  private clampAiAction(seat: number, want: HumanAction): HumanAction {
    const legal = this.legalActionTypesForSeat(seat)
    if (legal.includes(want.type)) return want
    if (want.type === 'fold' && legal.includes('check')) return { type: 'check' }
    if (legal.includes('call')) return { type: 'call' }
    if (legal.includes('check')) return { type: 'check' }
    if (legal.includes('raise')) return { type: 'raise' }
    return { type: 'fold' }
  }

  applyHuman(a: HumanAction): void {
    if (!this.snapshot().humanMustAct) return
    this.applyAction(this.actionIndex!, a)
  }

  /**
   * If it is a bot's turn, pick and apply one action. Used by the UI with a delay
   * between steps so the player can follow the action.
   */
  stepAiOnce(): boolean {
    if ((this.phase !== 'betting' && this.phase !== 'draw') || this.actionIndex === null) return false
    const p = this.players[this.actionIndex]
    if (p.isHuman) return false
    if (this.phase === 'draw') {
      this.applyAction(this.actionIndex, { type: 'draw', count: this.pickAiDrawCount(this.actionIndex) })
      return true
    }
    const ctx = this.buildAiContext(this.actionIndex)
    const choice = pickAiAction(ctx)
    const mappedRaw: HumanAction =
      choice === 'check'
        ? { type: 'check' }
        : choice === 'call'
          ? { type: 'call' }
          : choice === 'raise'
            ? { type: 'raise' }
            : { type: 'fold' }
    const mapped = this.clampAiAction(this.actionIndex, mappedRaw)
    this.applyAction(this.actionIndex, mapped)
    return true
  }

  /**
   * Resolve the rest of the hand immediately (no delay between bot steps).
   * Call when the human has folded and does not want to watch the table.
   */
  fastForwardHand(): void {
    const maxSteps = 4000
    let n = 0
    while ((this.phase === 'betting' || this.phase === 'draw') && this.actionIndex !== null && n < maxSteps) {
      n += 1
      const p = this.players[this.actionIndex]
      if (p.isHuman) break
      this.stepAiOnce()
    }
  }

  private drawRandomCards(i: number, count: number): void {
    const p = this.players[i]
    const n = Math.max(0, Math.min(count, p.hole.length))
    for (let k = 0; k < n; k++) {
      if (p.hole.length === 0 || this.deck.length === 0) break
      const idx = Math.floor(this.rng() * p.hole.length)
      p.hole.splice(idx, 1)
      p.hole.push(this.deck.pop()!)
    }
  }

  private drawSpecificCards(i: number, discardIndices: number[]): void {
    const p = this.players[i]
    if (p.hole.length === 0) return
    const uniqSortedDesc = [...new Set(discardIndices)]
      .filter((x) => Number.isInteger(x) && x >= 0 && x < p.hole.length)
      .sort((a, b) => b - a)
    for (const idx of uniqSortedDesc) {
      if (this.deck.length === 0) break
      p.hole.splice(idx, 1)
      p.hole.push(this.deck.pop()!)
    }
  }

  private pickAiDrawCount(i: number): number {
    const p = this.players[i]
    if (this.gameKind === 'badugi') {
      const s = bestBadugiScore(p.hole)
      if (!s) return 2
      const made = s[0]
      if (made >= 4) return 0
      if (made === 3) return 1
      return 2
    }
    if (this.gameKind === 'deuce7') {
      const s = bestDeuceToSevenLowScore(p.hole)
      if (!s) return 2
      const rough = s[0] + s[1]
      if (rough === 0 && s[2] <= 9) return 0
      if (rough <= 1) return 1
      return 2
    }
    return 0
  }

  private buildAiContext(i: number): AiContext {
    const p = this.players[i]
    const toCall =
      this.checkRound && this.highBet === 0
        ? 0
        : Math.max(0, this.highBet - p.streetCommit)
    const rc = this.raiseCost(p)
    const canCheck = toCall === 0
    const canRaise = this.canFullRaise(i) || this.canShortAllInRaise(i)
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
    /* Keep iterations modest so mobile UI stays responsive during stepAiOnce. */
    const mcIters =
      this.settings.difficulty === 'easy'
        ? 140
        : this.settings.difficulty === 'medium'
          ? 190
          : 320
    const playersForEquity = this.players.map((pl) => ({
      hole: pl.hole,
      up: pl.up,
      folded: pl.folded,
    }))
    const showdownEquity =
      this.gameKind === 'stud'
        ? estimateStudShowdownEquity(playersForEquity, i, pool, mcIters, this.rng)
        : this.gameKind === 'razz'
          ? estimateRazzShowdownEquity(playersForEquity, i, pool, mcIters, this.rng)
          : this.gameKind === 'studhilo'
            ? estimateStudHiLoShowdownEquity(playersForEquity, i, pool, mcIters, this.rng)
            : 0.5

    const aliveInBettingOrbit = this.players.filter(
      (pl) => !pl.folded && !pl.allIn,
    ).length
    const checksBeforeMe =
      this.checkRound && this.highBet === 0
        ? aliveInBettingOrbit - this.checkPending.size
        : 0

    const maxCommit = p.streetCommit + p.stack
    let raiseIncrement = 0
    if (canRaise) {
      raiseIncrement = this.canFullRaise(i)
        ? rc
        : Math.max(0, maxCommit - this.highBet)
    }

    return {
      gameKind: this.gameKind,
      difficulty: this.settings.difficulty,
      hole: p.hole,
      up: p.up,
      toCall,
      pot: this.pot,
      raiseIncrement,
      canCheck,
      canRaise,
      stack: p.stack,
      street: this.street,
      activeOpponents,
      headsUp: activeOpponents === 1,
      raisesThisStreet: this.raisesThisStreet,
      humanIsLastAggressor,
      showdownEquity,
      checksBeforeMe,
    }
  }

  private normalizeAllInFromStack(): void {
    for (const p of this.players) {
      if (!p.folded && p.stack <= 0) {
        p.stack = 0
        p.allIn = true
      }
    }
  }

  private applyAction(i: number, a: HumanAction): void {
    this.normalizeAllInFromStack()
    const p = this.players[i]
    if (this.phase === 'draw') {
      if (a.type !== 'draw') return
      const maxDraw = this.gameKind === 'badugi' ? 4 : 5
      const explicit =
        this.players[i].isHuman &&
        Array.isArray(a.discardIndices) &&
        a.discardIndices.length > 0
          ? [...new Set(a.discardIndices)]
          : null
      if (explicit) {
        this.drawSpecificCards(i, explicit.slice(0, maxDraw))
      } else {
        const count = Math.max(0, Math.min(maxDraw, Math.floor(a.count)))
        this.drawRandomCards(i, count)
      }
      this.drawPending.delete(i)
      this.actionIndex = this.nextDrawActorFrom(seatLeftOf(i, this.players.length))
      if (this.actionIndex === null) this.finishDrawRound()
      return
    }
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
      if (pay > 0) this.emitBettingSound('chips')
      this.afterAction(i)
      return
    }

    if (a.type === 'raise') {
      if (this.raisesThisStreet >= MAX_RAISES_PER_STREET) return
      if (this.checkRound && this.highBet === 0) {
        this.checkRound = false
        this.checkPending.clear()
      }
      const openingAggression = this.raisesThisStreet === 0
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
          this.emitBettingSound(openingAggression ? 'chips' : 'raise')
        } else if (pay > 0) {
          this.emitBettingSound('chips')
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
      this.emitBettingSound(openingAggression ? 'chips' : 'raise')
      this.afterAction(i)
    }
  }

  private afterAction(fromSeat: number): void {
    this.normalizeAllInFromStack()
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

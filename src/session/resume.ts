import {
  StudEngine,
  type EffectiveStakes,
  type HandReview,
  type HandReviewPlayer,
  type PersistedEngineState,
  type SessionPhase,
  type SessionStats,
  type StudStreet,
  type TablePlayer,
} from '../game/studEngine'
import type { Card, Rank, Suit } from '../game/cards'
import type { Difficulty, GameKind, GameSettings, StakesTier, TempoPreset } from '../settings/types'
import { GAME_ORDER } from '../stats/career'

const STORAGE_KEY = 'cardroom-active-session-v1'

/** Last session written from this page, so a hide event can flush it. */
let remembered: SavedSession | null = null

const RANKS = new Set<Rank>(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'])
const SUITS = new Set<Suit>(['c', 'd', 'h', 's'])
const PHASES = new Set<SessionPhase>([
  'betweenHands',
  'betting',
  'draw',
  'showdown',
  'handSummary',
  'youWonTable',
  'youBusted',
])
const STREETS = new Set<StudStreet>([3, 4, 5, 6, 7])
const GAME_KINDS = new Set<GameKind>(GAME_ORDER)

export interface SessionStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SavedSession {
  version: 1
  sessionId: number
  gameKind: GameKind
  challenge: { index: number } | null
  /** True once this sitting has been written into career stats. */
  careerRecorded: boolean
  engine: PersistedEngineState
}

export interface RestoredTable {
  sessionId: number
  gameKind: GameKind
  engine: StudEngine
  challenge: { index: number } | null
  careerRecorded: boolean
}

function defaultStore(): SessionStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isNonNegativeInt(value: unknown): value is number {
  return isNonNegative(value) && Number.isInteger(value)
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value)) return false
  return RANKS.has(value.rank as Rank) && SUITS.has(value.suit as Suit)
}

function readCards(value: unknown): Card[] | null {
  if (!Array.isArray(value) || !value.every(isCard)) return null
  return value.map((c) => ({ rank: c.rank, suit: c.suit }))
}

function cardKey(c: Card): string {
  return `${c.rank}${c.suit}`
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 'easy' || value === 'medium' || value === 'hard'
}

function isTempo(value: unknown): value is TempoPreset {
  return value === 'slow' || value === 'medium' || value === 'fast'
}

function isStakesTier(value: unknown): value is StakesTier {
  return value === 'low' || value === 'mid' || value === 'high'
}

function readSettings(value: unknown): GameSettings | null {
  if (!isRecord(value)) return null
  if (!isNonNegativeInt(value.opponentCount) || value.opponentCount < 1 || value.opponentCount > 6) {
    return null
  }
  if (!isDifficulty(value.difficulty) || !isTempo(value.tempoPreset)) return null
  if (typeof value.useAdvancedTempo !== 'boolean') return null
  if (!isNonNegativeInt(value.handsPerLevel) || value.handsPerLevel < 1 || value.handsPerLevel > 99) {
    return null
  }
  if (!isStakesTier(value.stakes) || !isNonNegativeInt(value.startingStack)) return null
  return {
    opponentCount: value.opponentCount,
    difficulty: value.difficulty,
    tempoPreset: value.tempoPreset,
    handsPerLevel: value.handsPerLevel,
    useAdvancedTempo: value.useAdvancedTempo,
    stakes: value.stakes,
    startingStack: value.startingStack,
  }
}

function readStakes(value: unknown): EffectiveStakes | null {
  if (!isRecord(value)) return null
  if (
    !isNonNegative(value.ante) ||
    !isNonNegative(value.smallBet) ||
    !isNonNegative(value.bigBet) ||
    !isNonNegative(value.bringIn)
  ) {
    return null
  }
  return {
    ante: value.ante,
    smallBet: value.smallBet,
    bigBet: value.bigBet,
    bringIn: value.bringIn,
  }
}

function readSessionStats(value: unknown): SessionStats | null {
  if (!isRecord(value) || !isRecord(value.foldsByStreet)) return null
  const folds = value.foldsByStreet
  if (
    !isNonNegativeInt(value.handsPlayed) ||
    !isNonNegativeInt(value.handsWon) ||
    !isNonNegativeInt(value.handsFolded) ||
    !isNonNegativeInt(value.winsFromFourthStreetToLast) ||
    !isNonNegative(value.totalChipsWonFromPots) ||
    !isNonNegativeInt(folds[3]) ||
    !isNonNegativeInt(folds[4]) ||
    !isNonNegativeInt(folds[5]) ||
    !isNonNegativeInt(folds[6]) ||
    !isNonNegativeInt(folds[7])
  ) {
    return null
  }
  return {
    handsPlayed: value.handsPlayed,
    handsWon: value.handsWon,
    handsFolded: value.handsFolded,
    foldsByStreet: {
      3: folds[3] as number,
      4: folds[4] as number,
      5: folds[5] as number,
      6: folds[6] as number,
      7: folds[7] as number,
    },
    winsFromFourthStreetToLast: value.winsFromFourthStreetToLast,
    totalChipsWonFromPots: value.totalChipsWonFromPots,
  }
}

function readPlayer(value: unknown): TablePlayer | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.name !== 'string') return null
  if (typeof value.isHuman !== 'boolean' || typeof value.folded !== 'boolean') return null
  if (typeof value.allIn !== 'boolean') return null
  if (!isNonNegative(value.stack) || !isNonNegative(value.contributedPot) || !isNonNegative(value.streetCommit)) {
    return null
  }
  const hole = readCards(value.hole)
  const up = readCards(value.up)
  if (!hole || !up) return null
  return {
    id: value.id,
    isHuman: value.isHuman,
    name: value.name,
    stack: value.stack,
    folded: value.folded,
    hole,
    up,
    contributedPot: value.contributedPot,
    streetCommit: value.streetCommit,
    allIn: value.allIn,
  }
}

function readHandReview(value: unknown): HandReview | null {
  if (!isRecord(value)) return null
  if (!isNonNegativeInt(value.handNumber) || typeof value.summary !== 'string') return null
  if (typeof value.dealerId !== 'string' || !Array.isArray(value.winningLines)) return null
  if (!value.winningLines.every((line) => typeof line === 'string')) return null
  if (!Array.isArray(value.players)) return null
  const players: HandReviewPlayer[] = []
  for (const raw of value.players) {
    if (!isRecord(raw)) return null
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
    if (typeof raw.isHuman !== 'boolean' || typeof raw.folded !== 'boolean') return null
    if (!isNonNegative(raw.stack) || !isFiniteNumber(raw.net)) return null
    if (raw.handText !== null && typeof raw.handText !== 'string') return null
    const hole = readCards(raw.hole)
    const up = readCards(raw.up)
    if (!hole || !up) return null
    players.push({
      id: raw.id,
      name: raw.name,
      isHuman: raw.isHuman,
      folded: raw.folded,
      hole,
      up,
      stack: raw.stack,
      net: raw.net,
      handText: raw.handText,
    })
  }
  return {
    handNumber: value.handNumber,
    summary: value.summary,
    dealerId: value.dealerId,
    winningLines: [...value.winningLines],
    players,
  }
}

function readSeatList(value: unknown, playerCount: number): number[] | null {
  if (!Array.isArray(value)) return null
  const seats: number[] = []
  for (const seat of value) {
    if (!isNonNegativeInt(seat) || seat >= playerCount || seats.includes(seat)) return null
    seats.push(seat)
  }
  return seats
}

function readEngine(value: unknown): PersistedEngineState | null {
  if (!isRecord(value)) return null
  const settings = readSettings(value.settings)
  const stakes = readStakes(value.stakes)
  const sessionStats = readSessionStats(value.sessionStats)
  if (!settings || !stakes || !sessionStats) return null
  if (!GAME_KINDS.has(value.gameKind as GameKind)) return null
  if (!Array.isArray(value.players) || value.players.length < 1 || value.players.length > 7) return null
  const players: TablePlayer[] = []
  for (const raw of value.players) {
    const player = readPlayer(raw)
    if (!player) return null
    players.push(player)
  }
  if (players.filter((p) => p.isHuman).length !== 1) return null
  const ids = new Set(players.map((p) => p.id))
  if (ids.size !== players.length) return null

  const deck = readCards(value.deck)
  if (!deck) return null
  const seen = new Set<string>()
  for (const card of deck) {
    const key = cardKey(card)
    if (seen.has(key)) return null
    seen.add(key)
  }
  for (const player of players) {
    for (const card of [...player.hole, ...player.up]) {
      const key = cardKey(card)
      if (seen.has(key)) return null
      seen.add(key)
    }
  }

  const n = players.length
  if (!isNonNegativeInt(value.dealerIndex) || value.dealerIndex >= n) return null
  if (value.bringInIndex !== null && (!isNonNegativeInt(value.bringInIndex) || value.bringInIndex >= n)) {
    return null
  }
  if (value.actionIndex !== null && (!isNonNegativeInt(value.actionIndex) || value.actionIndex >= n)) {
    return null
  }
  if (
    value.lastAggressorSeat !== null &&
    (!isNonNegativeInt(value.lastAggressorSeat) || value.lastAggressorSeat >= n)
  ) {
    return null
  }
  if (!PHASES.has(value.phase as SessionPhase)) return null
  if (!STREETS.has(value.street as StudStreet)) return null
  if (!isNonNegative(value.pot) || !isNonNegativeInt(value.raisesThisStreet)) return null
  if (!isNonNegativeInt(value.level) || !isNonNegativeInt(value.handNumber)) return null
  if (typeof value.message !== 'string') return null
  if (value.lastSummary !== null && typeof value.lastSummary !== 'string') return null
  if (!isNonNegative(value.sessionStartStack) || !isNonNegative(value.highBet)) return null
  if (typeof value.checkRound !== 'boolean') return null
  if (!isNonNegativeInt(value.bettingSoundNonce)) return null
  if (value.lastBettingSound !== null && value.lastBettingSound !== 'chips' && value.lastBettingSound !== 'raise') {
    return null
  }
  if (!isNonNegativeInt(value.drawRound)) return null
  const checkPending = readSeatList(value.checkPending, n)
  const drawPending = readSeatList(value.drawPending, n)
  if (!checkPending || !drawPending) return null
  if (!Array.isArray(value.lastWinningLines) || !value.lastWinningLines.every((line) => typeof line === 'string')) {
    return null
  }
  if (!Array.isArray(value.stackAtHandStart)) return null
  const stackAtHandStart: [string, number][] = []
  for (const entry of value.stackAtHandStart) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const [id, stack] = entry
    if (typeof id !== 'string' || !ids.has(id) || !isNonNegative(stack)) return null
    stackAtHandStart.push([id, stack])
  }
  const lastHand = value.lastHand == null ? null : readHandReview(value.lastHand)
  if (value.lastHand != null && !lastHand) return null

  return {
    settings,
    gameKind: value.gameKind as GameKind,
    players,
    dealerIndex: value.dealerIndex,
    deck,
    pot: value.pot,
    street: value.street as StudStreet,
    bringInIndex: value.bringInIndex as number | null,
    actionIndex: value.actionIndex as number | null,
    phase: value.phase as SessionPhase,
    raisesThisStreet: value.raisesThisStreet,
    level: value.level,
    handNumber: value.handNumber,
    message: value.message,
    lastSummary: value.lastSummary as string | null,
    sessionStartStack: value.sessionStartStack,
    sessionStats,
    highBet: value.highBet,
    checkRound: value.checkRound,
    checkPending,
    lastAggressorSeat: value.lastAggressorSeat as number | null,
    bettingSoundNonce: value.bettingSoundNonce,
    lastBettingSound: value.lastBettingSound as 'chips' | 'raise' | null,
    drawRound: value.drawRound,
    drawPending,
    stackAtHandStart,
    lastHand,
    lastWinningLines: [...value.lastWinningLines],
    stakes,
  }
}

function readChallenge(value: unknown): { index: number } | null | undefined {
  if (value == null) return null
  if (!isRecord(value) || !isNonNegativeInt(value.index)) return undefined
  if (value.index >= GAME_ORDER.length) return undefined
  return { index: value.index }
}

export function parseSavedSession(raw: string): SavedSession | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1) return null
    if (!isNonNegativeInt(value.sessionId) || value.sessionId < 1) return null
    if (!GAME_KINDS.has(value.gameKind as GameKind)) return null
    if (typeof value.careerRecorded !== 'boolean') return null
    const challenge = readChallenge(value.challenge)
    if (challenge === undefined) return null
    const engine = readEngine(value.engine)
    if (!engine || engine.gameKind !== value.gameKind) return null
    return {
      version: 1,
      sessionId: value.sessionId,
      gameKind: value.gameKind as GameKind,
      challenge,
      careerRecorded: value.careerRecorded,
      engine,
    }
  } catch {
    return null
  }
}

export function sessionFromActive(game: {
  sessionId: number
  gameKind: GameKind
  challenge: { index: number } | null
  careerRecorded: boolean
  engine: StudEngine
}): SavedSession {
  return {
    version: 1,
    sessionId: game.sessionId,
    gameKind: game.engine.gameKind,
    challenge: game.challenge,
    careerRecorded: game.careerRecorded,
    engine: game.engine.toPersistable(),
  }
}

export function saveActiveSession(session: SavedSession, store?: SessionStore | null): void {
  const target = store === undefined ? defaultStore() : store
  if (store === undefined) remembered = session
  if (!target) return
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* Private mode and quota failures should not stop the hand. */
  }
}

/** Session most recently saved in this page, if any. */
export function peekActiveSession(): SavedSession | null {
  return remembered
}

export function loadActiveSession(store: SessionStore | null = defaultStore()): SavedSession | null {
  if (!store) return null
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseSavedSession(raw)
  } catch {
    return null
  }
}

export function clearActiveSession(store?: SessionStore | null): void {
  const target = store === undefined ? defaultStore() : store
  if (store === undefined) remembered = null
  if (!target) return
  try {
    target.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Load the in-progress table, or null when nothing resumable is stored. */
export function restoreActiveTable(store: SessionStore | null = defaultStore()): RestoredTable | null {
  const saved = loadActiveSession(store)
  if (!saved) return null
  try {
    const engine = StudEngine.restore(saved.engine)
    if (engine.snapshot().phase === 'betweenHands') engine.beginHand()
    return {
      sessionId: saved.sessionId,
      gameKind: saved.gameKind,
      engine,
      challenge: saved.challenge,
      careerRecorded: saved.careerRecorded,
    }
  } catch {
    clearActiveSession(store)
    return null
  }
}

import { emptyFoldsByStreet, type SessionStats, type StudStreet } from '../game/studEngine'
import type { GameKind } from '../settings/types'

export const GAME_ORDER: GameKind[] = ['stud', 'razz', 'studhilo', 'badugi', 'deuce7']

const STORAGE_KEY = 'cardroom-career-stats-v2'
/** Previous career blobs. Removed on load so saved play history starts over once. */
const RETIRED_STORAGE_KEYS = ['cardroom-career-stats-v1']

export interface GameRecord {
  gamesPlayed: number
  gamesWon: number
  gamesLost: number
  handsPlayed: number
  handsWon: number
  handsFolded: number
  foldsByStreet: Record<StudStreet, number>
  winsFromFourthStreetToLast: number
  totalChipsWonFromPots: number
  /** Sum of (ending stack − starting stack) across finished games. */
  netChips: number
}

export interface CareerStats {
  byGame: Record<GameKind, GameRecord>
  challengeCompleted: number
  challengeFailed: number
}

export function emptyGameRecord(): GameRecord {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    handsPlayed: 0,
    handsWon: 0,
    handsFolded: 0,
    foldsByStreet: emptyFoldsByStreet(),
    winsFromFourthStreetToLast: 0,
    totalChipsWonFromPots: 0,
    netChips: 0,
  }
}

export function emptyCareerStats(): CareerStats {
  return {
    byGame: {
      stud: emptyGameRecord(),
      razz: emptyGameRecord(),
      studhilo: emptyGameRecord(),
      badugi: emptyGameRecord(),
      deuce7: emptyGameRecord(),
    },
    challengeCompleted: 0,
    challengeFailed: 0,
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function chips(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
}

function foldsFrom(value: unknown): Record<StudStreet, number> {
  const base = emptyFoldsByStreet()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<Record<StudStreet, unknown>>
  for (const street of [3, 4, 5, 6, 7] as const) {
    base[street] = count(raw[street])
  }
  return base
}

function recordFrom(value: unknown): GameRecord {
  if (!value || typeof value !== 'object') return emptyGameRecord()
  const raw = value as Partial<GameRecord>
  return {
    gamesPlayed: count(raw.gamesPlayed),
    gamesWon: count(raw.gamesWon),
    gamesLost: count(raw.gamesLost),
    handsPlayed: count(raw.handsPlayed),
    handsWon: count(raw.handsWon),
    handsFolded: count(raw.handsFolded),
    foldsByStreet: foldsFrom(raw.foldsByStreet),
    winsFromFourthStreetToLast: count(raw.winsFromFourthStreetToLast),
    totalChipsWonFromPots: count(raw.totalChipsWonFromPots),
    netChips: chips(raw.netChips),
  }
}

function discardRetiredCareerStats(): void {
  for (const key of RETIRED_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
}

export function loadCareerStats(): CareerStats {
  try {
    discardRetiredCareerStats()
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyCareerStats()
    const parsed = JSON.parse(raw) as Partial<CareerStats>
    const byGame = emptyCareerStats().byGame
    const stored = parsed.byGame
    if (stored && typeof stored === 'object') {
      for (const kind of GAME_ORDER) {
        byGame[kind] = recordFrom(stored[kind])
      }
    }
    return {
      byGame,
      challengeCompleted: count(parsed.challengeCompleted),
      challengeFailed: count(parsed.challengeFailed),
    }
  } catch {
    return emptyCareerStats()
  }
}

export function saveCareerStats(stats: CareerStats): void {
  discardRetiredCareerStats()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
}

export function mergeFinishedGame(
  career: CareerStats,
  gameKind: GameKind,
  session: SessionStats,
  outcome: 'won' | 'lost',
  netChips: number,
  challenge: 'completed' | 'failed' | null,
): CareerStats {
  const prev = career.byGame[gameKind]
  const folds = emptyFoldsByStreet()
  for (const street of [3, 4, 5, 6, 7] as const) {
    folds[street] = prev.foldsByStreet[street] + session.foldsByStreet[street]
  }
  return {
    challengeCompleted: career.challengeCompleted + (challenge === 'completed' ? 1 : 0),
    challengeFailed: career.challengeFailed + (challenge === 'failed' ? 1 : 0),
    byGame: {
      ...career.byGame,
      [gameKind]: {
        gamesPlayed: prev.gamesPlayed + 1,
        gamesWon: prev.gamesWon + (outcome === 'won' ? 1 : 0),
        gamesLost: prev.gamesLost + (outcome === 'lost' ? 1 : 0),
        handsPlayed: prev.handsPlayed + session.handsPlayed,
        handsWon: prev.handsWon + session.handsWon,
        handsFolded: prev.handsFolded + session.handsFolded,
        foldsByStreet: folds,
        winsFromFourthStreetToLast:
          prev.winsFromFourthStreetToLast + session.winsFromFourthStreetToLast,
        totalChipsWonFromPots: prev.totalChipsWonFromPots + session.totalChipsWonFromPots,
        netChips: prev.netChips + netChips,
      },
    },
  }
}

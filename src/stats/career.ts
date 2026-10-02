import { GAME_ORDER, type GameKind } from '../settings/types'
import type { SessionStats } from '../game/studEngine'

const STORAGE_KEY = 'cardroom-career-stats-v1'
const ID_HISTORY_LIMIT = 40

export interface CareerStats {
  handsPlayed: number
  handsWon: number
  handsFolded: number
  winsByHeroCardCount: Record<3 | 4 | 5 | 6 | 7, number>
  winsAfterAtLeastCards: Record<4 | 5 | 6 | 7, number>
  biggestPotShareWon: number
  biggestFullPotWhenWon: number
  totalChipsWonFromPots: number
  showdownsContested: number
  showdownsWon: number
  tablesWon: number
  tablesLost: number
  tablesWonByGame: Record<GameKind, number>
  tablesLostByGame: Record<GameKind, number>
  challengesWon: number
  challengesAttempted: number
  /** Last flushed hand totals for the open session, so a refresh cannot double-count. */
  sessionProgress: Record<string, SessionStats>
  recordedTableSessions: string[]
  concludedChallengeIds: string[]
}

function emptyByGame(): Record<GameKind, number> {
  return { stud: 0, razz: 0, studhilo: 0, badugi: 0, deuce7: 0 }
}

export function emptyCareerStats(): CareerStats {
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
    tablesWon: 0,
    tablesLost: 0,
    tablesWonByGame: emptyByGame(),
    tablesLostByGame: emptyByGame(),
    challengesWon: 0,
    challengesAttempted: 0,
    sessionProgress: {},
    recordedTableSessions: [],
    concludedChallengeIds: [],
  }
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

function handTally(raw: Partial<SessionStats> | undefined): SessionStats {
  const byCount = raw?.winsByHeroCardCount
  const stayed = raw?.winsAfterAtLeastCards
  return {
    handsPlayed: nonNegInt(raw?.handsPlayed),
    handsWon: nonNegInt(raw?.handsWon),
    handsFolded: nonNegInt(raw?.handsFolded),
    winsByHeroCardCount: {
      3: nonNegInt(byCount?.[3]),
      4: nonNegInt(byCount?.[4]),
      5: nonNegInt(byCount?.[5]),
      6: nonNegInt(byCount?.[6]),
      7: nonNegInt(byCount?.[7]),
    },
    winsAfterAtLeastCards: {
      4: nonNegInt(stayed?.[4]),
      5: nonNegInt(stayed?.[5]),
      6: nonNegInt(stayed?.[6]),
      7: nonNegInt(stayed?.[7]),
    },
    biggestPotShareWon: nonNegInt(raw?.biggestPotShareWon),
    biggestFullPotWhenWon: nonNegInt(raw?.biggestFullPotWhenWon),
    totalChipsWonFromPots: nonNegInt(raw?.totalChipsWonFromPots),
    showdownsContested: nonNegInt(raw?.showdownsContested),
    showdownsWon: nonNegInt(raw?.showdownsWon),
  }
}

function gameMap(raw: Partial<Record<GameKind, number>> | undefined): Record<GameKind, number> {
  const out = emptyByGame()
  for (const game of GAME_ORDER) out[game] = nonNegInt(raw?.[game])
  return out
}

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(-ID_HISTORY_LIMIT)
}

function rememberId(ids: string[], id: string): string[] {
  return [...ids.filter((existing) => existing !== id), id].slice(-ID_HISTORY_LIMIT)
}

function grew(next: number, prev: number): number {
  return Math.max(0, next - prev)
}

/** In-tab copy so a failed write cannot make the next hand count twice. */
let memory: CareerStats | null = null

function cloneCareer(s: CareerStats): CareerStats {
  const sessionProgress: Record<string, SessionStats> = {}
  for (const [id, tally] of Object.entries(s.sessionProgress)) {
    sessionProgress[id] = handTally(tally)
  }
  return {
    ...s,
    winsByHeroCardCount: { ...s.winsByHeroCardCount },
    winsAfterAtLeastCards: { ...s.winsAfterAtLeastCards },
    tablesWonByGame: { ...s.tablesWonByGame },
    tablesLostByGame: { ...s.tablesLostByGame },
    sessionProgress,
    recordedTableSessions: [...s.recordedTableSessions],
    concludedChallengeIds: [...s.concludedChallengeIds],
  }
}

function readStoredCareer(): CareerStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyCareerStats()
    const p = JSON.parse(raw) as Partial<CareerStats>
    const progress: Record<string, SessionStats> = {}
    if (p.sessionProgress && typeof p.sessionProgress === 'object') {
      for (const [id, tally] of Object.entries(p.sessionProgress)) {
        if (id) progress[id] = handTally(tally)
      }
    }
    return {
      ...handTally(p),
      tablesWon: nonNegInt(p.tablesWon),
      tablesLost: nonNegInt(p.tablesLost),
      tablesWonByGame: gameMap(p.tablesWonByGame),
      tablesLostByGame: gameMap(p.tablesLostByGame),
      challengesWon: nonNegInt(p.challengesWon),
      challengesAttempted: nonNegInt(p.challengesAttempted),
      sessionProgress: progress,
      recordedTableSessions: idList(p.recordedTableSessions),
      concludedChallengeIds: idList(p.concludedChallengeIds),
    }
  } catch {
    return emptyCareerStats()
  }
}

export function loadCareerStats(): CareerStats {
  if (!memory) memory = readStoredCareer()
  return cloneCareer(memory)
}

export function saveCareerStats(next: CareerStats): void {
  memory = cloneCareer(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    /* Private mode or a full disk: keep the in-tab totals for this visit. */
  }
}

/** Add newly finished hands from one sitting. Repeating the same snapshot is a no-op. */
export function recordHandProgress(sessionId: string, stats: SessionStats): void {
  const career = loadCareerStats()
  const prev = career.sessionProgress[sessionId] ?? handTally(undefined)
  if (
    prev.handsPlayed === stats.handsPlayed &&
    prev.handsWon === stats.handsWon &&
    prev.handsFolded === stats.handsFolded &&
    prev.totalChipsWonFromPots === stats.totalChipsWonFromPots &&
    prev.showdownsContested === stats.showdownsContested
  ) {
    return
  }
  const addCount = (key: 3 | 4 | 5 | 6 | 7) =>
    career.winsByHeroCardCount[key] + grew(stats.winsByHeroCardCount[key], prev.winsByHeroCardCount[key])
  const addStayed = (key: 4 | 5 | 6 | 7) =>
    career.winsAfterAtLeastCards[key] + grew(stats.winsAfterAtLeastCards[key], prev.winsAfterAtLeastCards[key])
  saveCareerStats({
    ...career,
    handsPlayed: career.handsPlayed + grew(stats.handsPlayed, prev.handsPlayed),
    handsWon: career.handsWon + grew(stats.handsWon, prev.handsWon),
    handsFolded: career.handsFolded + grew(stats.handsFolded, prev.handsFolded),
    winsByHeroCardCount: { 3: addCount(3), 4: addCount(4), 5: addCount(5), 6: addCount(6), 7: addCount(7) },
    winsAfterAtLeastCards: { 4: addStayed(4), 5: addStayed(5), 6: addStayed(6), 7: addStayed(7) },
    biggestPotShareWon: Math.max(career.biggestPotShareWon, nonNegInt(stats.biggestPotShareWon)),
    biggestFullPotWhenWon: Math.max(career.biggestFullPotWhenWon, nonNegInt(stats.biggestFullPotWhenWon)),
    totalChipsWonFromPots:
      career.totalChipsWonFromPots + grew(stats.totalChipsWonFromPots, prev.totalChipsWonFromPots),
    showdownsContested:
      career.showdownsContested + grew(stats.showdownsContested, prev.showdownsContested),
    showdownsWon: career.showdownsWon + grew(stats.showdownsWon, prev.showdownsWon),
    sessionProgress: { [sessionId]: handTally(stats) },
  })
}

/** One table result per sitting: you cleared the table, or you busted. */
export function recordTableResult(sessionId: string, game: GameKind, won: boolean): void {
  const career = loadCareerStats()
  if (career.recordedTableSessions.includes(sessionId)) return
  const wonByGame = { ...career.tablesWonByGame }
  const lostByGame = { ...career.tablesLostByGame }
  if (won) wonByGame[game] += 1
  else lostByGame[game] += 1
  saveCareerStats({
    ...career,
    tablesWon: career.tablesWon + (won ? 1 : 0),
    tablesLost: career.tablesLost + (won ? 0 : 1),
    tablesWonByGame: wonByGame,
    tablesLostByGame: lostByGame,
    recordedTableSessions: rememberId(career.recordedTableSessions, sessionId),
  })
}

/**
 * A challenge is won only by taking all five games in a row.
 * Busting or quitting ends the attempt without a win. Safe to call twice.
 */
export function concludeChallenge(challengeId: string, won: boolean): void {
  const career = loadCareerStats()
  if (career.concludedChallengeIds.includes(challengeId)) return
  saveCareerStats({
    ...career,
    challengesAttempted: career.challengesAttempted + 1,
    challengesWon: career.challengesWon + (won ? 1 : 0),
    concludedChallengeIds: rememberId(career.concludedChallengeIds, challengeId),
  })
}

export function careerAsSessionStats(career: CareerStats): SessionStats {
  return handTally(career)
}

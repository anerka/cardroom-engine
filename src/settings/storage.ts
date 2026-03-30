import {
  DEFAULT_SETTINGS,
  MAX_STARTING_STACK,
  MIN_STARTING_STACK,
  STAKES_BY_TIER,
  type GameKind,
  type GameSettings,
  type StakesTier,
} from './types'

const LEGACY_STUD_KEY = 'seven-stud-settings-v1'
const KEY_BY_GAME: Record<GameKind, string> = {
  stud: 'cardroom-settings-stud-v1',
  razz: 'cardroom-settings-razz-v1',
}

function defaultStackForStakes(stakes: StakesTier): number {
  return STAKES_BY_TIER[stakes].startingStack
}

export function loadSettings(game: GameKind): GameSettings {
  try {
    const key = KEY_BY_GAME[game]
    const raw = localStorage.getItem(key)
    if (!raw && game === 'stud') {
      const legacy = localStorage.getItem(LEGACY_STUD_KEY)
      if (legacy) {
        localStorage.setItem(key, legacy)
        localStorage.removeItem(LEGACY_STUD_KEY)
      }
    }
    const fromStore = localStorage.getItem(key)
    if (!fromStore) return { ...DEFAULT_SETTINGS }
    const p = JSON.parse(fromStore) as Partial<GameSettings>
    const stakes = (p.stakes ?? DEFAULT_SETTINGS.stakes) as StakesTier
    const tierDefault = defaultStackForStakes(stakes)
    const rawStack =
      typeof p.startingStack === 'number' ? p.startingStack : tierDefault
    return {
      ...DEFAULT_SETTINGS,
      ...p,
      stakes,
      opponentCount: clamp(
        typeof p.opponentCount === 'number' ? p.opponentCount : DEFAULT_SETTINGS.opponentCount,
        1,
        6,
      ),
      handsPerLevel: clamp(
        typeof p.handsPerLevel === 'number' ? p.handsPerLevel : DEFAULT_SETTINGS.handsPerLevel,
        1,
        99,
      ),
      startingStack: clamp(rawStack, MIN_STARTING_STACK, MAX_STARTING_STACK),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: GameSettings): void {
  saveSettingsForGame('stud', s)
}

export function saveSettingsForGame(game: GameKind, s: GameSettings): void {
  localStorage.setItem(KEY_BY_GAME[game], JSON.stringify(s))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

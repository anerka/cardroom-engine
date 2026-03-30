import {
  DEFAULT_SETTINGS,
  MAX_STARTING_STACK,
  MIN_STARTING_STACK,
  STAKES_BY_TIER,
  type GameSettings,
  type StakesTier,
} from './types'

const KEY = 'seven-stud-settings-v1'

function defaultStackForStakes(stakes: StakesTier): number {
  return STAKES_BY_TIER[stakes].startingStack
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const p = JSON.parse(raw) as Partial<GameSettings>
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
  localStorage.setItem(KEY, JSON.stringify(s))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

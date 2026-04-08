export type StakesTier = 'low' | 'mid' | 'high'
export type GameKind = 'stud' | 'razz' | 'studhilo' | 'badugi' | 'deuce7'

export const GAME_LABELS: Record<GameKind, string> = {
  stud: 'Seven Card Stud',
  razz: 'Razz',
  studhilo: 'Stud Hi/Low',
  badugi: 'Badugi',
  deuce7: '2-7 Triple Draw',
}

/** Minimum user-configurable starting stack per player. */
export const MIN_STARTING_STACK = 100

export const MAX_STARTING_STACK = 9_999_999

export type Difficulty = 'easy' | 'medium' | 'hard'

export type TempoPreset = 'slow' | 'medium' | 'fast'

export interface StakesConfig {
  ante: number
  smallBet: number
  bigBet: number
  bringIn: number
  startingStack: number
}

export const STAKES_BY_TIER: Record<StakesTier, StakesConfig> = {
  low: {
    ante: 5,
    smallBet: 10,
    bigBet: 20,
    bringIn: 5,
    startingStack: 800,
  },
  mid: {
    ante: 10,
    smallBet: 20,
    bigBet: 40,
    bringIn: 10,
    startingStack: 1600,
  },
  high: {
    ante: 25,
    smallBet: 50,
    bigBet: 100,
    bringIn: 25,
    startingStack: 4000,
  },
}

export const TEMPO_HANDS_BY_PRESET: Record<TempoPreset, number> = {
  slow: 12,
  medium: 8,
  fast: 4,
}

export interface GameSettings {
  opponentCount: number
  difficulty: Difficulty
  tempoPreset: TempoPreset
  /** Hands per level-up; overrides preset mapping when useAdvancedTempo is true. */
  handsPerLevel: number
  useAdvancedTempo: boolean
  stakes: StakesTier
  /** Starting chips for every player (you and bots). */
  startingStack: number
}

export interface GlobalSettings {
  soundEnabled: boolean
  useGlobalDifficulty: boolean
  globalDifficulty: Difficulty
}

export const DEFAULT_SETTINGS: GameSettings = {
  opponentCount: 3,
  difficulty: 'medium',
  tempoPreset: 'medium',
  handsPerLevel: 8,
  useAdvancedTempo: false,
  stakes: 'low',
  startingStack: STAKES_BY_TIER.low.startingStack,
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  soundEnabled: true,
  useGlobalDifficulty: false,
  globalDifficulty: 'medium',
}

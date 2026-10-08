import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  StudEngine,
  type HumanAction,
  type SessionStats,
  type StudSnapshot,
  type StudStreet,
} from './game/studEngine'
import type { Card } from './game/cards'
import { isRedSuit, rankDisplay, suitSymbol } from './game/cards'
import { handLabel, bestHandScore } from './game/pokerRank'
import { bestRazzLowScore, razzHandLabel } from './game/razzRank'
import { bestEightOrBetterLowScore, hiLoLowHandLabel } from './game/hiloRank'
import { badugiHandLabel, bestBadugiScore } from './game/badugiRank'
import { bestDeuceToSevenLowScore, deuceHandLabel } from './game/deuceRank'
import {
  loadGlobalSettings,
  loadSettings,
  saveGlobalSettings,
  saveSettingsForGame,
} from './settings/storage'
import {
  DEFAULT_SETTINGS,
  GAME_LABELS,
  MAX_STARTING_STACK,
  MIN_STARTING_STACK,
  STAKES_BY_TIER,
  TEMPO_HANDS_BY_PRESET,
  type GlobalSettings,
  type GameKind,
  type GameSettings,
} from './settings/types'
import './App.css'
import {
  playBettingSoundIfNew,
  setBettingSoundEnabled,
  unlockBettingAudio,
} from './audio/bettingSounds'
import { InstallAppBanner } from './pwa/InstallAppBanner'
import {
  GAME_ORDER,
  loadCareerStats,
  mergeFinishedGame,
  saveCareerStats,
  type CareerStats,
  type GameRecord,
} from './stats/career'

function PlayingCardFace({
  c,
  kind,
  sunk = false,
}: {
  c: Card
  kind: 'hole' | 'up'
  /** Slightly lower — opponent-hidden hole cards (incl. 7th-street down). */
  sunk?: boolean
}) {
  const suitClass = isRedSuit(c.suit) ? 'card--red-suit' : 'card--black-suit'
  return (
    <span
      className={['card', 'card--face', kind, suitClass, sunk ? 'card--hero-sunk' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <span className="card-face__rank">{rankDisplay(c.rank)}</span>
      <span className="card-face__suit">{suitSymbol(c.suit)}</span>
    </span>
  )
}

/** Stud deal order: 2 down, door + streets up, last down on river. */
function heroCardsInTableOrder(
  hole: Card[],
  up: Card[],
): { card: Card; faceKind: 'hole' | 'up'; sunk: boolean }[] {
  const out: { card: Card; faceKind: 'hole' | 'up'; sunk: boolean }[] = []
  if (hole[0]) out.push({ card: hole[0], faceKind: 'hole', sunk: true })
  if (hole[1]) out.push({ card: hole[1], faceKind: 'hole', sunk: true })
  for (const c of up) {
    out.push({ card: c, faceKind: 'up', sunk: false })
  }
  if (hole.length >= 3) {
    out.push({ card: hole[2], faceKind: 'hole', sunk: true })
  }
  return out
}

function cardsForGameDisplay(
  gameKind: GameKind,
  hole: Card[],
  up: Card[],
): { card: Card; faceKind: 'hole' | 'up'; sunk: boolean }[] {
  if (gameKind === 'badugi' || gameKind === 'deuce7') {
    return hole.map((card) => ({ card, faceKind: 'hole', sunk: false }))
  }
  return heroCardsInTableOrder(hole, up)
}

type PlayTableLayout = 'wide' | 'narrow' | 'landscape'

type SeatPos = { left: number; top: number; bottom?: boolean }

/**
 * Phone on its side: seats around the full-screen felt.
 * Hero is always on the bottom. With six players that is two along the top,
 * two on the sides, and two on the bottom — hero shifted left, one opponent right.
 */
function landscapeTable(opponentCount: number): { heroLeft: number; opponents: SeatPos[] } {
  const topL: SeatPos = { left: 34, top: 30 }
  const topC: SeatPos = { left: 50, top: 27 }
  const topR: SeatPos = { left: 66, top: 30 }
  const sideL: SeatPos = { left: 14, top: 52 }
  const sideR: SeatPos = { left: 86, top: 52 }
  const botR: SeatPos = { left: 74, top: 0, bottom: true }
  switch (opponentCount) {
    case 0:
      return { heroLeft: 50, opponents: [] }
    case 1:
      return { heroLeft: 50, opponents: [topC] }
    case 2:
      return { heroLeft: 50, opponents: [topL, topR] }
    case 3:
      return { heroLeft: 50, opponents: [sideL, topC, sideR] }
    case 4:
      return { heroLeft: 50, opponents: [sideL, topL, topR, sideR] }
    case 5:
      return { heroLeft: 26, opponents: [sideL, topL, topR, sideR, botR] }
    default:
      return {
        heroLeft: 26,
        opponents: [sideL, topL, topC, topR, sideR, { left: 74, top: 0, bottom: true }],
      }
  }
}

/**
 * Opponent seats on an upper ellipse (no seats at bottom — hero sits there).
 * θ is standard math angle from +x; sin negative puts seats in upper half of felt.
 * `narrow` uses a slightly smaller vertical arc; horizontal spread stays close to
 * desktop so end seats still sit near the left/right edges (same feel as Mac).
 */
function opponentSeatPositions(count: number, layout: PlayTableLayout): SeatPos[] {
  if (count <= 0) return []
  const narrow = layout === 'narrow'
  const start = (-168 * Math.PI) / 180
  const end = (-12 * Math.PI) / 180
  const cx = 50
  const cy = narrow ? 42 : 41
  /* rx was 27 on narrow + left clamp 22–78%, which bunched bots away from screen edges */
  const rx = narrow ? 40 : 42
  const ry = narrow ? 18 : 25
  /** Slight inward shift for arc ends so a full 7-card fan stays inside the felt. */
  const edgeNudgePct = narrow ? 2.25 : 1.75
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const theta = start + (end - start) * t
    let left = cx + rx * Math.cos(theta)
    let top = cy + ry * Math.sin(theta)
    if (narrow) {
      top = Math.min(38, Math.max(14, top))
    }
    if (count >= 2) {
      if (i === 0) left += edgeNudgePct
      if (i === count - 1) left -= edgeNudgePct
    }
    return { left, top }
  })
}

const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 700px)'

function readPlayTableLayout(): { layout: PlayTableLayout; aiPauseMs: number } {
  const landscape = window.matchMedia(PHONE_LANDSCAPE_QUERY).matches
  const narrow =
    !landscape &&
    (window.matchMedia('(max-width: 560px)').matches ||
      window.matchMedia('(max-height: 520px)').matches)
  const layout: PlayTableLayout = landscape ? 'landscape' : narrow ? 'narrow' : 'wide'
  return { layout, aiPauseMs: layout === 'wide' ? 680 : 520 }
}

function usePlayTableLayout(): { layout: PlayTableLayout; aiPauseMs: number } {
  const [state, setState] = useState(readPlayTableLayout)
  useEffect(() => {
    const mqLandscape = window.matchMedia(PHONE_LANDSCAPE_QUERY)
    const mqNarrowWidth = window.matchMedia('(max-width: 560px)')
    const mqShortHeight = window.matchMedia('(max-height: 520px)')
    const apply = () => setState(readPlayTableLayout())
    mqLandscape.addEventListener('change', apply)
    mqNarrowWidth.addEventListener('change', apply)
    mqShortHeight.addEventListener('change', apply)
    window.addEventListener('resize', apply)
    apply()
    return () => {
      mqLandscape.removeEventListener('change', apply)
      mqNarrowWidth.removeEventListener('change', apply)
      mqShortHeight.removeEventListener('change', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])
  return state
}

/** Human raise button: first aggression on the street is Bet (or Complete), later Raise. */
function raiseActionLabel(snap: StudSnapshot): string {
  if (snap.raisesThisStreet > 0) return 'Raise'
  if (snap.street === 3 && snap.stakes.bringIn < snap.stakes.smallBet) {
    return 'Complete'
  }
  return 'Bet'
}

function isDrawKind(gameKind: GameKind): boolean {
  return gameKind === 'badugi' || gameKind === 'deuce7'
}

function foldStreetsFor(gameKind: GameKind): StudStreet[] {
  return isDrawKind(gameKind) ? [3, 4, 5, 6] : [3, 4, 5, 6, 7]
}

function foldStreetLabel(gameKind: GameKind, street: StudStreet): string {
  if (isDrawKind(gameKind)) {
    if (street === 3) return 'Opening round'
    if (street === 4) return 'After 1st draw'
    if (street === 5) return 'After 2nd draw'
    return 'After 3rd draw'
  }
  if (street === 3) return '3rd street'
  if (street === 4) return '4th street'
  if (street === 5) return '5th street'
  if (street === 6) return '6th street'
  return '7th street'
}

function finalStreetWinLabel(gameKind: GameKind): string {
  return isDrawKind(gameKind)
    ? 'Wins through the last draw'
    : 'Wins from 4th street to the last'
}

function formatSignedChips(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toLocaleString('en-US')} chips`
}

function StatRows({
  stats,
  gameKind,
  netChips,
}: {
  stats: Pick<
    SessionStats,
    | 'handsPlayed'
    | 'handsWon'
    | 'handsFolded'
    | 'foldsByStreet'
    | 'winsFromFourthStreetToLast'
    | 'totalChipsWonFromPots'
  >
  gameKind: GameKind
  netChips: number | null
}) {
  const foldPct =
    stats.handsPlayed > 0 ? Math.round((100 * stats.handsFolded) / stats.handsPlayed) : 0
  const winPct =
    stats.handsPlayed > 0 ? Math.round((100 * stats.handsWon) / stats.handsPlayed) : 0
  return (
    <dl className="session-stats-end__dl">
      <div className="session-stats-end__row">
        <dt>Hands won</dt>
        <dd>
          {stats.handsWon} / {stats.handsPlayed} ({winPct}%)
        </dd>
      </div>
      <div className="session-stats-end__row">
        <dt>Folded</dt>
        <dd>
          {stats.handsFolded} ({foldPct}%)
        </dd>
      </div>
      <div className="session-stats-end__subhead">When you folded</div>
      {foldStreetsFor(gameKind).map((street) => (
        <div key={street} className="session-stats-end__row session-stats-end__row--indent">
          <dt>{foldStreetLabel(gameKind, street)}</dt>
          <dd>{stats.foldsByStreet[street]}</dd>
        </div>
      ))}
      {netChips !== null ? (
        <div className="session-stats-end__row">
          <dt>Result</dt>
          <dd>{formatSignedChips(netChips)}</dd>
        </div>
      ) : null}
      <div className="session-stats-end__row">
        <dt>Won from pots</dt>
        <dd>{stats.totalChipsWonFromPots.toLocaleString('en-US')} chips</dd>
      </div>
      <div className="session-stats-end__row">
        <dt>{finalStreetWinLabel(gameKind)}</dt>
        <dd>{stats.winsFromFourthStreetToLast}</dd>
      </div>
    </dl>
  )
}

function SessionStatsSummary({
  stats,
  gameKind,
  netChips,
  lifetime,
}: {
  stats: SessionStats
  gameKind: GameKind
  netChips: number
  lifetime: GameRecord
}) {
  return (
    <div className="session-stats-end">
      <h2 className="session-stats-end__title">This game</h2>
      <StatRows stats={stats} gameKind={gameKind} netChips={netChips} />
      <h2 className="session-stats-end__title session-stats-end__title--follow">
        All time · {GAME_LABELS[gameKind]}
      </h2>
      <dl className="session-stats-end__dl">
        <div className="session-stats-end__row">
          <dt>Times you won this game</dt>
          <dd>
            {lifetime.gamesWon} / {lifetime.gamesPlayed}
          </dd>
        </div>
        <div className="session-stats-end__row">
          <dt>Hands won in total</dt>
          <dd>{lifetime.handsWon}</dd>
        </div>
      </dl>
    </div>
  )
}

function StatsScreen({ career, onBack }: { career: CareerStats; onBack: () => void }) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="app shell stats-screen">
      <header className="topbar topbar--menu">
        <h1>Statistics</h1>
        <p className="tagline">Saved separately for each game.</p>
      </header>
      <section className="session-stats-end">
        <h2 className="session-stats-end__title">All Game Challenge</h2>
        <dl className="session-stats-end__dl">
          <div className="session-stats-end__row">
            <dt>Completed</dt>
            <dd>{career.challengeCompleted}</dd>
          </div>
          <div className="session-stats-end__row">
            <dt>Failed</dt>
            <dd>{career.challengeFailed}</dd>
          </div>
        </dl>
        <p className="session-stats-end__hint muted">
          A challenge is one win for each game, played in order. Losing any game is a failed
          challenge.
        </p>
      </section>
      {GAME_ORDER.map((gameKind) => {
        const record = career.byGame[gameKind]
        return (
          <section key={gameKind} className="session-stats-end">
            <h2 className="session-stats-end__title">{GAME_LABELS[gameKind]}</h2>
            <dl className="session-stats-end__dl">
              <div className="session-stats-end__row">
                <dt>Times you won this game</dt>
                <dd>
                  {record.gamesWon} / {record.gamesPlayed}
                </dd>
              </div>
            </dl>
            <StatRows
              stats={record}
              gameKind={gameKind}
              netChips={record.netChips}
            />
          </section>
        )
      })}
      <div className="form-actions form-actions--center">
        <button type="button" className="btn primary" onClick={onBack}>
          Back to menu
        </button>
      </div>
    </div>
  )
}

type Screen = 'menu' | 'settings' | 'play' | 'stats'

interface ChallengeRun {
  index: number
}

interface ActiveGame {
  sessionId: number
  gameKind: GameKind
  engine: StudEngine
  snap: StudSnapshot
  challenge: ChallengeRun | null
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [selectedGame, setSelectedGame] = useState<GameKind>('stud')
  const [settingsByGame, setSettingsByGame] = useState<Record<GameKind, GameSettings>>(() => ({
    stud: loadSettings('stud'),
    razz: loadSettings('razz'),
    studhilo: loadSettings('studhilo'),
    badugi: loadSettings('badugi'),
    deuce7: loadSettings('deuce7'),
  }))
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(() => loadGlobalSettings())
  const [career, setCareer] = useState<CareerStats>(() => loadCareerStats())
  const [game, setGame] = useState<ActiveGame | null>(null)
  const [lastRecordedSessionId, setLastRecordedSessionId] = useState<number | null>(null)
  const sessionCounter = useRef(0)
  const activeSettings = settingsByGame[selectedGame]

  useEffect(() => {
    setBettingSoundEnabled(globalSettings.soundEnabled)
  }, [globalSettings.soundEnabled])

  const refresh = useCallback(() => {
    setGame((g) => (g ? { ...g, snap: g.engine.snapshot() } : null))
  }, [])

  const startGame = useCallback((gameKind: GameKind, challenge: ChallengeRun | null = null) => {
    unlockBettingAudio()
    const resolvedSettings = {
      ...settingsByGame[gameKind],
      difficulty: globalSettings.useGlobalDifficulty
        ? globalSettings.globalDifficulty
        : settingsByGame[gameKind].difficulty,
    }
    const engine = new StudEngine(resolvedSettings, gameKind)
    engine.startSession()
    engine.beginHand()
    sessionCounter.current += 1
    setGame({
      sessionId: sessionCounter.current,
      gameKind,
      engine,
      snap: engine.snapshot(),
      challenge,
    })
    setScreen('play')
  }, [globalSettings.globalDifficulty, globalSettings.useGlobalDifficulty, settingsByGame])

  const leaveToMenu = useCallback(() => {
    setGame(null)
    setScreen('menu')
  }, [])

  if (
    game &&
    (game.snap.phase === 'youWonTable' || game.snap.phase === 'youBusted') &&
    game.sessionId !== lastRecordedSessionId
  ) {
    const hero = game.snap.players.find((p) => p.isHuman)
    const net = (hero?.stack ?? 0) - game.snap.sessionStartStack
    const outcome = game.snap.phase === 'youWonTable' ? 'won' : 'lost'
    const challengeResult =
      game.challenge == null
        ? null
        : outcome === 'lost'
          ? 'failed'
          : game.challenge.index === GAME_ORDER.length - 1
            ? 'completed'
            : null
    const next = mergeFinishedGame(
      career,
      game.gameKind,
      game.snap.sessionStats,
      outcome,
      net,
      challengeResult,
    )
    saveCareerStats(next)
    setLastRecordedSessionId(game.sessionId)
    setCareer(next)
  }

  const applySettings = useCallback((gameKind: GameKind, next: GameSettings) => {
    setSettingsByGame((prev) => ({ ...prev, [gameKind]: next }))
    saveSettingsForGame(gameKind, next)
    setScreen('menu')
  }, [])

  if (screen === 'settings') {
    return (
      <SettingsScreen
        gameKind={selectedGame}
        initial={activeSettings}
        globalSettings={globalSettings}
        onSave={(next) => applySettings(selectedGame, next)}
        onSaveGlobal={(next) => {
          setGlobalSettings(next)
          saveGlobalSettings(next)
        }}
        onCancel={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'stats') {
    return <StatsScreen career={career} onBack={() => setScreen('menu')} />
  }

  if (screen === 'play' && game) {
    const nextIndex = game.challenge ? game.challenge.index + 1 : 0
    const offerNextChallengeGame =
      game.challenge !== null &&
      game.snap.phase === 'youWonTable' &&
      nextIndex < GAME_ORDER.length
    return (
      <PlayScreen
        game={game}
        lifetime={career.byGame[game.gameKind]}
        challengeCompleted={career.challengeCompleted}
        challengeFailed={career.challengeFailed}
        onRefresh={refresh}
        onQuit={leaveToMenu}
        onNextChallengeGame={
          offerNextChallengeGame ? () => startGame(GAME_ORDER[nextIndex], { index: nextIndex }) : null
        }
      />
    )
  }

  return (
    <div className="app shell shell--menu">
      <div className="menu-stack">
        <header className="topbar topbar--menu">
          <h1>Cardroom Engine</h1>
          <p className="tagline">
            Fixed-limit stud variants — play money only.
          </p>
        </header>
        <div className="menu-actions-wrap">
          <div className="menu-main menu-main--actions">
            {(['stud', 'razz', 'studhilo', 'badugi', 'deuce7'] as const).map((gameKind) => (
              <div key={gameKind} className="menu-game-row">
                <button
                  type="button"
                  className={['btn', selectedGame === gameKind ? 'primary' : 'ghost'].join(' ')}
                  onClick={() => {
                    setSelectedGame(gameKind)
                    startGame(gameKind, null)
                  }}
                >
                  Play {GAME_LABELS[gameKind]}
                </button>
                <button
                  type="button"
                  className="btn ghost btn-settings-icon"
                  aria-label={`${GAME_LABELS[gameKind]} settings`}
                  title={`${GAME_LABELS[gameKind]} settings`}
                  onClick={() => {
                    setSelectedGame(gameKind)
                    setScreen('settings')
                  }}
                >
                  ⚙
                </button>
              </div>
            ))}
            <button type="button" className="btn accent" onClick={() => startGame(GAME_ORDER[0], { index: 0 })}>
              All Game Challenge
            </button>
            <p className="menu-challenge-note muted">
              Win every game, one at a time. Completed {career.challengeCompleted} · Failed{' '}
              {career.challengeFailed}
            </p>
            <button type="button" className="btn ghost" onClick={() => setScreen('stats')}>
              Statistics
            </button>
          </div>
        </div>
        <section className="menu-meta">
          <h2>Current setup ({GAME_LABELS[selectedGame]})</h2>
          <ul>
            <li>Opponents: {activeSettings.opponentCount}</li>
            <li>
              Difficulty:{' '}
              {globalSettings.useGlobalDifficulty
                ? `${globalSettings.globalDifficulty} (global)`
                : activeSettings.difficulty}
            </li>
            <li>
              Tempo:{' '}
              {activeSettings.useAdvancedTempo
                ? `${activeSettings.handsPerLevel} hands / level`
                : activeSettings.tempoPreset}
            </li>
            <li>Stakes: {activeSettings.stakes}</li>
            <li>Starting stack (each): {activeSettings.startingStack}</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function startingStackFieldError(raw: string): string | null {
  const t = raw.trim()
  if (t === '') return 'Enter a starting stack (whole number).'
  const n = Number(t)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return 'Use a whole number for starting stack.'
  }
  if (n < MIN_STARTING_STACK) {
    return 'Starting stack must be at least 100.'
  }
  if (n > MAX_STARTING_STACK) {
    return `Starting stack cannot exceed ${MAX_STARTING_STACK.toLocaleString('en-US')}.`
  }
  return null
}

function SettingsScreen({
  gameKind,
  initial,
  globalSettings,
  onSave,
  onSaveGlobal,
  onCancel,
}: {
  gameKind: GameKind
  initial: GameSettings
  globalSettings: GlobalSettings
  onSave: (s: GameSettings) => void
  onSaveGlobal: (s: GlobalSettings) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<GameSettings>(initial)
  const [globalDraft, setGlobalDraft] = useState<GlobalSettings>(globalSettings)
  const [startingStackInput, setStartingStackInput] = useState(() =>
    String(initial.startingStack),
  )
  const startingStackError = startingStackFieldError(startingStackInput)
  const startingStackValid = startingStackError === null

  useEffect(() => {
    setDraft(initial)
    setStartingStackInput(String(initial.startingStack))
  }, [initial, gameKind])

  useEffect(() => {
    setGlobalDraft(globalSettings)
  }, [globalSettings])

  return (
    <div className="app shell settings-screen">
      <header className="topbar">
        <h1>{GAME_LABELS[gameKind]} settings</h1>
      </header>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!startingStackValid) return
          const stack = Number(startingStackInput.trim())
          onSave({ ...draft, startingStack: stack })
          onSaveGlobal(globalDraft)
        }}
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={globalDraft.soundEnabled}
            onChange={(e) =>
              setGlobalDraft((g) => ({ ...g, soundEnabled: e.target.checked }))
            }
          />
          Sound enabled (all games)
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={globalDraft.useGlobalDifficulty}
            onChange={(e) =>
              setGlobalDraft((g) => ({ ...g, useGlobalDifficulty: e.target.checked }))
            }
          />
          Use global difficulty (all games)
        </label>

        {globalDraft.useGlobalDifficulty ? (
          <label>
            Global difficulty
            <select
              value={globalDraft.globalDifficulty}
              onChange={(e) =>
                setGlobalDraft((g) => ({
                  ...g,
                  globalDifficulty: e.target.value as GlobalSettings['globalDifficulty'],
                }))
              }
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        ) : null}

        <label>
          Opponents (AI)
          <input
            type="range"
            min={1}
            max={6}
            value={draft.opponentCount}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                opponentCount: Number(e.target.value),
              }))
            }
          />
          <span className="range-val">{draft.opponentCount}</span>
        </label>

        <label>
          Difficulty
          <select
            value={draft.difficulty}
            disabled={globalDraft.useGlobalDifficulty}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                difficulty: e.target.value as GameSettings['difficulty'],
              }))
            }
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          {globalDraft.useGlobalDifficulty ? (
            <span className="hint">Disabled while global difficulty is enabled.</span>
          ) : null}
        </label>

        <label>
          Tempo preset
          <select
            value={draft.tempoPreset}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                tempoPreset: e.target.value as GameSettings['tempoPreset'],
              }))
            }
          >
            <option value="slow">Slow</option>
            <option value="medium">Medium</option>
            <option value="fast">Fast</option>
          </select>
          <span className="hint">
            (
            {TEMPO_HANDS_BY_PRESET[draft.tempoPreset]} hands before ante &amp;
            limits rise)
          </span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.useAdvancedTempo}
            onChange={(e) =>
              setDraft((d) => ({ ...d, useAdvancedTempo: e.target.checked }))
            }
          />
          Advanced: custom hands per level
        </label>

        {draft.useAdvancedTempo ? (
          <label>
            Hands per level
            <input
              type="number"
              min={1}
              max={99}
              value={draft.handsPerLevel}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  handsPerLevel: Number(e.target.value) || DEFAULT_SETTINGS.handsPerLevel,
                }))
              }
            />
          </label>
        ) : null}

        <label>
          Stakes tier
          <select
            value={draft.stakes}
            onChange={(e) => {
              const stakes = e.target.value as GameSettings['stakes']
              const tierStack = STAKES_BY_TIER[stakes].startingStack
              setDraft((d) => ({
                ...d,
                stakes,
                startingStack: tierStack,
              }))
              setStartingStackInput(String(tierStack))
            }}
          >
            <option value="low">Low</option>
            <option value="mid">Mid</option>
            <option value="high">High</option>
          </select>
        </label>

        <label>
          Starting stack (each player)
          <input
            id="settings-starting-stack"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={startingStackError ? 'field-invalid' : undefined}
            aria-invalid={startingStackError ? true : undefined}
            aria-describedby={
              startingStackError ? 'settings-starting-stack-error' : undefined
            }
            value={startingStackInput}
            onChange={(e) => setStartingStackInput(e.target.value)}
          />
          {startingStackError ? (
            <p
              id="settings-starting-stack-error"
              className="settings-form__error"
              role="alert"
            >
              {startingStackError}
            </p>
          ) : null}
          <span className="hint">
            Minimum {MIN_STARTING_STACK.toLocaleString('en-US')} chips per player. Tier default:{' '}
            {STAKES_BY_TIER[draft.stakes].startingStack}.
          </span>
        </label>

        <p className="stakes-preview">
          Ante {STAKES_BY_TIER[draft.stakes].ante} · Small{' '}
          {STAKES_BY_TIER[draft.stakes].smallBet} · Big{' '}
          {STAKES_BY_TIER[draft.stakes].bigBet}
        </p>

        <div className="form-actions">
          <button
            type="submit"
            className="btn primary"
            disabled={!startingStackValid}
          >
            Save
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function PlayScreen({
  game,
  lifetime,
  challengeCompleted,
  challengeFailed,
  onRefresh,
  onQuit,
  onNextChallengeGame,
}: {
  game: ActiveGame
  lifetime: GameRecord
  challengeCompleted: number
  challengeFailed: number
  onRefresh: () => void
  onQuit: () => void
  onNextChallengeGame: (() => void) | null
}) {
  const { engine, snap } = game
  const isDrawGame = game.gameKind === 'badugi' || game.gameKind === 'deuce7'
  const { layout: tableLayout, aiPauseMs } = usePlayTableLayout()
  const [aiDrive, setAiDrive] = useState(0)
  const [selectedDiscards, setSelectedDiscards] = useState<number[]>([])

  useEffect(() => {
    const onFirstTouch = () => unlockBettingAudio()
    window.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true })
    return () => window.removeEventListener('pointerdown', onFirstTouch)
  }, [])

  useEffect(() => {
    if (snap.phase !== 'betting' && snap.phase !== 'draw') return
    if (snap.actionIndex === null) {
      engine.resolveIdleAction()
      onRefresh()
      return
    }
    if (snap.humanMustAct) return
    const id = window.setTimeout(() => {
      const before = engine.snapshot().bettingSoundNonce
      const progressed = engine.stepAiOnce()
      if (!progressed) {
        const now = engine.snapshot()
        if ((now.phase === 'betting' || now.phase === 'draw') && !now.humanMustAct) {
          engine.fastForwardHand()
        }
      }
      const s = engine.snapshot()
      playBettingSoundIfNew(before, s.bettingSoundNonce, s.lastBettingSound)
      onRefresh()
      setAiDrive((d) => d + 1)
    }, aiPauseMs)
    return () => window.clearTimeout(id)
  }, [
    aiDrive,
    aiPauseMs,
    engine,
    onRefresh,
    snap.actionIndex,
    snap.humanMustAct,
    snap.phase,
  ])

  /* Only legal action is check (e.g. all-in runout) — no pointless tap. */
  useEffect(() => {
    if (snap.phase !== 'betting' || !snap.humanMustAct) return
    if (!engine.snapshot().humanMustAct) return
    const actions = engine.legalHumanActions()
    if (actions.length === 1 && actions[0] === 'check') {
      engine.applyHuman({ type: 'check' })
      onRefresh()
    }
  }, [
    snap.phase,
    snap.humanMustAct,
    snap.actionIndex,
    snap.street,
    snap.raisesThisStreet,
    snap.handNumber,
    snap.pot,
    engine,
    onRefresh,
  ])

  const legal = snap.humanMustAct ? engine.legalHumanActions() : []
  const onlyAutoCheck =
    snap.humanMustAct && legal.length === 1 && legal[0] === 'check'
  const drawMax = game.gameKind === 'badugi' ? 4 : game.gameKind === 'deuce7' ? 5 : 0
  const canHumanDrawSelect =
    isDrawGame && snap.phase === 'draw' && snap.humanMustAct && legal.includes('draw')

  useEffect(() => {
    if (!canHumanDrawSelect) {
      setSelectedDiscards([])
      return
    }
    setSelectedDiscards((prev) => prev.filter((idx) => idx >= 0 && idx < drawMax))
  }, [canHumanDrawSelect, drawMax, snap.handNumber, snap.actionIndex])

  const act = (a: HumanAction) => {
    const before = engine.snapshot().bettingSoundNonce
    engine.applyHuman(a)
    const s = engine.snapshot()
    playBettingSoundIfNew(before, s.bettingSoundNonce, s.lastBettingSound)
    onRefresh()
  }

  const skipToResult = () => {
    engine.fastForwardHand()
    onRefresh()
  }

  const continueHand = () => {
    engine.acknowledgeHandSummary()
    onRefresh()
  }

  const opponentCount = snap.players.filter((p) => !p.isHuman).length
  const tableSeats = useMemo(() => {
    if (tableLayout === 'landscape') return landscapeTable(opponentCount)
    return { heroLeft: 50, opponents: opponentSeatPositions(opponentCount, tableLayout) }
  }, [opponentCount, tableLayout])
  const oppPositions = tableSeats.opponents

  if (snap.phase === 'youBusted' || snap.phase === 'youWonTable') {
    const hero = snap.players.find((p) => p.isHuman)
    const netChips = (hero?.stack ?? 0) - snap.sessionStartStack
    const wonTable = snap.phase === 'youWonTable'
    const challenge = game.challenge
    const nextKind =
      challenge && wonTable && challenge.index + 1 < GAME_ORDER.length
        ? GAME_ORDER[challenge.index + 1]
        : null
    let challengeLine: string | null = null
    if (challenge && wonTable && nextKind) {
      challengeLine = `Challenge ${challenge.index + 1}/${GAME_ORDER.length} won. Next: ${GAME_LABELS[nextKind]}.`
    } else if (challenge && wonTable) {
      challengeLine = `Challenge completed. You won all ${GAME_ORDER.length} games. Completed ${challengeCompleted} · Failed ${challengeFailed}.`
    } else if (challenge) {
      challengeLine = `Challenge failed on ${GAME_LABELS[game.gameKind]}. Completed ${challengeCompleted} · Failed ${challengeFailed}.`
    }
    return (
      <div className="app shell end-screen">
        <h1>{wonTable ? 'You won the table' : 'Game over'}</h1>
        <p className="end-screen__game">{GAME_LABELS[game.gameKind]}</p>
        <p className="end-screen__message">{snap.message}</p>
        {challengeLine ? <p className="end-screen__message">{challengeLine}</p> : null}
        <SessionStatsSummary
          stats={snap.sessionStats}
          gameKind={game.gameKind}
          netChips={netChips}
          lifetime={lifetime}
        />
        <div className="form-actions form-actions--center">
          {onNextChallengeGame ? (
            <button type="button" className="btn primary" onClick={onNextChallengeGame}>
              Next game
            </button>
          ) : null}
          <button
            type="button"
            className={onNextChallengeGame ? 'btn ghost' : 'btn primary'}
            onClick={onQuit}
          >
            Back to menu
          </button>
        </div>
      </div>
    )
  }

  const showAllHoles = snap.phase === 'handSummary'

  const heroIdx = snap.players.findIndex((p) => p.isHuman)
  const hero = heroIdx >= 0 ? snap.players[heroIdx] : undefined
  const opponents = snap.players.filter((p) => !p.isHuman)

  const renderSeat = (p: (typeof snap.players)[0], idx: number, heroSeat: boolean) => {
    const isDealer = idx === snap.dealerIndex
    const isActor = idx === snap.actionIndex && (snap.phase === 'betting' || snap.phase === 'draw')
    const showHoleFaces = p.isHuman || showAllHoles
    const oppOrSummaryLine = (
      <div
        className="hand-zone hand-zone--hero-line"
        aria-label={
          showHoleFaces ? 'All cards' : 'Opponent cards: down cards hidden'
        }
      >
        <div className="cards-row cards-row--hero-line">
          {cardsForGameDisplay(game.gameKind, p.hole, p.up).map(({ card, faceKind, sunk }, i) =>
            showHoleFaces || faceKind === 'up' ? (
              <PlayingCardFace key={i} c={card} kind={faceKind} sunk={sunk} />
            ) : (
              <span
                key={i}
                className={['card', 'back', sunk ? 'card--hero-sunk' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                ●
              </span>
            ),
          )}
        </div>
      </div>
    )
    const heroLine =
      heroSeat && (p.isHuman || showAllHoles) ? (
        <div
          className="hand-zone hand-zone--hero-line"
          aria-label="Your cards: lower row are hole cards hidden from opponents"
        >
          <div className="cards-row cards-row--hero-line">
            {cardsForGameDisplay(game.gameKind, p.hole, p.up).map(({ card, faceKind, sunk }, i) => {
              if (!canHumanDrawSelect || faceKind !== 'hole') {
                return <PlayingCardFace key={i} c={card} kind={faceKind} sunk={sunk} />
              }
              const selected = selectedDiscards.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  className={['card-discard-pick', selected ? 'card-discard-pick--selected' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    setSelectedDiscards((prev) => {
                      if (prev.includes(i)) return prev.filter((x) => x !== i)
                      if (prev.length >= drawMax) return prev
                      return [...prev, i]
                    })
                  }}
                  aria-pressed={selected}
                  aria-label={selected ? 'Keep card' : 'Discard card'}
                >
                  <PlayingCardFace c={card} kind={faceKind} sunk={sunk} />
                </button>
              )
            })}
          </div>
        </div>
      ) : null
    const highBest = showAllHoles && !p.folded ? bestHandScore([...p.hole, ...p.up]) : null
    const razzBest = showAllHoles && !p.folded ? bestRazzLowScore([...p.hole, ...p.up]) : null
    const hiLoLowBest =
      showAllHoles && !p.folded ? bestEightOrBetterLowScore([...p.hole, ...p.up]) : null
    const badugiBest = showAllHoles && !p.folded ? bestBadugiScore(p.hole) : null
    const deuceBest = showAllHoles && !p.folded ? bestDeuceToSevenLowScore(p.hole) : null
    let bestText: string | null = null
    if (showAllHoles && !p.folded) {
      if (game.gameKind === 'stud' && highBest) {
        bestText = handLabel(highBest)
      } else if (game.gameKind === 'razz' && razzBest) {
        bestText = razzHandLabel(razzBest)
      } else if (game.gameKind === 'studhilo' && highBest) {
        const lowText = hiLoLowBest ? ` / ${hiLoLowHandLabel(hiLoLowBest)}` : ''
        bestText = `${handLabel(highBest)}${lowText}`
      } else if (game.gameKind === 'badugi' && badugiBest) {
        bestText = badugiHandLabel(badugiBest)
      } else if (game.gameKind === 'deuce7' && deuceBest) {
        bestText = deuceHandLabel(deuceBest)
      }
    }
    return (
      <div
        className={[
          'player-card',
          isActor ? 'acting' : '',
          p.folded ? 'folded' : '',
          heroSeat ? 'player-card--hero' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="player-head">
          <span>{p.name}</span>
          {isDealer ? <span className="dealer-pill">D</span> : null}
          {p.folded ? <span className="fold-pill">Fold</span> : null}
        </div>
        {snap.phase === 'betting' && p.streetCommit > 0 ? (
          <div className="bet-chip-marker">{p.streetCommit}</div>
        ) : null}
        <div className="stack">{p.stack}</div>
        {heroSeat ? heroLine : oppOrSummaryLine}
        {bestText ? <div className="best-hand">{bestText}</div> : null}
      </div>
    )
  }

  return (
    <div
      className={['app', 'play', tableLayout === 'landscape' ? 'play--phone-landscape' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <header className="play-bar">
        <div>
          <strong>Hand {snap.handNumber}</strong>
          <div className="challenge-pill">
            {game.challenge
              ? `Challenge ${game.challenge.index + 1}/${GAME_ORDER.length} · `
              : ''}
            {GAME_LABELS[game.gameKind]}
          </div>
        </div>
        <div className="play-bar-right">
          <span className="pot">Pot {snap.pot}</span>
          <button type="button" className="btn tiny ghost" onClick={onQuit}>
            Quit
          </button>
        </div>
      </header>

      <p className="status-msg">{snap.message}</p>

      <div
        className={['play-table-column', tableLayout === 'narrow' ? 'play-table-column--narrow' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="table-wrap">
          <div className="felt">
            <div className="felt-pot-badge" aria-hidden="true">
              {snap.pot}
            </div>
            <div className="seats-ring" aria-hidden="true" />
            <div className="opponent-seats">
              {opponents.map((p, i) => {
                const idx = snap.players.findIndex((x) => x.id === p.id)
                const pos = oppPositions[i] ?? { left: 50, top: 22 }
                return (
                  <div
                    key={p.id}
                    className={['seat', 'seat--opp', pos.bottom ? 'seat--bottom' : '']
                      .filter(Boolean)
                      .join(' ')}
                    style={
                      (pos.bottom
                        ? { left: `${pos.left}%` }
                        : { left: `${pos.left}%`, top: `${pos.top}%` }) as CSSProperties
                    }
                  >
                    {renderSeat(p, idx, false)}
                  </div>
                )
              })}
            </div>
            {hero && heroIdx >= 0 ? (
              <div
                className="seat seat--hero"
                style={
                  tableLayout === 'landscape'
                    ? ({ left: `${tableSeats.heroLeft}%` } as CSSProperties)
                    : undefined
                }
              >
                {renderSeat(hero, heroIdx, true)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="under-felt">
          <div className="street-pill">{snap.phase === 'betting' || snap.phase === 'draw' ? '' : snap.phase}</div>

          {snap.phase === 'handSummary' ? (
            <>
              <InstallAppBanner visible={snap.handNumber >= 1} />
              <div className="summary-panel">
                <p>{snap.lastSummary}</p>
                <div className="summary-panel__actions">
                  <button type="button" className="btn primary" onClick={continueHand}>
                    Next hand
                  </button>
                </div>
              </div>
            </>
          ) : null}

          <div
            className="actions-slot"
            aria-busy={onlyAutoCheck || undefined}
            aria-label={onlyAutoCheck ? 'Continuing hand' : undefined}
          >
            {snap.humanMustAct && !onlyAutoCheck ? (
              <div className="actions-bar">
                {legal.includes('draw') ? (
                  <>
                    {canHumanDrawSelect ? (
                      <>
                        <button
                          type="button"
                          className="btn accent"
                          onClick={() =>
                            act({
                              type: 'draw',
                              count: selectedDiscards.length,
                              discardIndices: selectedDiscards,
                            })
                          }
                        >
                          Draw {selectedDiscards.length}
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => setSelectedDiscards([])}
                        >
                          Keep all
                        </button>
                      </>
                    ) : (
                      Array.from({ length: drawMax + 1 }, (_, n) => (
                        <button
                          key={`draw-${n}`}
                          type="button"
                          className={n === 0 ? 'btn ghost' : 'btn'}
                          onClick={() => act({ type: 'draw', count: n })}
                        >
                          Draw {n}
                        </button>
                      ))
                    )}
                  </>
                ) : null}
                {legal.includes('fold') ? (
                  <button type="button" className="btn danger" onClick={() => act({ type: 'fold' })}>
                    Fold
                  </button>
                ) : null}
                {legal.includes('check') ? (
                  <button type="button" className="btn ghost" onClick={() => act({ type: 'check' })}>
                    Check
                  </button>
                ) : null}
                {legal.includes('call') ? (
                  <button type="button" className="btn" onClick={() => act({ type: 'call' })}>
                    Call
                  </button>
                ) : null}
                {legal.includes('raise') ? (
                  <button type="button" className="btn accent" onClick={() => act({ type: 'raise' })}>
                    {raiseActionLabel(snap)}
                  </button>
                ) : null}
              </div>
            ) : (snap.phase === 'betting' || snap.phase === 'draw') && !snap.humanMustAct ? (
              <div className="actions-waiting-wrap">
                <p className="actions-waiting muted" aria-live="polite">
                  Other players are acting…
                </p>
                {hero?.folded ? (
                  <button type="button" className="btn accent" onClick={skipToResult}>
                    Skip to result
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

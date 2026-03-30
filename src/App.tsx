import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import {
  StudEngine,
  type HumanAction,
  type SessionStats,
  type StudSnapshot,
  type TablePlayer,
} from './game/studEngine'
import type { Card } from './game/cards'
import { isRedSuit, rankDisplay, suitSymbol } from './game/cards'
import { handLabel, bestHandScore } from './game/pokerRank'
import { bestRazzLowScore, razzHandLabel } from './game/razzRank'
import { loadSettings, saveSettingsForGame } from './settings/storage'
import {
  DEFAULT_SETTINGS,
  GAME_LABELS,
  MAX_STARTING_STACK,
  MIN_STARTING_STACK,
  STAKES_BY_TIER,
  TEMPO_HANDS_BY_PRESET,
  type GameKind,
  type GameSettings,
} from './settings/types'
import './App.css'
import { playBettingSoundIfNew, unlockBettingAudio } from './audio/bettingSounds'
import { InstallAppBanner } from './pwa/InstallAppBanner'

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

/**
 * Opponent seats on an upper ellipse (no seats at bottom — hero sits there).
 * θ is standard math angle from +x; sin negative puts seats in upper half of felt.
 * `narrow` uses a slightly smaller vertical arc; horizontal spread stays close to
 * desktop so end seats still sit near the left/right edges (same feel as Mac).
 */
function opponentSeatPositions(
  count: number,
  narrow: boolean,
): { left: number; top: number }[] {
  if (count <= 0) return []
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

function usePlayTableLayout(): { narrow: boolean; aiPauseMs: number } {
  const [state, setState] = useState(() => ({
    narrow: false,
    aiPauseMs: 700,
  }))
  useEffect(() => {
    const mqNarrowWidth = window.matchMedia('(max-width: 560px)')
    const mqShortHeight = window.matchMedia('(max-height: 500px)')
    const apply = () => {
      /* Landscape phones are short; keep compact table/card sizing there too. */
      const narrow = mqNarrowWidth.matches || mqShortHeight.matches
      setState({
        narrow,
        aiPauseMs: narrow ? 520 : 680,
      })
    }
    mqNarrowWidth.addEventListener('change', apply)
    mqShortHeight.addEventListener('change', apply)
    window.addEventListener('resize', apply)
    apply()
    return () => {
      mqNarrowWidth.removeEventListener('change', apply)
      mqShortHeight.removeEventListener('change', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])
  return state
}

type BettingUi =
  | 'bring-in'
  | 'bet'
  | 'raise'
  | 'matched'
  | 'facing'
  | 'allin-facing'

function bettingState(
  snap: StudSnapshot,
  idx: number,
  p: TablePlayer,
): BettingUi | null {
  if (p.folded || snap.phase !== 'betting') return null
  const hb = snap.streetHighBet
  const c = p.streetCommit
  const bri = snap.bringInIndex

  if (hb === 0) return null

  if (c < hb) {
    return p.allIn ? 'allin-facing' : 'facing'
  }

  if (
    snap.street === 3 &&
    bri === idx &&
    snap.raisesThisStreet === 0 &&
    snap.lastAggressorSeat === null &&
    c > 0 &&
    c === hb
  ) {
    return 'bring-in'
  }

  if (snap.lastAggressorSeat === idx) {
    return snap.raisesThisStreet <= 1 ? 'bet' : 'raise'
  }

  if (c >= hb && hb > 0) return 'matched'

  return null
}

/** Human raise button: first aggression on the street is Bet (or Complete), later Raise. */
function raiseActionLabel(snap: StudSnapshot): string {
  if (snap.raisesThisStreet > 0) return 'Raise'
  if (snap.street === 3 && snap.stakes.bringIn < snap.stakes.smallBet) {
    return 'Complete'
  }
  return 'Bet'
}

function SessionStatsSummary({ stats }: { stats: SessionStats }) {
  if (stats.handsPlayed === 0) return null
  const winPct = Math.round((100 * stats.handsWon) / stats.handsPlayed)
  const foldPct = Math.round((100 * stats.handsFolded) / stats.handsPlayed)
  const sdWinPct =
    stats.showdownsContested > 0
      ? Math.round((100 * stats.showdownsWon) / stats.showdownsContested)
      : null
  const won = stats.handsWon
  const pctOfWonHands = (winsInBucket: number) =>
    won > 0 ? `${Math.round((100 * winsInBucket) / won)}%` : '—'

  return (
    <div className="session-stats-end">
      <h2 className="session-stats-end__title">Session stats</h2>
      <dl className="session-stats-end__dl">
        <div className="session-stats-end__row">
          <dt>Hands won</dt>
          <dd>
            {stats.handsWon} / {stats.handsPlayed} ({winPct}%)
          </dd>
        </div>
        <div className="session-stats-end__row">
          <dt>Hands folded</dt>
          <dd>
            {stats.handsFolded} ({foldPct}%)
          </dd>
        </div>
        <div className="session-stats-end__subhead">Wins by cards when you won</div>
        {([3, 4, 5, 6, 7] as const).map((n) => (
          <div key={n} className="session-stats-end__row session-stats-end__row--indent">
            <dt>{n} cards</dt>
            <dd>{stats.winsByHeroCardCount[n]}</dd>
          </div>
        ))}
        <div className="session-stats-end__subhead">Stayed in past 3rd–6th card</div>
        <p className="session-stats-end__hint muted">
          Share of pots you won where you still had at least 4–7 cards.
        </p>
        {(
          [
            [4, 'Past 3rd card (≥4 when you won)'],
            [5, 'Past 4th card (≥5)'],
            [6, 'Past 5th card (≥6)'],
            [7, 'Past 6th card (all seven)'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="session-stats-end__row session-stats-end__row--indent">
            <dt>{label}</dt>
            <dd>{pctOfWonHands(stats.winsAfterAtLeastCards[k])}</dd>
          </div>
        ))}
        <div className="session-stats-end__subhead">More</div>
        <div className="session-stats-end__row">
          <dt>Biggest single win</dt>
          <dd>{stats.biggestPotShareWon} chips</dd>
        </div>
        <div className="session-stats-end__row">
          <dt>Largest full pot you won</dt>
          <dd>{stats.biggestFullPotWhenWon} chips</dd>
        </div>
        <div className="session-stats-end__row">
          <dt>Total won from pots</dt>
          <dd>{stats.totalChipsWonFromPots} chips</dd>
        </div>
        <div className="session-stats-end__row">
          <dt>Showdowns</dt>
          <dd>
            {stats.showdownsWon} won / {stats.showdownsContested}
            {sdWinPct !== null ? ` (${sdWinPct}%)` : ''}
          </dd>
        </div>
      </dl>
    </div>
  )
}

type Screen = 'menu' | 'settings' | 'play'

interface ActiveGame {
  gameKind: GameKind
  engine: StudEngine
  snap: StudSnapshot
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [selectedGame, setSelectedGame] = useState<GameKind>('stud')
  const [settingsByGame, setSettingsByGame] = useState<Record<GameKind, GameSettings>>(() => ({
    stud: loadSettings('stud'),
    razz: loadSettings('razz'),
  }))
  const [game, setGame] = useState<ActiveGame | null>(null)
  const activeSettings = settingsByGame[selectedGame]

  const refresh = useCallback(() => {
    setGame((g) => (g ? { gameKind: g.gameKind, engine: g.engine, snap: g.engine.snapshot() } : null))
  }, [])

  const startGame = useCallback((gameKind: GameKind) => {
    unlockBettingAudio()
    const engine = new StudEngine(settingsByGame[gameKind], gameKind)
    engine.startSession()
    engine.beginHand()
    setGame({ gameKind, engine, snap: engine.snapshot() })
    setScreen('play')
  }, [settingsByGame])

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
        onSave={(next) => applySettings(selectedGame, next)}
        onCancel={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'play' && game) {
    return (
      <PlayScreen
        game={game}
        onRefresh={refresh}
        onQuit={() => {
          setGame(null)
          setScreen('menu')
        }}
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
            {(['stud', 'razz'] as const).map((gameKind) => (
              <div key={gameKind} className="menu-game-row">
                <button
                  type="button"
                  className={['btn', selectedGame === gameKind ? 'primary' : 'ghost'].join(' ')}
                  onClick={() => {
                    setSelectedGame(gameKind)
                    startGame(gameKind)
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
          </div>
        </div>
        <section className="menu-meta">
          <h2>Current setup ({GAME_LABELS[selectedGame]})</h2>
          <ul>
            <li>Opponents: {activeSettings.opponentCount}</li>
            <li>Difficulty: {activeSettings.difficulty}</li>
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
  onSave,
  onCancel,
}: {
  gameKind: GameKind
  initial: GameSettings
  onSave: (s: GameSettings) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<GameSettings>(initial)
  const [startingStackInput, setStartingStackInput] = useState(() =>
    String(initial.startingStack),
  )
  const startingStackError = startingStackFieldError(startingStackInput)
  const startingStackValid = startingStackError === null

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
        }}
      >
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
  onRefresh,
  onQuit,
}: {
  game: ActiveGame
  onRefresh: () => void
  onQuit: () => void
}) {
  const { engine, snap } = game
  const gameName = GAME_LABELS[game.gameKind]
  const { narrow: narrowTable, aiPauseMs } = usePlayTableLayout()
  const [aiDrive, setAiDrive] = useState(0)

  useEffect(() => {
    const onFirstTouch = () => unlockBettingAudio()
    window.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true })
    return () => window.removeEventListener('pointerdown', onFirstTouch)
  }, [])

  useEffect(() => {
    if (
      snap.phase !== 'betting' ||
      snap.humanMustAct ||
      snap.actionIndex === null
    ) {
      return
    }
    const id = window.setTimeout(() => {
      const before = engine.snapshot().bettingSoundNonce
      engine.stepAiOnce()
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
  const oppPositions = useMemo(
    () => opponentSeatPositions(opponentCount, narrowTable),
    [opponentCount, narrowTable],
  )

  if (snap.phase === 'youBusted' || snap.phase === 'youWonTable') {
    return (
      <div className="app shell end-screen">
        <h1>{snap.phase === 'youBusted' ? 'Game over' : 'You won the table'}</h1>
        <p className="end-screen__message">{snap.message}</p>
        <SessionStatsSummary stats={snap.sessionStats} />
        <div className="form-actions form-actions--center">
          <button type="button" className="btn primary" onClick={onQuit}>
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

  const betLabels: Record<BettingUi, string> = {
    'bring-in': 'Bring-in',
    bet: 'Bet',
    raise: 'Raise',
    matched: 'Matched',
    facing: 'To call',
    'allin-facing': 'All-in',
  }

  const renderSeat = (p: (typeof snap.players)[0], idx: number, heroSeat: boolean) => {
    const isDealer = idx === snap.dealerIndex
    const isActor = idx === snap.actionIndex && snap.phase === 'betting'
    const b = bettingState(snap, idx, p)
    const hb = snap.streetHighBet
    const owe = hb > p.streetCommit ? hb - p.streetCommit : 0
    const showHoleFaces = p.isHuman || showAllHoles
    const oppOrSummaryLine = (
      <div
        className="hand-zone hand-zone--hero-line"
        aria-label={
          showHoleFaces ? 'All cards' : 'Opponent cards: down cards hidden'
        }
      >
        <div className="cards-row cards-row--hero-line">
          {heroCardsInTableOrder(p.hole, p.up).map(({ card, faceKind, sunk }, i) =>
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
            {heroCardsInTableOrder(p.hole, p.up).map(({ card, faceKind, sunk }, i) => (
              <PlayingCardFace key={i} c={card} kind={faceKind} sunk={sunk} />
            ))}
          </div>
        </div>
      ) : null
    const best =
      showAllHoles && !p.folded
        ? game.gameKind === 'stud'
          ? bestHandScore([...p.hole, ...p.up])
          : bestRazzLowScore([...p.hole, ...p.up])
        : null
    let bestText: string | null = null
    if (best) {
      bestText =
        game.gameKind === 'stud'
          ? handLabel(best as NonNullable<ReturnType<typeof bestHandScore>>)
          : razzHandLabel(best as NonNullable<ReturnType<typeof bestRazzLowScore>>)
    }
    return (
      <div
        className={[
          'player-card',
          isActor ? 'acting' : '',
          p.folded ? 'folded' : '',
          heroSeat ? 'player-card--hero' : '',
          b === 'bet' || b === 'bring-in' ? 'player-card--opened' : '',
          b === 'raise' ? 'player-card--raised' : '',
          b === 'matched' ? 'player-card--matched' : '',
          b === 'facing' || b === 'allin-facing' ? 'player-card--facing-call' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="player-head">
          <span>{p.name}</span>
          {isDealer ? <span className="dealer-pill">D</span> : null}
          {p.folded ? <span className="fold-pill">Fold</span> : null}
        </div>
        {b ? (
          <div className={`bet-status bet-status--${b}`}>
            {betLabels[b]}
            {b === 'facing' && owe > 0 ? ` ${owe}` : ''}
          </div>
        ) : null}
        {snap.phase === 'betting' && p.streetCommit > 0 ? (
          <div className="street-chips">Round: {p.streetCommit}</div>
        ) : null}
        <div className="stack">Stack {p.stack}</div>
        {heroSeat ? heroLine : oppOrSummaryLine}
        {bestText ? <div className="best-hand">{bestText}</div> : null}
      </div>
    )
  }

  return (
    <div className="app play">
      <header className="play-bar">
        <div>
          <strong>Hand {snap.handNumber}</strong>
          <span className="muted"> · {gameName} · Level {snap.level}</span>
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
        className={['play-table-column', narrowTable ? 'play-table-column--narrow' : '']
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
                    className="seat seat--opp"
                    style={
                      {
                        left: `${pos.left}%`,
                        top: `${pos.top}%`,
                      } as CSSProperties
                    }
                  >
                    {renderSeat(p, idx, false)}
                  </div>
                )
              })}
            </div>
            {hero && heroIdx >= 0 ? (
              <div className="seat seat--hero">{renderSeat(hero, heroIdx, true)}</div>
            ) : null}
          </div>
        </div>

        <div className="under-felt">
          <div className="street-pill">
            {snap.phase === 'betting'
              ? `${gameName} · Street ${snap.street} · Ante ${snap.stakes.ante} · Small ${snap.stakes.smallBet} · Big ${snap.stakes.bigBet}`
              : snap.phase}
          </div>

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
            ) : snap.phase === 'betting' && !snap.humanMustAct ? (
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

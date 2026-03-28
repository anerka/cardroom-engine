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
  type StudSnapshot,
  type TablePlayer,
} from './game/studEngine'
import type { Card } from './game/cards'
import { isRedSuit, rankDisplay, suitSymbol } from './game/cards'
import { handLabel, bestHandScore } from './game/pokerRank'
import { loadSettings, saveSettings } from './settings/storage'
import {
  DEFAULT_SETTINGS,
  STAKES_BY_TIER,
  TEMPO_HANDS_BY_PRESET,
  type GameSettings,
} from './settings/types'
import './App.css'

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
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const theta = start + (end - start) * t
    let left = cx + rx * Math.cos(theta)
    let top = cy + ry * Math.sin(theta)
    if (narrow) {
      top = Math.min(38, Math.max(14, top))
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
    const mq = window.matchMedia('(max-width: 560px)')
    const apply = () => {
      const narrow = mq.matches
      setState({
        narrow,
        aiPauseMs: narrow ? 520 : 680,
      })
    }
    mq.addEventListener('change', apply)
    apply()
    return () => mq.removeEventListener('change', apply)
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

type Screen = 'menu' | 'settings' | 'play'

interface ActiveGame {
  engine: StudEngine
  snap: StudSnapshot
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings())
  const [game, setGame] = useState<ActiveGame | null>(null)

  const refresh = useCallback(() => {
    setGame((g) => (g ? { engine: g.engine, snap: g.engine.snapshot() } : null))
  }, [])

  const startGame = useCallback(() => {
    const engine = new StudEngine(settings)
    engine.startSession()
    engine.beginHand()
    setGame({ engine, snap: engine.snapshot() })
    setScreen('play')
  }, [settings])

  const applySettings = useCallback((next: GameSettings) => {
    setSettings(next)
    saveSettings(next)
    setScreen('menu')
  }, [])

  if (screen === 'settings') {
    return (
      <SettingsScreen
        initial={settings}
        onSave={applySettings}
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
          <h1>Seven Card Stud</h1>
          <p className="tagline">
            Ante, bring-in, fixed limit — play money only.
          </p>
        </header>
        <div className="menu-actions-wrap">
          <div className="menu-main menu-main--actions">
            <button type="button" className="btn primary" onClick={startGame}>
              New table
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setScreen('settings')}
            >
              Settings
            </button>
          </div>
        </div>
        <section className="menu-meta">
          <h2>Current setup</h2>
          <ul>
            <li>Opponents: {settings.opponentCount}</li>
            <li>Difficulty: {settings.difficulty}</li>
            <li>
              Tempo:{' '}
              {settings.useAdvancedTempo
                ? `${settings.handsPerLevel} hands / level`
                : settings.tempoPreset}
            </li>
            <li>Stakes: {settings.stakes}</li>
            <li>Starting stack (each): {settings.startingStack}</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function SettingsScreen({
  initial,
  onSave,
  onCancel,
}: {
  initial: GameSettings
  onSave: (s: GameSettings) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<GameSettings>(initial)

  return (
    <div className="app shell settings-screen">
      <header className="topbar">
        <h1>Settings</h1>
      </header>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(draft)
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
              setDraft((d) => ({
                ...d,
                stakes,
                startingStack: STAKES_BY_TIER[stakes].startingStack,
              }))
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
            type="number"
            min={20}
            max={9999999}
            step={10}
            value={draft.startingStack}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                startingStack: Math.max(
                  20,
                  Math.min(9_999_999, Number(e.target.value) || DEFAULT_SETTINGS.startingStack),
                ),
              }))
            }
          />
          <span className="hint">
            (Tier default: {STAKES_BY_TIER[draft.stakes].startingStack})
          </span>
        </label>

        <p className="stakes-preview">
          Ante {STAKES_BY_TIER[draft.stakes].ante} · Small{' '}
          {STAKES_BY_TIER[draft.stakes].smallBet} · Big{' '}
          {STAKES_BY_TIER[draft.stakes].bigBet}
        </p>

        <div className="form-actions">
          <button type="submit" className="btn primary">
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
  const { narrow: narrowTable, aiPauseMs } = usePlayTableLayout()
  const [aiDrive, setAiDrive] = useState(0)

  useEffect(() => {
    if (
      snap.phase !== 'betting' ||
      snap.humanMustAct ||
      snap.actionIndex === null
    ) {
      return
    }
    const id = window.setTimeout(() => {
      engine.stepAiOnce()
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

  const legal = snap.humanMustAct ? engine.legalHumanActions() : []

  const act = (a: HumanAction) => {
    engine.applyHuman(a)
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
        <p>{snap.message}</p>
        <div className="form-actions">
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
      showAllHoles && !p.folded ? bestHandScore([...p.hole, ...p.up]) : null
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
        {best ? <div className="best-hand">{handLabel(best)}</div> : null}
      </div>
    )
  }

  return (
    <div className="app play">
      <header className="play-bar">
        <div>
          <strong>Hand {snap.handNumber}</strong>
          <span className="muted"> · Level {snap.level}</span>
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
              ? `Street ${snap.street} · Ante ${snap.stakes.ante} · Small ${snap.stakes.smallBet} · Big ${snap.stakes.bigBet}`
              : snap.phase}
          </div>

          {snap.phase === 'handSummary' ? (
            <div className="summary-panel">
              <p>{snap.lastSummary}</p>
              <button type="button" className="btn primary" onClick={continueHand}>
                Next hand
              </button>
            </div>
          ) : null}

          <div className="actions-slot">
            {snap.humanMustAct ? (
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

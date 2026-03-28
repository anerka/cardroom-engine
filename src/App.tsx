import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  StudEngine,
  type HumanAction,
  type StudSnapshot,
  type TablePlayer,
} from './game/studEngine'
import { formatCard } from './game/cards'
import { handLabel, bestHandScore } from './game/pokerRank'
import { loadSettings, saveSettings } from './settings/storage'
import {
  DEFAULT_SETTINGS,
  STAKES_BY_TIER,
  TEMPO_HANDS_BY_PRESET,
  type GameSettings,
} from './settings/types'
import './App.css'

/** Pause between each bot action so the table state is readable (ms). */
const AI_ACTION_PAUSE_MS = 820

/**
 * Opponent seats on an upper ellipse (no seats at bottom — hero sits there).
 * θ is standard math angle from +x; sin negative puts seats in upper half of felt.
 */
function opponentSeatPositions(count: number): { left: number; top: number }[] {
  if (count <= 0) return []
  const start = (-168 * Math.PI) / 180
  const end = (-12 * Math.PI) / 180
  const cx = 50
  /* Lower arc so top seat stays on green; tuned with .felt padding + .seats-ring */
  const cy = 41
  const rx = 42
  const ry = 25
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const theta = start + (end - start) * t
    return {
      left: cx + rx * Math.cos(theta),
      top: cy + ry * Math.sin(theta),
    }
  })
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
    <div className="app shell">
      <header className="topbar">
        <h1>Seven Card Stud</h1>
        <p className="tagline">
          Ante, bring-in, fixed limit — play money only.
        </p>
      </header>
      <main className="menu-main">
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
            <li>
              Starting stack: {STAKES_BY_TIER[settings.stakes].startingStack}
            </li>
          </ul>
        </section>
      </main>
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
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                stakes: e.target.value as GameSettings['stakes'],
              }))
            }
          >
            <option value="low">Low</option>
            <option value="mid">Mid</option>
            <option value="high">High</option>
          </select>
        </label>

        <p className="stakes-preview">
          Ante {STAKES_BY_TIER[draft.stakes].ante} · Small{' '}
          {STAKES_BY_TIER[draft.stakes].smallBet} · Big{' '}
          {STAKES_BY_TIER[draft.stakes].bigBet} · Stack{' '}
          {STAKES_BY_TIER[draft.stakes].startingStack}
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
    }, AI_ACTION_PAUSE_MS)
    return () => window.clearTimeout(id)
  }, [engine, onRefresh, snap.actionIndex, snap.humanMustAct, snap.phase])

  const legal = snap.humanMustAct ? engine.legalHumanActions() : []

  const act = (a: HumanAction) => {
    engine.applyHuman(a)
    onRefresh()
  }

  const continueHand = () => {
    engine.acknowledgeHandSummary()
    onRefresh()
  }

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
  const oppPositions = opponentSeatPositions(opponents.length)

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
    const hole =
      p.isHuman || showAllHoles
        ? p.hole.map((c, i) => (
            <span key={i} className="card hole">
              {formatCard(c)}
            </span>
          ))
        : p.hole.map((_, i) => (
            <span key={i} className="card back">
              ●
            </span>
          ))
    const up = p.up.map((c, i) => (
      <span key={i} className="card up">
        {formatCard(c)}
      </span>
    ))
    const holeLabel =
      p.isHuman || showAllHoles ? 'Hole cards' : 'Hidden'
    const upZone = (
      <div
        className="hand-zone hand-zone--up"
        aria-label="Up cards, visible to all"
      >
        <span className="hand-zone-label">Up</span>
        <div className="cards-row cards-row--spread">{up}</div>
      </div>
    )
    const holeZone = (
      <div
        className="hand-zone hand-zone--hole"
        aria-label={
          p.isHuman || showAllHoles
            ? 'Your hole cards'
            : 'Opponent hole cards, not visible'
        }
      >
        <span className="hand-zone-label">{holeLabel}</span>
        <div className="cards-row cards-row--hole-pocket">{hole}</div>
      </div>
    )
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
        <div className="hand-zones">
          {heroSeat ? (
            <>
              {upZone}
              {holeZone}
            </>
          ) : (
            <>
              {holeZone}
              {upZone}
            </>
          )}
        </div>
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

      <div className="play-table-column">
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
                  {snap.street === 3 && snap.stakes.bringIn < snap.stakes.smallBet
                    ? 'Complete / Raise'
                    : 'Raise'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

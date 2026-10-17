import { StudEngine, type HumanAction, type StudSnapshot } from '../game/studEngine'
import { DEFAULT_SETTINGS, type GameKind, type GameSettings } from '../settings/types'
import { GAME_ORDER } from '../stats/career'
import {
  clearActiveSession,
  loadActiveSession,
  parseSavedSession,
  restoreActiveTable,
  saveActiveSession,
  sessionFromActive,
  type SessionStore,
} from './resume'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function memoryStore(): SessionStore {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function settingsFor(kind: GameKind): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    opponentCount: kind === 'deuce7' || kind === 'badugi' ? 2 : 1,
    difficulty: 'easy',
  }
}

function autoAct(engine: StudEngine): boolean {
  const snap = engine.snapshot()
  if (snap.phase !== 'betting' && snap.phase !== 'draw') return false
  if (snap.humanMustAct) {
    const actions = engine.legalHumanActions()
    let next: HumanAction | null = null
    if (actions.includes('check')) next = { type: 'check' }
    else if (actions.includes('call')) next = { type: 'call' }
    else if (actions.includes('draw')) next = { type: 'draw', count: 0 }
    else if (actions.includes('fold')) next = { type: 'fold' }
    if (!next) return false
    engine.applyHuman(next)
    return true
  }
  if (snap.actionIndex === null) {
    engine.resolveIdleAction()
    return true
  }
  return engine.stepAiOnce()
}

function fingerprint(snap: StudSnapshot): string {
  return JSON.stringify({
    phase: snap.phase,
    street: snap.street,
    pot: snap.pot,
    handNumber: snap.handNumber,
    actionIndex: snap.actionIndex,
    humanMustAct: snap.humanMustAct,
    streetHighBet: snap.streetHighBet,
    players: snap.players.map((p) => ({
      id: p.id,
      stack: p.stack,
      folded: p.folded,
      hole: p.hole,
      up: p.up,
      streetCommit: p.streetCommit,
      contributedPot: p.contributedPot,
    })),
  })
}

function roundTrip(engine: StudEngine, sessionId: number, challenge: { index: number } | null) {
  const before = engine.toPersistable()
  const session = sessionFromActive({
    sessionId,
    gameKind: engine.gameKind,
    challenge,
    careerRecorded: false,
    engine,
  })
  const raw = JSON.stringify(session)
  const parsed = parseSavedSession(raw)
  assert(parsed, `rejected a live ${engine.gameKind} hand`)
  assert(parsed.gameKind === engine.gameKind, 'game kind drifted')
  assert(JSON.stringify(parsed.challenge) === JSON.stringify(challenge), 'challenge drifted')
  const restored = StudEngine.restore(parsed.engine, mulberry32(1))
  const after = restored.toPersistable()
  assert(JSON.stringify(before.deck) === JSON.stringify(after.deck), 'deck changed across resume')
  assert(JSON.stringify(before.players) === JSON.stringify(after.players), 'players changed across resume')
  assert(before.pot === after.pot && before.street === after.street, 'pot or street changed')
  assert(before.phase === after.phase && before.actionIndex === after.actionIndex, 'turn changed')
  assert(before.highBet === after.highBet && before.checkRound === after.checkRound, 'betting round changed')
  assert(JSON.stringify(before.checkPending) === JSON.stringify(after.checkPending), 'check pending changed')
  assert(JSON.stringify(before.drawPending) === JSON.stringify(after.drawPending), 'draw pending changed')
  assert(fingerprint(engine.snapshot()) === fingerprint(restored.snapshot()), 'snapshot changed')
  const again = parseSavedSession(JSON.stringify(sessionFromActive({
    sessionId,
    gameKind: restored.gameKind,
    challenge,
    careerRecorded: false,
    engine: restored,
  })))
  assert(again && JSON.stringify(again) === JSON.stringify(parsed), 'resume encoding is not stable')
  return restored
}

function playChecked(kind: GameKind, seed: number): void {
  const engine = new StudEngine(settingsFor(kind), kind, mulberry32(seed))
  engine.startSession()
  engine.beginHand()
  let handsFinished = 0
  let steps = 0
  while (steps < 1500 && handsFinished < 2) {
    const phase = engine.snapshot().phase
    if (phase === 'youWonTable' || phase === 'youBusted') break
    roundTrip(engine, 3, kind === 'stud' ? { index: 0 } : null)
    if (phase === 'handSummary') {
      engine.acknowledgeHandSummary()
      handsFinished += 1
      steps += 1
      continue
    }
    const progressed = autoAct(engine)
    assert(progressed, `${kind} stalled on seed ${seed} at ${phase}`)
    steps += 1
  }
  assert(steps > 0, `${kind} never acted`)
}

function resumeThenFinish(kind: GameKind): void {
  const engine = new StudEngine(settingsFor(kind), kind, mulberry32(8))
  engine.startSession()
  engine.beginHand()
  for (let i = 0; i < 4; i++) {
    if (!autoAct(engine)) break
  }
  const restored = roundTrip(engine, 9, null)
  const store = memoryStore()
  saveActiveSession(
    sessionFromActive({
      sessionId: 9,
      gameKind: kind,
      challenge: null,
      careerRecorded: true,
      engine: restored,
    }),
    store,
  )
  const loaded = restoreActiveTable(store)
  assert(loaded, 'stored hand did not load')
  assert(loaded.careerRecorded === true, 'career flag dropped')
  assert(loaded.sessionId === 9, 'session id dropped')
  let guard = 0
  while (guard < 1500) {
    const phase = loaded.engine.snapshot().phase
    if (phase === 'handSummary' || phase === 'youWonTable' || phase === 'youBusted') break
    assert(autoAct(loaded.engine), `${kind} could not finish after resume`)
    guard += 1
  }
  const phase = loaded.engine.snapshot().phase
  assert(
    phase === 'handSummary' || phase === 'youWonTable' || phase === 'youBusted',
    `${kind} did not reach a stopping point after resume (${phase})`,
  )
  clearActiveSession(store)
  assert(loadActiveSession(store) === null, 'cleared session still loads')
  assert(restoreActiveTable(store) === null, 'cleared session still restores')
}

function rejectsGarbage(): void {
  assert(parseSavedSession('not-json') === null, 'accepted invalid json')
  assert(parseSavedSession('{"version":1}') === null, 'accepted a partial session')
  const engine = new StudEngine(settingsFor('stud'), 'stud', mulberry32(2))
  engine.startSession()
  engine.beginHand()
  const session = sessionFromActive({
    sessionId: 1,
    gameKind: 'stud',
    challenge: null,
    careerRecorded: false,
    engine,
  })
  session.engine.players[0].hole.push({ ...session.engine.deck[0] })
  assert(parseSavedSession(JSON.stringify(session)) === null, 'accepted a duplicated card')
}

for (const kind of GAME_ORDER) {
  playChecked(kind, 1)
  playChecked(kind, 17)
  resumeThenFinish(kind)
}
rejectsGarbage()
console.log('resume self-check ok')

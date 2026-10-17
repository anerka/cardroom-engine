import {
  playBettingSound,
  setBettingSoundEnabled,
  settleBettingAudio,
  unlockBettingAudio,
} from './bettingSounds'

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message)
}

const session = { type: 'auto' }
Object.defineProperty(globalThis.navigator, 'audioSession', {
  configurable: true,
  writable: true,
  value: session,
})

const stats = {
  constructed: 0,
  closed: 0,
  started: 0,
  fetches: 0,
  typeWhenCreated: null as string | null,
}

class FakeAudioContext {
  state = 'suspended'
  destination = {}
  constructor() {
    stats.constructed += 1
    stats.typeWhenCreated = session.type
  }
  resume(): Promise<void> {
    this.state = 'running'
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    stats.closed += 1
    return Promise.resolve()
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 0.2 } as AudioBuffer)
  }
  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      connect() {},
      start() {
        stats.started += 1
      },
    } as unknown as AudioBufferSourceNode
  }
}

globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
globalThis.Audio = function HtmlAudioShouldNotBeUsed(): HTMLAudioElement {
  throw new Error('HTML audio uses the playback session and ducks other music')
} as unknown as typeof Audio
globalThis.fetch = (async () => {
  stats.fetches += 1
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }
}) as unknown as typeof fetch

setBettingSoundEnabled(false)
unlockBettingAudio()
playBettingSound('chips')
playBettingSound('raise')
await settleBettingAudio()
assert(stats.constructed === 0, 'sounds off still started an audio context')
assert(stats.fetches === 0, 'sounds off still fetched a clip')
assert(stats.started === 0, 'sounds off still played a clip')
assert(session.type === 'auto', 'sounds off changed the audio session')

setBettingSoundEnabled(true)
unlockBettingAudio()
await settleBettingAudio()
assert(stats.constructed === 1, 'sounds on did not start one mixable context')
assert(stats.typeWhenCreated === 'ambient', `context was created under ${stats.typeWhenCreated}, not ambient`)
assert(session.type === 'ambient', 'page session was not ambient while sounds are on')
assert(stats.fetches === 2, `expected both clips fetched, got ${stats.fetches}`)

playBettingSound('chips')
await settleBettingAudio()
assert(stats.started === 1, 'a chip sound did not play')
assert(session.type === 'ambient', 'playing a sound left the ambient session')

setBettingSoundEnabled(false)
await settleBettingAudio()
assert(stats.closed === 1, 'turning sounds off left the audio context running')
assert(session.type === 'auto', 'turning sounds off did not release the audio session')
const startedAfterOff = stats.started
playBettingSound('raise')
await settleBettingAudio()
assert(stats.started === startedAfterOff, 'a sound played after sounds were turned off')
assert(stats.constructed === 1, 'sounds off created another audio context')

setBettingSoundEnabled(true)
playBettingSound('raise')
await settleBettingAudio()
assert(stats.constructed === 2, 'turning sounds back on did not make a new mixable context')
assert(stats.typeWhenCreated === 'ambient', 'the new context was not ambient')
assert(stats.started === startedAfterOff + 1, 'a raise did not play after re-enabling sound')

console.log('betting audio self-check ok')

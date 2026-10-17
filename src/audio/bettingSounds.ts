import type { BettingSound } from '../game/studEngine'

const url = (file: string) => `${import.meta.env.BASE_URL}sounds/${file}`

/**
 * An <audio> element uses the platform "playback" session, which ducks or
 * pauses Spotify. Short game sounds use an AudioContext instead, and the
 * page session is set to ambient so they mix at the listener's current volume.
 * With sounds off, nothing here is constructed, so other music is left alone.
 */
type AudioSessionLike = { type: string }

let soundsEnabled = true
let ctx: AudioContext | null = null
const buffers = new Map<BettingSound, AudioBuffer>()
let pending = Promise.resolve()

function track(work: Promise<unknown>): void {
  pending = pending.then(() => work).then(
    () => undefined,
    () => undefined,
  )
}

/** Resolves after in-flight load, resume, and shutdown work. */
export function settleBettingAudio(): Promise<void> {
  return pending
}

function audioSession(): AudioSessionLike | null {
  const session = (globalThis.navigator as Navigator & { audioSession?: AudioSessionLike } | undefined)
    ?.audioSession
  return session ?? null
}

function preferAmbient(): void {
  const session = audioSession()
  if (!session || session.type === 'ambient') return
  try {
    session.type = 'ambient'
  } catch {
    /* The platform picks a session on its own. */
  }
}

function releaseSession(): void {
  const session = audioSession()
  if (!session || session.type === 'auto') return
  try {
    session.type = 'auto'
  } catch {
    /* ignore */
  }
}

function audioContextCtor(): (new (options?: AudioContextOptions) => AudioContext) | null {
  const g = globalThis as typeof globalThis & {
    AudioContext?: new (options?: AudioContextOptions) => AudioContext
    webkitAudioContext?: new (options?: AudioContextOptions) => AudioContext
  }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

function createContext(): AudioContext | null {
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  preferAmbient()
  try {
    return new Ctor({ latencyHint: 'interactive' })
  } catch {
    try {
      return new Ctor()
    } catch {
      return null
    }
  }
}

function liveContext(): AudioContext | null {
  if (!soundsEnabled) return null
  if (ctx && ctx.state !== 'closed') return ctx
  ctx = createContext()
  return ctx
}

async function loadBuffer(kind: BettingSound, context: AudioContext): Promise<AudioBuffer | null> {
  const cached = buffers.get(kind)
  if (cached) return cached
  try {
    const src = kind === 'chips' ? url('PokerAction.wav') : url('PokerRaise.mp3')
    const response = await fetch(src)
    if (!response.ok) return null
    const raw = await response.arrayBuffer()
    const copy = raw.slice(0)
    const decoded = await context.decodeAudioData(copy)
    if (!soundsEnabled || ctx !== context || context.state === 'closed') return null
    buffers.set(kind, decoded)
    return decoded
  } catch {
    return null
  }
}

function playBuffer(buffer: AudioBuffer): void {
  if (!soundsEnabled) return
  const context = liveContext()
  if (!context || context.state === 'closed') return
  try {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start()
  } catch {
    /* Context closed or playback was blocked. */
  }
}

async function shutdownAudio(): Promise<void> {
  const current = ctx
  ctx = null
  buffers.clear()
  if (current && current.state !== 'closed') {
    try {
      await current.close()
    } catch {
      /* already closed */
    }
  }
  releaseSession()
}

export function setBettingSoundEnabled(enabled: boolean): void {
  soundsEnabled = enabled
  if (!enabled) track(shutdownAudio())
}

/**
 * Call from a tap or click while sounds are on. Resumes the mixable audio
 * context so a later bot action can play. Does nothing while sounds are off.
 */
export function unlockBettingAudio(): void {
  if (!soundsEnabled) return
  const context = liveContext()
  if (!context) return
  if (context.state === 'suspended') {
    try {
      track(context.resume())
    } catch {
      /* ignore */
    }
  }
  if (!buffers.has('chips')) track(loadBuffer('chips', context))
  if (!buffers.has('raise')) track(loadBuffer('raise', context))
}

/** Plays bet/call (chips) or raise-over (raise). Silent while sounds are off. */
export function playBettingSound(kind: BettingSound): void {
  if (!soundsEnabled) return
  const context = liveContext()
  if (!context) return
  if (context.state === 'suspended') {
    try {
      track(context.resume())
    } catch {
      /* ignore */
    }
  }
  const cached = buffers.get(kind)
  if (!cached) {
    track(
      loadBuffer(kind, context).then((buffer) => {
        if (buffer) playBuffer(buffer)
      }),
    )
    return
  }
  playBuffer(cached)
}

/** If the engine emitted a new betting sound since `beforeNonce`, play it. */
export function playBettingSoundIfNew(
  beforeNonce: number,
  afterNonce: number,
  kind: BettingSound | null,
): void {
  if (afterNonce > beforeNonce && kind) playBettingSound(kind)
}

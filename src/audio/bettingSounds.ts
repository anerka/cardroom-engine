import type { BettingSound } from '../game/studEngine'

const url = (file: string) => `${import.meta.env.BASE_URL}sounds/${file}`

const cache = new Map<BettingSound, HTMLAudioElement>()

let audioUnlocked = false
let soundsEnabled = true

export function setBettingSoundEnabled(enabled: boolean): void {
  soundsEnabled = enabled
}

function getAudio(kind: BettingSound): HTMLAudioElement {
  let a = cache.get(kind)
  if (!a) {
    const src = kind === 'chips' ? url('PokerAction.wav') : url('PokerRaise.mp3')
    a = new Audio(src)
    a.preload = 'auto'
    /* Helps some mobile WebViews treat clip as user-media-capable */
    a.setAttribute('playsinline', 'true')
    cache.set(kind, a)
  }
  return a
}

/**
 * Run once inside a user gesture (tap/click). Mobile Safari/Chrome block
 * `Audio.play()` until the document has been “unlocked” this way.
 */
export function unlockBettingAudio(): void {
  if (audioUnlocked) return
  audioUnlocked = true
  for (const kind of ['chips', 'raise'] as BettingSound[]) {
    const a = getAudio(kind)
    const v = a.volume
    a.volume = 0.0001
    void a
      .play()
      .then(() => {
        a.pause()
        a.currentTime = 0
        a.volume = v
      })
      .catch(() => {
        a.volume = v
      })
  }
}

/** Plays bet/call (chips) or raise-over (raise) SFX. Prefer calling right after a user tap or after unlock. */
export function playBettingSound(kind: BettingSound): void {
  if (!soundsEnabled) return
  const a = getAudio(kind)
  try {
    a.currentTime = 0
    void a.play().catch(() => {
      /* autoplay policy / missing file */
    })
  } catch {
    /* ignore */
  }
}

/** If the engine emitted a new betting sound since `beforeNonce`, play it (call synchronously after apply/step). */
export function playBettingSoundIfNew(
  beforeNonce: number,
  afterNonce: number,
  kind: BettingSound | null,
): void {
  if (afterNonce > beforeNonce && kind) playBettingSound(kind)
}

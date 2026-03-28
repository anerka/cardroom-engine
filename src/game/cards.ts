export type Suit = 'c' | 'd' | 'h' | 's'

export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export const RANK_ORDER: Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
]

/** Lower index = lower suit; used for bring-in tiebreak (clubs lowest). */
export const SUIT_ORDER: Suit[] = ['c', 'd', 'h', 's']

export function rankIndex(r: Rank): number {
  return RANK_ORDER.indexOf(r)
}

export function suitIndex(s: Suit): number {
  return SUIT_ORDER.indexOf(s)
}

export function compareDoorForBringIn(a: Card, b: Card): number {
  const dr = rankIndex(a.rank) - rankIndex(b.rank)
  if (dr !== 0) return dr
  return suitIndex(a.suit) - suitIndex(b.suit)
}

export function isRedSuit(s: Suit): boolean {
  return s === 'h' || s === 'd'
}

export function suitSymbol(s: Suit): string {
  return s === 'c' ? '♣' : s === 'd' ? '♦' : s === 'h' ? '♥' : '♠'
}

/** Rank as shown on screen (ten = "10"). */
export function rankDisplay(r: Rank): string {
  return r === 'T' ? '10' : r
}

export function formatCard(c: Card): string {
  return `${rankDisplay(c.rank)}${suitSymbol(c.suit)}`
}

export function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUIT_ORDER) {
    for (const r of RANK_ORDER) {
      deck.push({ rank: r, suit: s })
    }
  }
  return deck
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

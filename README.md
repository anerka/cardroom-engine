# Cardroom Engine

Single-player stud poker engine supporting multiple game variants against AI opponents. Built with **Vite**, **React 19**, and **TypeScript**.

Clone it, run it locally, and add new game variants with minimal friction — the engine is structured so each game is defined by its ranking logic and a handful of flags in the central engine.

## Getting started

```bash
npm install
npm run dev       # dev server at localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the build locally
```

## Project structure

```
src/
├── game/
│   ├── studEngine.ts     # Core engine: betting rounds, streets, showdown, AI turns
│   ├── cards.ts          # Deck, shuffle, card formatting, bring-in sort
│   ├── pokerRank.ts      # High-hand ranking (used by Seven Card Stud)
│   ├── razzRank.ts       # A-5 low ranking with pair penalty (used by Razz)
│   ├── hiloRank.ts       # 8-or-better low qualifier (used by Stud Hi/Lo)
│   ├── ai.ts             # AI action selection (fold/call/raise thresholds)
│   ├── studEquity.ts     # Equity estimation for each variant (feeds AI)
│   └── sidePots.ts       # Side pot calculation for all-in scenarios
├── settings/
│   ├── types.ts          # GameKind, GameSettings, stakes tiers, tempo presets
│   └── storage.ts        # localStorage persistence
├── audio/
│   └── bettingSounds.ts  # Sound effects for betting actions
├── pwa/
│   └── InstallAppBanner.tsx
├── App.tsx               # UI: table, cards, action buttons, settings panel
└── main.tsx
```

To add a new game variant:

1. Add its key to `GameKind` in `settings/types.ts` and a label to `GAME_LABELS`.
2. Write a ranking module in `game/` (see `razzRank.ts` as the simplest example).
3. Wire the showdown logic into `studEngine.ts` — search for `GameKind` switch blocks.
4. Add equity estimation in `studEquity.ts` so the AI knows what it's aiming for.

## Games implemented

### Seven Card Stud (`stud`)

Classic high-hand-wins stud poker.

| Rule | Detail |
|---|---|
| Win condition | Best 5-card high hand from 7 cards |
| Hand ranking | Royal flush → straight flush → quads → full house → flush → straight → trips → two pair → pair → high card |
| Bring-in | Player with the **lowest** door card (suit tiebreak: clubs < diamonds < hearts < spades) |
| Betting streets | 3rd–4th street: small bet · 5th–7th street: big bet |
| Open pair | Triggers big-bet option on 4th street |
| Max raises | 4 per street (including opening bet) |

---

### Razz (`razz`)

Low-hand-wins stud. Straights and flushes do not count against you. Aces are always low.

| Rule | Detail |
|---|---|
| Win condition | Best 5-card A-5 low hand from 7 cards |
| Best possible hand | A-2-3-4-5 ("the wheel") |
| Pair penalty | Paired hands rank below all unpaired low hands |
| Hand ranking | Unpaired lows ranked high-card-down · then one pair · two pair · trips · full house · quads |
| Bring-in | Player with the **highest** door card (suit tiebreak reversed) |
| Betting streets | Same structure as Seven Card Stud |

---

### Seven Card Stud Hi/Lo 8-or-Better (`studhilo`)

Split-pot game. The best high hand and the best qualifying low hand each win half the pot.

| Rule | Detail |
|---|---|
| Win condition | High half: best 5-card high hand · Low half: best qualifying low hand |
| Low qualifier | Must be 5 unpaired cards ranked 8 or below (A counts as 1) |
| No low qualifier | Entire pot goes to the high hand winner |
| Scooping | A player can win both halves with the same 7 cards |
| Bring-in | Player with the **lowest** door card (same as Seven Card Stud) |
| Betting streets | Same structure as Seven Card Stud |

---

## Shared rules (all variants)

| Rule | Detail |
|---|---|
| Ante | Every player antes each hand |
| Stakes tiers | Low / Mid / High — sets ante, small bet, big bet, bring-in, and starting stack |
| Tempo | Every N hands (slow = 12, medium = 8, fast = 4), stakes scale up ~15% per level |
| AI opponents | 1–7 bots; three difficulty levels (easy / medium / hard) |
| Bust-out | Busted AI players leave the table; you win when everyone else is eliminated |
| Persistence | Settings and session state stored in `localStorage` |

## License

MIT — see [LICENSE](./LICENSE).

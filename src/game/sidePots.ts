export interface PotLayer {
  amount: number
  eligibleIds: string[]
}

export interface PotContribution {
  id: string
  contributed: number
  /**
   * Folded players still put chips in. Those chips count toward the pot, but
   * the player cannot win a layer. Omitted means the player can win.
   */
  eligible?: boolean
}

/**
 * Side pots from each player's total contribution this hand.
 * Distinct contribution levels are walked from low to high. A player who
 * folded is left out of `eligibleIds` so their dead money is paid to the
 * players who stayed, instead of disappearing at showdown.
 */
export function buildPotLayers(rows: PotContribution[]): PotLayer[] {
  const positive = rows.filter((r) => r.contributed > 0)
  if (positive.length === 0) return []
  const levels = [...new Set(positive.map((r) => r.contributed))].sort(
    (a, b) => a - b,
  )
  const layers: PotLayer[] = []
  let prev = 0
  for (const level of levels) {
    const inc = level - prev
    const inLayer = positive.filter((r) => r.contributed >= level)
    const amount = inc * inLayer.length
    const eligibleIds = inLayer.filter((r) => r.eligible !== false).map((r) => r.id)
    if (amount > 0 && eligibleIds.length > 0) {
      layers.push({ amount, eligibleIds })
    } else if (amount > 0 && layers.length > 0) {
      layers[layers.length - 1].amount += amount
    }
    prev = level
  }
  return layers
}

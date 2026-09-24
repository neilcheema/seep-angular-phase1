import { type Card, captureValue } from './card'
import type { PlayerId } from './player'

export interface House {
  readonly kind: 'house'
  readonly id: string
  readonly cards: Card[]
  readonly captureValue: number
  readonly cemented: boolean
  /** Everyone who currently has a stake in capturing this house. */
  readonly owners: PlayerId[]
}

export interface LooseCard {
  readonly kind: 'loose'
  readonly id: string
  readonly card: Card
}

export type FloorItem = House | LooseCard

export function isHouse(item: FloorItem): item is House {
  return item.kind === 'house'
}

export function isLoose(item: FloorItem): item is LooseCard {
  return item.kind === 'loose'
}

export function floorCards(item: FloorItem): Card[] {
  return isHouse(item) ? item.cards : [item.card]
}

export function itemValue(item: FloorItem): number {
  return isHouse(item) ? item.captureValue : captureValue(item.card)
}

export function findItem(floor: FloorItem[], id: string): FloorItem | undefined {
  return floor.find(i => i.id === id)
}

export function findHouseByValue(floor: FloorItem[], value: number): House | undefined {
  return floor.filter(isHouse).find(h => h.captureValue === value)
}

export function removeItems(floor: FloorItem[], ids: string[]): FloorItem[] {
  const idSet = new Set(ids)
  return floor.filter(i => !idSet.has(i.id))
}

export function sumValues(floor: FloorItem[], ids: string[]): number {
  return ids.reduce((total, id) => {
    const item = findItem(floor, id)
    return total + (item ? itemValue(item) : 0)
  }, 0)
}

export function allCardsOf(floor: FloorItem[], ids: string[]): Card[] {
  return ids.flatMap(id => {
    const item = findItem(floor, id)
    return item ? floorCards(item) : []
  })
}

/**
 * True if `card`, played alone or combined with any non-empty subset of the
 * loose cards on the floor (or with a single house), can capture something.
 * Used to enforce "you must capture if a capture is available" — a card can
 * only be thrown down as a loose card when this returns false.
 *
 * The floor is small in practice (rarely more than 8-10 loose items), so a
 * brute-force subset search is more than fast enough.
 */
export function hasAnyLegalCapture(floor: FloorItem[], card: Card): boolean {
  const target = captureValue(card)
  if (findHouseByValue(floor, target)) return true

  const loose = floor.filter(isLoose)
  // Also true if a single loose card matches, or any subset of loose cards sums to target.
  const n = loose.length
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += captureValue(loose[i]!.card)
    }
    if (sum === target) return true
  }
  return false
}

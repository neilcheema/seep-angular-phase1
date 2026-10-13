import { type Card, captureValue } from './card'
import type { PlayerId } from './player'

export interface House<P = PlayerId> {
  readonly kind: 'house'
  readonly id: string
  readonly cards: Card[]
  readonly captureValue: number
  readonly cemented: boolean
  readonly owners: P[]
}

export interface LooseCard {
  readonly kind: 'loose'
  readonly id: string
  readonly card: Card
}

export type FloorItem<P = PlayerId> = House<P> | LooseCard

export function isHouse<P = PlayerId>(item: FloorItem<P>): item is House<P> {
  return item.kind === 'house'
}

export function isLoose<P = PlayerId>(item: FloorItem<P>): item is LooseCard {
  return item.kind === 'loose'
}

export function floorCards<P = PlayerId>(item: FloorItem<P>): Card[] {
  return isHouse(item) ? item.cards : [item.card]
}

export function itemValue<P = PlayerId>(item: FloorItem<P>): number {
  return isHouse(item) ? item.captureValue : captureValue(item.card)
}

export function findItem<P = PlayerId>(floor: FloorItem<P>[], id: string): FloorItem<P> | undefined {
  return floor.find(i => i.id === id)
}

export function findHouseByValue<P = PlayerId>(floor: FloorItem<P>[], value: number): House<P> | undefined {
  return floor.filter(isHouse).find(h => h.captureValue === value)
}

export function removeItems<P = PlayerId>(floor: FloorItem<P>[], ids: string[]): FloorItem<P>[] {
  const idSet = new Set(ids)
  return floor.filter(i => !idSet.has(i.id))
}

export function sumValues<P = PlayerId>(floor: FloorItem<P>[], ids: string[]): number {
  return ids.reduce((total, id) => {
    const item = findItem(floor, id)
    return total + (item ? itemValue(item) : 0)
  }, 0)
}

export function allCardsOf<P = PlayerId>(floor: FloorItem<P>[], ids: string[]): Card[] {
  return ids.flatMap(id => {
    const item = findItem(floor, id)
    return item ? floorCards(item) : []
  })
}

export function hasAnyLegalCapture<P = PlayerId>(floor: FloorItem<P>[], card: Card): boolean {
  const target = captureValue(card)
  if (findHouseByValue(floor, target)) return true

  const loose = floor.filter(isLoose)
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

/**
 * Finds the maximum number of pairwise-disjoint groups of loose floor
 * items that can each be formed summing to exactly `target`. Returns the
 * groups found (each a list of item ids), largest achievable count first
 * — empty if no such group exists at all.
 *
 * A capture must take every matching group at once, not just one: if the
 * floor has a loose Ten alongside a loose Two and Eight, a played Ten
 * captures all three together (two separate "tens"), the same way a
 * cemented house holding two sets of the same value is captured as one
 * unit regardless of how many sets it contains. The floor is always small
 * in practice, so the brute-force search here (same pattern as
 * hasAnyLegalCapture above) stays fast.
 */
export function findMaximalExactGroups<P = PlayerId>(floor: FloorItem<P>[], target: number): string[][] {
  const loose = floor.filter(isLoose)
  let best: string[][] = []

  function search(remaining: LooseCard[], acc: string[][]): void {
    if (acc.length > best.length) best = acc
    const n = remaining.length
    for (let mask = 1; mask < 1 << n; mask++) {
      let sum = 0
      const group: string[] = []
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          sum += captureValue(remaining[i]!.card)
          group.push(remaining[i]!.id)
        }
      }
      if (sum !== target) continue
      const rest = remaining.filter((_, i) => !(mask & (1 << i)))
      search(rest, [...acc, group])
    }
  }

  search(loose, [])
  return best
}

/**
 * True if the loose floor items named by `ids` can be split into exactly
 * `groupCount` disjoint subsets, each summing to `target`, using every id
 * exactly once with none left over. Used to validate that a player's
 * specific selection actually forms that many clean groups, not just that
 * its total happens to add up to `groupCount * target` by coincidence.
 */
export function canDecomposeIntoExactGroups<P = PlayerId>(
  floor: FloorItem<P>[], ids: string[], target: number, groupCount: number,
): boolean {
  const items: LooseCard[] = []
  for (const id of ids) {
    const item = findItem(floor, id)
    if (!item || !isLoose(item)) return false
    items.push(item)
  }

  function search(remaining: LooseCard[], groupsLeft: number): boolean {
    if (groupsLeft === 0) return remaining.length === 0
    const n = remaining.length
    for (let mask = 1; mask < 1 << n; mask++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) sum += captureValue(remaining[i]!.card)
      }
      if (sum !== target) continue
      const rest = remaining.filter((_, i) => !(mask & (1 << i)))
      if (search(rest, groupsLeft - 1)) return true
    }
    return false
  }

  return search(items, groupCount)
}

/**
 * True if these card values can be split into complete sets that each add up to exactly `target`, using every card and leaving none over.
 * 9, 4+5 and 3+6 each make a set of 9, so together they make three sets; 11+12+13 totals 36, four nines' worth, but no card in it can be part of
 * a set of 9, so it makes none. A house of N may be built or cemented only from whole sets of N, and the total alone cannot tell the two apart.
 */
export function canSplitIntoSets(values: number[], target: number): boolean {
  const n = values.length
  if (n === 0 || target <= 0 || n > 30) return false
  const total = values.reduce((t, v) => t + v, 0)
  if (total % target !== 0) return false
  const sumOf = (mask: number): number => {
    let s = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += values[i]!
    return s
  }
  const failed = new Set<number>()
  // Take the first card still unplaced and try every set it could belong to; the cards left must then split too.
  const place = (remaining: number): boolean => {
    if (remaining === 0) return true
    if (failed.has(remaining)) return false
    const first = remaining & -remaining
    const others = remaining ^ first
    for (let sub = others; ; sub = (sub - 1) & others) {
      const group = sub | first
      if (sumOf(group) === target && place(remaining ^ group)) return true
      if (sub === 0) break
    }
    failed.add(remaining)
    return false
  }
  return place(n === 31 ? -1 : (1 << n) - 1)
}

/**
 * The floor items a capture with `card` MUST take, all at once: a house of exactly the card's value, plus every disjoint group of loose cards
 * that add up to it. Empty when there is nothing to capture, which is exactly when the card may be thrown instead.
 *
 * This is the same rule playCapture enforces (and the one the screens use to know which cards a capture needs and to explain a refused throw).
 * It lives here, once, because the screens' own copy of it drifted from the engine's before; a test now checks it against playCapture itself.
 */
export function requiredCaptureIds<P = PlayerId>(floor: FloorItem<P>[], card: Card): string[] {
  const target = captureValue(card)
  const house = findHouseByValue(floor, target)
  const groups = findMaximalExactGroups(floor, target).flat()
  return house ? [house.id, ...groups] : groups
}

/**
 * True if the played card (already part of `floor` as the loose item `playedId`) can belong to a best-possible set of groups: there are exactly
 * `groupCount` disjoint groups of loose cards, each adding up to `target`, one of which contains the played card. Used when building a house, where
 * any ONE of the equivalent combinations may be chosen but none of the separate groups may be left out. It looks for the groups that contain the
 * played card first and then packs the rest, so it stays fast on a large floor.
 */
export function canJoinMaximalGroups<P = PlayerId>(floor: FloorItem<P>[], playedId: string, target: number, groupCount: number): boolean {
  const played = findItem(floor, playedId)
  if (!played || !isLoose(played)) return false
  const others = floor.filter(isLoose).filter((item) => item.id !== playedId)
  const sumOf = (items: LooseCard[], mask: number): number => items.reduce((t, item, i) => (mask & (1 << i) ? t + captureValue(item.card) : t), 0)
  function canPack(remaining: LooseCard[], groupsLeft: number): boolean {
    if (groupsLeft === 0) return true
    for (let mask = 1; mask < 1 << remaining.length; mask++) {
      if (sumOf(remaining, mask) !== target) continue
      if (canPack(remaining.filter((_, i) => !(mask & (1 << i))), groupsLeft - 1)) return true
    }
    return false
  }
  const need = target - captureValue(played.card)
  for (let mask = 0; mask < 1 << others.length; mask++) {
    if (sumOf(others, mask) !== need) continue
    if (canPack(others.filter((_, i) => !(mask & (1 << i))), groupCount - 1)) return true
  }
  return false
}

/**
 * A capture may take ANY ONE combination for each group when several different combinations of floor cards add up to the card's value (a Jack
 * takes a 2 and a 9 whether the 9 is the spade or the diamond), on every play, not only the opening move. What it may not do is leave
 * something behind: it must take every house worth that value and as many separate groups as the floor allows. A player who has a choice
 * decides it; the program does not pick for them (a spade is worth its face value, a diamond usually nothing).
 * `ids` are the items the player selected (loose cards, and the house at that value if there is one).
 */
export function isAcceptableCapture<P = PlayerId>(floor: FloorItem<P>[], target: number, ids: string[]): boolean {
  const house = findHouseByValue(floor, target)
  const selected = new Set(ids)
  if (house && !selected.has(house.id)) return false
  const looseIds = ids.filter((id) => !house || id !== house.id)
  const groupCount = findMaximalExactGroups(floor, target).length
  if (groupCount === 0) return looseIds.length === 0 // only the house is there to take
  return canDecomposeIntoExactGroups(floor, looseIds, target, groupCount)
}

/**
 * The player's LAST card of a hand, when it matches a house THAT PLAYER MADE and that is still on the floor: the one situation where the floor cards need
 * not be ticked. Everything still on the floor goes to whoever captured last at the end of the hand, and capturing that house with the last card makes
 * the player exactly that, so which floor cards are ticked cannot change what is won, yet the old rule made the player find the one exact set to tick
 * (or refused a capture that took everything). Here, if the card can capture, a selection that is a proper capture is used as it is, and anything else
 * (including no selection) means "take what the card must capture".
 * Everything else is unchanged: a last card with no house of the player's own to take (no house at all, or only someone else's) captures exactly as
 * on any other play, and a card that cannot capture is thrown as usual.
 */
export function resolveLastCardCapture<P = PlayerId>(floor: FloorItem<P>[], card: Card, selectedIds: string[], isLastPlay: boolean, owner: P): string[] {
  if (!isLastPlay) return selectedIds
  const house = findHouseByValue(floor, captureValue(card))
  if (!house || !house.owners.includes(owner)) return selectedIds
  // (The house itself is always part of what the card must capture, so there is always something to take here.)
  return selectedIds.length > 0 && isAcceptableCapture(floor, captureValue(card), selectedIds) ? selectedIds : requiredCaptureIds(floor, card)
}

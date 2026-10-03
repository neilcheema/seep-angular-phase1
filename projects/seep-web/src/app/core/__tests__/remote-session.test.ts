import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type GameState, type Intent, type PlayerId, applyMove, legalBids, startMatch, viewFor } from 'seep-engine'
import type { GameView } from 'seep-engine'
import type { GameSnapshotDto, GameStatus, MoveRecordDto, MutationDto } from '../api-types'
import { ApiError, type GameApi } from '../game-api'
import { twoPlayerPerspective } from '../perspective'
import { RemoteSession } from '../remote-session'

/** Real engine positions: s0 = 'player' to bid; s1 = the bid is in; s2 = the opening move is made. */
const s0: GameState = startMatch('player')
const bid: Intent = { type: 'bid', value: legalBids(s0)[0]! }
const s1: GameState = applyMove(s0, 'player', bid)

const snapshot = (
  state: GameState,
  seat: PlayerId,
  version: number,
  extra: { status?: GameStatus; moves?: MoveRecordDto[]; inviteCode?: string | null } = {},
): GameSnapshotDto<GameView> => ({
  changed: true,
  gameId: 'g1',
  kind: 'two_player',
  status: extra.status ?? 'active',
  version,
  seat,
  inviteCode: extra.inviteCode ?? null,
  players: [
    { seat: 'player', displayName: null, isBot: false, isYou: seat === 'player', joined: true },
    { seat: 'opponent', displayName: null, isBot: false, isYou: seat === 'opponent', joined: true },
  ],
  view: viewFor(state, seat),
  moves: extra.moves ?? [],
})
const unchanged = (version: number, status: GameStatus = 'active') => ({ changed: false as const, gameId: 'g1', version, status })
const mutation = (state: GameState, seat: PlayerId, version: number, status: GameStatus = 'active'): MutationDto<GameView> => ({
  gameId: 'g1',
  version,
  status,
  seat,
  view: viewFor(state, seat),
})

function makeApi() {
  const getGame = vi.fn()
  const submitMove = vi.fn()
  const dealNext = vi.fn()
  return { api: { getGame, submitMove, dealNext } as unknown as GameApi, getGame, submitMove, dealNext }
}

const open = (api: GameApi, extra: { isHidden?: () => boolean } = {}) =>
  RemoteSession.open<GameView, Intent, PlayerId>({ api, gameId: 'g1', perspective: twoPlayerPerspective, ...extra })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RemoteSession: loading', () => {
  it('exposes the game it loaded, without inventing a "last move"', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1, { status: 'waiting', inviteCode: 'ABC234' }))
    const session = await open(api)

    expect(getGame).toHaveBeenCalledWith('g1', undefined)
    expect(session.view()?.viewer).toBe('player')
    expect(session.seat()).toBe('player')
    expect(session.status()).toBe('waiting')
    expect(session.inviteCode()).toBe('ABC234')
    expect(session.players()).toHaveLength(2)
    expect(session.connection()).toBe('online')
    expect(session.lastMove()).toBeNull()
    session.dispose()
  })

  it('rejects, and starts no polling, when the game cannot be loaded', async () => {
    const { api, getGame } = makeApi()
    getGame.mockRejectedValueOnce(new ApiError(404, 'Game not found.'))
    await expect(open(api)).rejects.toMatchObject({ status: 404, message: 'Game not found.' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("presents a game seated as 'opponent' from the viewer's own side, so an unmodified page works", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2))
    const session = await open(api)
    expect(session.seat()).toBe('opponent') // the server's name for the seat is kept...
    expect(session.view()?.viewer).toBe('player') // ...but the page sees itself as 'player'
    expect(session.view()?.bidder).toBe('opponent') // the other person is the one who bid
    // The bidder still has to make the opening move, so the other person holds the turn, and the viewer waits.
    expect(session.view()?.turn).toBe('opponent')
    expect(twoPlayerPerspective.isMyTurn(session.view()!)).toBe(false)
    session.dispose()
  })
})

describe('RemoteSession: polling', () => {
  it("asks only for what's new, at a pace set by whose move it is", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1)) // the other person bids: viewer waits -> brisk
    getGame.mockResolvedValue(unchanged(1))
    const session = await open(api)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(getGame).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(getGame).toHaveBeenCalledTimes(2)
    expect(getGame).toHaveBeenLastCalledWith('g1', 1)
    session.dispose()
  })

  it("polls slowly when it's the viewer's own move", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1)) // viewer is the bidder
    getGame.mockResolvedValue(unchanged(1))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(getGame).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(getGame).toHaveBeenCalledTimes(2)
    session.dispose()
  })

  it('slows down when the tab is in the background', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValue(unchanged(1))
    const session = await open(api, { isHidden: () => true })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(getGame).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(getGame).toHaveBeenCalledTimes(2)
    session.dispose()
  })

  it('a quiet poll leaves the view untouched and reports no move', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValue(unchanged(1))
    const session = await open(api)
    const before = session.view()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(session.view()).toBe(before)
    expect(session.lastMove()).toBeNull()
    session.dispose()
  })

  it("turns the other player's move into a lastMove event, with the view before and after", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2, { moves: [{ version: 2, seat: 'player', intent: bid }] }))
    getGame.mockResolvedValue(unchanged(2))
    const session = await open(api)
    const before = session.view()

    await vi.advanceTimersByTimeAsync(2_100)

    const move = session.lastMove()!
    expect(move.actor).toBe('opponent') // from the viewer's side, the other person
    expect(move.intent).toEqual(bid)
    expect(move.before).toBe(before)
    expect(move.after).toBe(session.view())
    expect(move.after.bidValue).toBe((bid as { value: number }).value)
    session.dispose()
  })

  it("doesn't re-announce the viewer's own moves or hand deals that show up in the move list", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValueOnce(
      snapshot(s1, 'opponent', 4, {
        moves: [
          { version: 2, seat: 'opponent', intent: { type: 'throw' } }, // made from another tab of mine
          { version: 3, seat: 'player', intent: { type: 'deal-next' } },
          { version: 4, seat: 'opponent', intent: { type: 'throw' } },
        ],
      }),
    )
    getGame.mockResolvedValue(unchanged(4))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(session.view()?.bidValue).not.toBeNull() // the view itself did update
    expect(session.lastMove()).toBeNull()
    session.dispose()
  })

  it('when several moves landed between polls, reveals the last of them and still shows the full current state', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValueOnce(
      snapshot(s1, 'opponent', 3, {
        moves: [
          { version: 2, seat: 'player', intent: { type: 'bid', value: 9 } },
          { version: 3, seat: 'player', intent: { type: 'throw', card: { face: 'Two', suit: 'Clubs' } } },
        ],
      }),
    )
    getGame.mockResolvedValue(unchanged(3))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(2_100)
    expect((session.lastMove()!.intent as { type: string }).type).toBe('throw')
    session.dispose()
  })

  it('never goes backwards: an older answer arriving late is ignored', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 5))
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 4)) // stale
    getGame.mockResolvedValue(unchanged(5))
    const session = await open(api)
    const current = session.view()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(session.view()).toBe(current)
    expect(session.lastMove()).toBeNull()
    session.dispose()
  })

  it("doesn't start a second poll while one is still in flight", async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockReturnValue(new Promise(() => undefined)) // a request that never answers
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getGame).toHaveBeenCalledTimes(2)
    session.dispose()
  })

  it("doesn't double up on a poll that is still outstanding when the viewer's own move reschedules polling", async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockReturnValueOnce(new Promise(() => undefined)) // the next poll never answers
    getGame.mockResolvedValue(unchanged(2))
    submitMove.mockResolvedValueOnce(mutation(s1, 'player', 2))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(10_100) // that poll is now in flight
    expect(getGame).toHaveBeenCalledTimes(2)

    await session.submit(bid) // the move arms a fresh timer while the old poll is outstanding
    await vi.advanceTimersByTimeAsync(60_000)

    expect(getGame).toHaveBeenCalledTimes(2) // still just the one outstanding poll
    session.dispose()
  })

  it('ignores a "nothing new" answer that is older than a move the viewer has since made (it must not un-finish a finished game)', async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    let answerPoll!: () => void
    getGame.mockImplementationOnce(() => new Promise((resolve) => (answerPoll = () => resolve(unchanged(1, 'active')))))
    getGame.mockResolvedValue(unchanged(2, 'finished'))
    submitMove.mockResolvedValueOnce(mutation(s1, 'player', 2, 'finished'))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(10_100) // a poll, asked at version 1, is now outstanding
    await session.submit(bid) // the viewer's own move ends the game: version 2, finished
    expect(session.status()).toBe('finished')

    answerPoll() // the old poll's answer ("version 1, still active") finally lands
    await vi.advanceTimersByTimeAsync(1)

    expect(session.status()).toBe('finished')
    expect(vi.getTimerCount()).toBe(0) // and nothing was re-armed to poll a finished game
    session.dispose()
  })

  it('stops polling for good once the game is finished', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2, { status: 'finished' }))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(session.status()).toBe('finished')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getGame).toHaveBeenCalledTimes(2)
  })

  it('stops completely when disposed, even if a poll is mid-flight', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    let release!: (v: unknown) => void
    getGame.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(2_100) // a poll is now in flight
    session.dispose()
    release(unchanged(1))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(getGame).toHaveBeenCalledTimes(2)
  })

  it('cancels its pending poll the instant it is disposed, leaving no timer behind', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    const session = await open(api)
    expect(vi.getTimerCount()).toBe(1) // the next poll is waiting
    session.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshNow polls immediately and carries on', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2, { moves: [{ version: 2, seat: 'player', intent: bid }] }))
    getGame.mockResolvedValue(unchanged(2))
    const session = await open(api)
    await session.refreshNow()
    expect(session.view()?.bidValue).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    session.dispose()
  })
})

describe('RemoteSession: trouble on the network', () => {
  it('backs off 2s, 4s, 8s... up to 30s while the server is unreachable, then recovers cleanly', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockRejectedValue(new TypeError('Failed to fetch'))
    const session = await open(api)

    const gaps: number[] = []
    let last = 0
    let t = 0
    for (let step = 0; step < 4_000 && gaps.length < 7; step++) {
      const calls = getGame.mock.calls.length
      await vi.advanceTimersByTimeAsync(50)
      t += 50
      if (getGame.mock.calls.length > calls) {
        gaps.push(t - last)
        last = t
      }
    }
    expect(session.connection()).toBe('offline')
    expect(gaps.slice(1)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) // capped

    getGame.mockResolvedValue(unchanged(1))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(session.connection()).toBe('online')
    const callsAfterRecovery = getGame.mock.calls.length
    await vi.advanceTimersByTimeAsync(2_100) // back to the normal brisk pace
    expect(getGame.mock.calls.length).toBe(callsAfterRecovery + 1)
    session.dispose()
  })

  it('treats a rejected sign-in as the end of polling, not something to hammer', async () => {
    const { api, getGame } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    getGame.mockRejectedValueOnce(new ApiError(401, 'Token verification failed'))
    const session = await open(api)
    await vi.advanceTimersByTimeAsync(2_100)
    expect(session.connection()).toBe('unauthorized')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getGame).toHaveBeenCalledTimes(2)
  })
})

describe('RemoteSession: making moves', () => {
  it('sends the version it last saw, adopts the result, and reports its own move', async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockResolvedValue(unchanged(2))
    submitMove.mockResolvedValueOnce(mutation(s1, 'player', 2))
    const session = await open(api)
    const before = session.view()

    await session.submit(bid)

    expect(submitMove).toHaveBeenCalledWith('g1', bid, 1)
    expect(session.view()?.bidValue).toBe((bid as { value: number }).value)
    const move = session.lastMove()!
    expect(move).toMatchObject({ actor: 'player', intent: bid })
    expect(move.before).toBe(before)
    expect(move.after).toBe(session.view())
    // Later polls ask from the new version. (It is still the bidder's own move: the opening move is next,
    // so this is the slow, "I'm the one being waited on" pace.)
    await vi.advanceTimersByTimeAsync(10_100)
    expect(getGame).toHaveBeenLastCalledWith('g1', 2)
    session.dispose()
  })

  it("as the 'opponent' seat, reports its own move as the page's 'player'", async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2))
    getGame.mockResolvedValue(unchanged(3))
    const throwIntent: Intent = { type: 'throw', card: s1.hands.opponent[0] ?? { face: 'Two', suit: 'Clubs' } }
    submitMove.mockResolvedValueOnce(mutation(s1, 'opponent', 3))
    const session = await open(api)
    await session.submit(throwIntent)
    expect(session.lastMove()?.actor).toBe('player')
    session.dispose()
  })

  it("passes the rules' own explanation through when a move is refused, and changes nothing", async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockResolvedValue(unchanged(1))
    submitMove.mockRejectedValueOnce(new ApiError(422, 'You must capture with this card — a capture is available.'))
    const session = await open(api)
    const view = session.view()
    await expect(session.submit(bid)).rejects.toThrow('You must capture with this card — a capture is available.')
    expect(session.view()).toBe(view)
    expect(session.lastMove()).toBeNull()
    session.dispose()
  })

  it('on a stale-version refusal, catches up and tells the player to try again', async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'opponent', 1))
    submitMove.mockRejectedValueOnce(new ApiError(409, 'The game has changed since you last looked.', { currentVersion: 2 }))
    getGame.mockResolvedValueOnce(snapshot(s1, 'opponent', 2, { moves: [{ version: 2, seat: 'player', intent: bid }] }))
    getGame.mockResolvedValue(unchanged(2))
    const session = await open(api)

    await expect(session.submit({ type: 'throw', card: { face: 'Two', suit: 'Clubs' } })).rejects.toThrow(/game changed.*try again/i)
    expect(session.view()?.bidValue).not.toBeNull() // it re-synced
    expect(session.lastMove()?.intent).toEqual(bid) // and the move it missed is now shown
    session.dispose()
  })

  it('says so plainly when the server cannot be reached, and leaves the game as it was', async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockResolvedValue(unchanged(1))
    submitMove.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const session = await open(api)
    const view = session.view()
    await expect(session.submit(bid)).rejects.toThrow(/couldn't reach the server/i)
    expect(session.view()).toBe(view)
    session.dispose()
  })

  it("won't step backwards if polling already delivered something newer than its own move's result", async () => {
    const { api, getGame, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    let deliverPoll!: () => void
    // A poll answers with version 3 while our submit (which produced version 2) is still in flight.
    getGame.mockImplementationOnce(() => new Promise((resolve) => (deliverPoll = () => resolve(snapshot(s1, 'player', 3)))))
    getGame.mockResolvedValue(unchanged(3))
    let finishSubmit!: () => void
    submitMove.mockImplementationOnce(() => new Promise((resolve) => (finishSubmit = () => resolve(mutation(s0, 'player', 2)))))
    const session = await open(api)

    await vi.advanceTimersByTimeAsync(10_100) // the poll is now in flight
    const submitting = session.submit(bid)
    deliverPoll() // newer data lands first
    await vi.advanceTimersByTimeAsync(1)
    const newer = session.view()
    finishSubmit() // then the older result of our own move
    await submitting

    expect(session.view()).toBe(newer) // the newer state was kept
    expect(session.lastMove()?.intent).toEqual(bid) // but our move was still reported
    session.dispose()
  })

  it('dealing the next hand sends the version, clears the last move, and adopts the new hand', async () => {
    const { api, getGame, dealNext, submitMove } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockResolvedValue(unchanged(3))
    submitMove.mockResolvedValueOnce(mutation(s1, 'player', 2))
    dealNext.mockResolvedValueOnce(mutation(s0, 'player', 3))
    const session = await open(api)
    await session.submit(bid)
    expect(session.lastMove()).not.toBeNull()

    await session.dealNext()

    expect(dealNext).toHaveBeenCalledWith('g1', 2)
    expect(session.lastMove()).toBeNull()
    expect(session.view()?.phase).toBe('bidding')
    session.dispose()
  })

  it('explains a refused deal the same way as a refused move', async () => {
    const { api, getGame, dealNext } = makeApi()
    getGame.mockResolvedValueOnce(snapshot(s0, 'player', 1))
    getGame.mockResolvedValue(unchanged(1))
    dealNext.mockRejectedValueOnce(new ApiError(422, 'The current hand has not finished.'))
    const session = await open(api)
    await expect(session.dealNext()).rejects.toThrow('The current hand has not finished.')
    session.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import {
  ALL_SEATS, ALL_TEAMS, SeatId, TeamId, TURN_ORDER,
  areTeammates, nextSeat, opponentsOf, partnerOf, seatAfter, teamOf,
} from '../seats'

describe('seat and team identity', () => {
  it('fixes the seat rotation to p1 -> p2 -> p3 -> p4', () => {
    expect(TURN_ORDER).toEqual([SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4])
    expect(ALL_SEATS).toEqual(TURN_ORDER)
  })

  it('puts the user (p1) and their computer partner (p3) on team A', () => {
    expect(teamOf(SeatId.P1)).toBe(TeamId.TeamA)
    expect(teamOf(SeatId.P3)).toBe(TeamId.TeamA)
  })

  it('puts p2 and p4 on team B', () => {
    expect(teamOf(SeatId.P2)).toBe(TeamId.TeamB)
    expect(teamOf(SeatId.P4)).toBe(TeamId.TeamB)
  })

  it('pairs partners across the table, not beside it', () => {
    expect(partnerOf(SeatId.P1)).toBe(SeatId.P3)
    expect(partnerOf(SeatId.P3)).toBe(SeatId.P1)
    expect(partnerOf(SeatId.P2)).toBe(SeatId.P4)
    expect(partnerOf(SeatId.P4)).toBe(SeatId.P2)
  })

  it('lists both opposing seats for a given seat', () => {
    expect(opponentsOf(SeatId.P1)).toEqual([SeatId.P2, SeatId.P4])
    expect(opponentsOf(SeatId.P2)).toEqual([SeatId.P1, SeatId.P3])
  })

  it('recognizes teammates but not self or opponents as teammates', () => {
    expect(areTeammates(SeatId.P1, SeatId.P3)).toBe(true)
    expect(areTeammates(SeatId.P1, SeatId.P1)).toBe(false)
    expect(areTeammates(SeatId.P1, SeatId.P2)).toBe(false)
  })

  it('rotates turn order correctly, including wrap-around', () => {
    expect(nextSeat(SeatId.P1)).toBe(SeatId.P2)
    expect(nextSeat(SeatId.P2)).toBe(SeatId.P3)
    expect(nextSeat(SeatId.P3)).toBe(SeatId.P4)
    expect(nextSeat(SeatId.P4)).toBe(SeatId.P1)
  })

  it('alternates team on every single turn', () => {
    let seat: SeatId = SeatId.P1
    const teams: TeamId[] = []
    for (let i = 0; i < 4; i++) {
      teams.push(teamOf(seat))
      seat = nextSeat(seat)
    }
    expect(teams).toEqual([TeamId.TeamA, TeamId.TeamB, TeamId.TeamA, TeamId.TeamB])
  })

  it('computes an arbitrary number of steps ahead, wrapping as needed', () => {
    expect(seatAfter(SeatId.P1, 0)).toBe(SeatId.P1)
    expect(seatAfter(SeatId.P1, 1)).toBe(SeatId.P2)
    expect(seatAfter(SeatId.P1, 5)).toBe(SeatId.P2)
    expect(seatAfter(SeatId.P2, -1)).toBe(SeatId.P1)
  })

  it('lists exactly two teams', () => {
    expect(ALL_TEAMS).toEqual([TeamId.TeamA, TeamId.TeamB])
  })
})

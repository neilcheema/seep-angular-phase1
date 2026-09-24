export type PlayerId = 'player' | 'opponent'

export function otherPlayer(id: PlayerId): PlayerId {
  return id === 'player' ? 'opponent' : 'player'
}

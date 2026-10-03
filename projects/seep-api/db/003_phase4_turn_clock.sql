-- Phase 4: the turn clock.
-- Safe to run more than once.

-- When the current mover's clock started: set by every change to a game (a move,
-- a deal, the opponent joining) and restarted when the waiting player returns
-- after being away. Postgres's own clock, so no server's clock can disagree.
ALTER TABLE games ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- When each player last had the game open (refreshed at most every 30s, so
-- polling does not turn into a write per request). A forfeit is only decided
-- while the player who is waiting is actually here.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

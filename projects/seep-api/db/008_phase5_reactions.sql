-- Phase 5d: quick reactions ("Nice move!", "Good game!"): preset codes only, never free text.
-- Reactions have their OWN counter on the game (reaction_seq) and never touch the game's version, because the version
-- is what a move is checked against: a reaction that moved it would make the other player's next move fail with
-- "the game changed". Old reactions are pruned as new ones arrive, and they vanish with the game.
-- Safe to run more than once.
ALTER TABLE games ADD COLUMN IF NOT EXISTS reaction_seq INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS reactions (
  game_id  UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq      INT NOT NULL,
  seat_key TEXT NOT NULL,
  code     TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, seq)
);

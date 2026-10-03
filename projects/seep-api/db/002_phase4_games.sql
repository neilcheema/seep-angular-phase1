-- Phase 4a: what the game-hosting API needs beyond the phase 3 tables.
-- Safe to run more than once (every statement is guarded), because it is
-- applied by hand to each Neon branch and a repeat run should be harmless.

-- games: a version counter (optimistic concurrency), a short invite code,
-- and who created it.
ALTER TABLE games ADD COLUMN IF NOT EXISTS version     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS games_invite_code_key
  ON games (invite_code) WHERE invite_code IS NOT NULL;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE games ADD CONSTRAINT games_status_check
  CHECK (status IN ('waiting', 'active', 'finished', 'abandoned'));

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_version_nonneg;
ALTER TABLE games ADD CONSTRAINT games_version_nonneg CHECK (version >= 0);

-- seats: a seat with no user is either OPEN (is_bot = false) or a bot
-- (is_bot = true) -- phase 3's schema could not tell those apart.
ALTER TABLE seats ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS seats_user_id_idx ON seats (user_id);

-- move_log: which game version each entry produced, so a client that has
-- seen version N can ask for exactly the moves after it.
ALTER TABLE move_log ADD COLUMN IF NOT EXISTS version INTEGER;
CREATE INDEX IF NOT EXISTS move_log_game_version_idx ON move_log (game_id, version);

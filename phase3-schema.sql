-- Phase 3 uses this table actively.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid  TEXT NOT NULL UNIQUE,     -- the Firebase token's "sub" claim
  display_name  TEXT,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 4 populates and reads these; created now so there's no later migration.
CREATE TABLE games (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('two_player', 'four_player')),
  state           JSONB NOT NULL,        -- GameState / FourPlayerGameState, as-is
  engine_version  TEXT NOT NULL,         -- from seep-engine's ENGINE_VERSION
  status          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat_key  TEXT NOT NULL,               -- 'player'/'opponent' or 'p1'..'p4'
  user_id   UUID REFERENCES users(id),   -- null means this seat is a bot
  UNIQUE (game_id, seat_key)
);

CREATE TABLE move_log (
  id          BIGSERIAL PRIMARY KEY,
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat_key    TEXT NOT NULL,
  intent      JSONB NOT NULL,            -- an Intent / FourPlayerIntent, as-is
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

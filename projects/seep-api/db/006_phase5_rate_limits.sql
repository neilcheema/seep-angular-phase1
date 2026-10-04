-- Phase 5c: rate limits.
-- One row per limited action (creating a table, a move, a wrong table code). The API counts a person's recent rows to
-- decide whether to say "slow down". Rows are only needed for the length of the longest window (an hour), so the
-- daily cleanup removes anything older than a day. They go with the person if the account is deleted.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS rate_events (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_lookup_idx ON rate_events (user_id, kind, at);
CREATE INDEX IF NOT EXISTS rate_events_at_idx ON rate_events (at);

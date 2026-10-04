-- Phase 5: self-serve account deletion.
-- When someone deletes their account, their sign-in token stays valid for up to an hour. Without a marker, a browser
-- tab still polling in that hour would quietly re-create the user row we just erased (the game endpoints create a
-- user on first sight). The marker blocks that. It holds only an opaque id, and the daily cleanup removes it after
-- 48 hours, long after any token has expired. Safe to run more than once.
CREATE TABLE IF NOT EXISTS deleted_accounts (
  firebase_uid TEXT PRIMARY KEY,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deleted_accounts_deleted_at_idx ON deleted_accounts (deleted_at);

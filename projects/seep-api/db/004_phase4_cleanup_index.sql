-- Phase 4: housekeeping.
-- The daily cleanup looks tables up by status and age; this keeps that cheap as the table grows.
-- Safe to run more than once.
CREATE INDEX IF NOT EXISTS games_status_updated_idx ON games (status, updated_at);

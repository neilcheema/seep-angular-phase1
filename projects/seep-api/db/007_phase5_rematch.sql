-- Phase 5d: rematch.
-- A finished game remembers the table made for its rematch, so the second player to ask joins the first player's
-- table instead of making another. If the rematch table is later deleted the pointer simply clears.
-- Safe to run more than once.
ALTER TABLE games ADD COLUMN IF NOT EXISTS rematch_game_id UUID REFERENCES games(id) ON DELETE SET NULL;

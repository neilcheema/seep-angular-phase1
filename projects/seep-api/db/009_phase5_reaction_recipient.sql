-- Quick reactions can be ADDRESSED to one player at the table ("Alice → Dave: Nice move!").
-- Everyone at the table still receives every reaction: the recipient is only a label saying who it is for, not a privacy filter.
-- NULL means "for everyone". It holds a seat key (like 'p2'), never a person, so deleting an account leaves nothing personal in it.
-- Safe to run more than once.
ALTER TABLE reactions ADD COLUMN IF NOT EXISTS to_seat TEXT;

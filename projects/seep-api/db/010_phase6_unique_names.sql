-- Display names are unique across the site. "The same name" means the same once case is ignored and spaces and . - _ ' are ignored, so
-- "Alex", "alex", "A.lex" and "Alex_" are one name. That comparison is defined HERE, once, as seep_name_key(), and the index and every query
-- that asks "is this name taken?" use this same function, so they can never disagree. Names that are NULL (not chosen yet) never collide.
-- Safe to run more than once. Run it in Neon BEFORE the API that needs it is deployed.

CREATE OR REPLACE FUNCTION seep_name_key(name TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT regexp_replace(lower(normalize(name, NFKC)), '[ ._''-]', '', 'g') $$;

-- Names that are already shared: the earliest account keeps its name, each later one gets a number ("Narender" -> "Narender 2").
-- A numbered name can itself collide with a name someone already has, so this repeats until every name is unique.
DO $$
DECLARE passes INT := 0;
BEGIN
  LOOP
    WITH ranked AS (
      SELECT id, display_name, row_number() OVER (PARTITION BY seep_name_key(display_name) ORDER BY created_at, id) AS n
        FROM users
       WHERE display_name IS NOT NULL
    ), dupes AS (
      SELECT id, left(display_name, 17) || ' ' || n AS fixed FROM ranked WHERE n > 1
    )
    UPDATE users u SET display_name = d.fixed FROM dupes d WHERE u.id = d.id;
    EXIT WHEN NOT FOUND OR passes >= 20;
    passes := passes + 1;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_key ON users (seep_name_key(display_name)) WHERE display_name IS NOT NULL;

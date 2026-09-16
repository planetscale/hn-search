CREATE TABLE IF NOT EXISTS items (
  id bigint PRIMARY KEY,
  deleted boolean NOT NULL DEFAULT false,
  type text NOT NULL,
  "by" text,
  time timestamptz,
  text text,
  dead boolean NOT NULL DEFAULT false,
  parent bigint,
  poll bigint,
  kids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  url text,
  score integer,
  title text,
  parts bigint[] NOT NULL DEFAULT '{}'::bigint[],
  descendants integer,
  CONSTRAINT items_type_check CHECK (type IN ('story', 'comment', 'poll', 'pollopt', 'job'))
);

CREATE INDEX IF NOT EXISTS items_type_time_idx ON items (type, time DESC);
CREATE INDEX IF NOT EXISTS items_type_score_idx ON items (type, score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS items_parent_idx ON items (parent);
CREATE INDEX IF NOT EXISTS items_by_time_idx ON items ("by", time DESC);
CREATE INDEX IF NOT EXISTS items_story_new_idx ON items (time DESC)
  WHERE type = 'story' AND NOT deleted AND NOT dead AND title IS NOT NULL AND title <> '';
CREATE INDEX IF NOT EXISTS items_titled_time_idx ON items (time DESC)
  WHERE NOT deleted AND NOT dead AND title IS NOT NULL AND title <> '';

-- Searchable text, indexed as an expression so the corpus is stored once. A
-- `tin` index answers both the match (`==>`) and the BM25 ranking
-- (`tin.score(ctid)`), and its scan is a true top-K, so no candidate cap needs
-- tuning. Every query repeats this expression verbatim; see SEARCH_EXPR in
-- src/lib/queries.ts.
--
-- Each index is partial, and its predicate is exactly the WHERE clause the app
-- writes for that tab. TIN takes a matching predicate as given rather than
-- re-checking it per row, so matching, ranking and an exact `count(*)` all stay
-- inside the index. This one covers the `all` tab and the long-tail types
-- (poll, pollopt).
CREATE INDEX IF NOT EXISTS items_search_tin ON items
  USING tin ((coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), '')))
  WHERE NOT deleted AND NOT dead;
CREATE INDEX IF NOT EXISTS items_story_tin ON items
  USING tin ((coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), '')))
  WHERE type = 'story' AND NOT deleted AND NOT dead;
CREATE INDEX IF NOT EXISTS items_comment_tin ON items
  USING tin ((coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), '')))
  WHERE type = 'comment' AND NOT deleted AND NOT dead;
CREATE INDEX IF NOT EXISTS items_job_tin ON items
  USING tin ((coalesce(title, '') || ' ' || coalesce("by", '') || ' ' || coalesce(regexp_replace(text, '<[^>]+>', ' ', 'g'), '')))
  WHERE type = 'job' AND NOT deleted AND NOT dead;

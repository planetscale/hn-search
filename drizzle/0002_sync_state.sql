CREATE TABLE IF NOT EXISTS sync_state (
  key text PRIMARY KEY,
  last_id bigint NOT NULL DEFAULT 0,
  synced integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

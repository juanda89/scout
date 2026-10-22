-- Señales para distinguir creadoras de negocios y para ubicar por geotags.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS is_business boolean;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS business_category text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS is_verified boolean;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS location_name text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS hashtags text[] DEFAULT '{}';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS mentions text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_content_hashtags ON content_items USING gin (hashtags);
-- Estrategias de descubrimiento ejecutadas por scouting (rendimiento y costo por estrategia)
CREATE TABLE IF NOT EXISTS discovery_runs (
  id          bigserial PRIMARY KEY,
  scouting_id uuid REFERENCES scoutings(id) ON DELETE CASCADE,
  strategy    text NOT NULL,
  input       jsonb NOT NULL DEFAULT '{}',
  found       integer NOT NULL DEFAULT 0,
  new_profiles integer NOT NULL DEFAULT 0,
  passing     integer NOT NULL DEFAULT 0,
  cost_usd    numeric(10,4) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON discovery_runs TO PUBLIC;

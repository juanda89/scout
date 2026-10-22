-- Esquema núcleo: ver docs/ARQUITECTURA.md
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS creators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        text NOT NULL,
  handle          text NOT NULL,
  display_name    text,
  discovered_via  text,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_crawled    timestamptz,
  UNIQUE (platform, handle)
);

CREATE TABLE IF NOT EXISTS creator_metrics_snapshots (
  id          bigserial PRIMARY KEY,
  creator_id  uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  taken_at    timestamptz NOT NULL DEFAULT now(),
  followers   integer,
  following   integer,
  posts       integer,
  er_estimate numeric(8,5),
  source      text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_creator ON creator_metrics_snapshots(creator_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS content_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform_post_id   text NOT NULL,
  kind               text NOT NULL,            -- bio | post | reel | video | story
  posted_at          timestamptz,
  caption            text,
  transcript         text,
  vision_description text,
  media_urls         text[] DEFAULT '{}',
  raw                jsonb,
  embedding          vector(1024),
  UNIQUE (creator_id, platform_post_id)
);
CREATE INDEX IF NOT EXISTS idx_content_creator ON content_items(creator_id, posted_at DESC);

-- Registro de predicados: la ontología que crece
CREATE TABLE IF NOT EXISTS predicates (
  key                text PRIMARY KEY,
  label              text NOT NULL,
  tier               text NOT NULL CHECK (tier IN ('macro','micro')),
  value_type         text NOT NULL CHECK (value_type IN ('enum','number','date','text','object','boolean')),
  value_schema       jsonb NOT NULL DEFAULT '{}',
  temporal_kind      text NOT NULL CHECK (temporal_kind IN ('static','slow','event','point_in_time')),
  cardinality        text NOT NULL DEFAULT 'one' CHECK (cardinality IN ('one','many')),
  extraction_spec    jsonb NOT NULL DEFAULT '{}',
  derivations        jsonb NOT NULL DEFAULT '[]',
  created_from_brief uuid,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Claims: la unidad de datos. Nunca se editan, se superseden.
CREATE TABLE IF NOT EXISTS claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  predicate_key       text NOT NULL REFERENCES predicates(key),
  predicate_version   integer NOT NULL DEFAULT 1,
  value               jsonb NOT NULL,
  polarity            text NOT NULL DEFAULT 'affirms' CHECK (polarity IN ('affirms','denies')),
  observed_at         timestamptz,
  evidence_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  evidence_span       text,
  evidence_modality   text NOT NULL CHECK (evidence_modality IN ('caption','transcript','vision','bio','comment','external_api','human','metrics')),
  confidence          numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  extractor           jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','human_confirmed','human_rejected','superseded')),
  superseded_by       uuid REFERENCES claims(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claims_lookup ON claims(creator_id, predicate_key, status);
CREATE INDEX IF NOT EXISTS idx_claims_observed ON claims(observed_at);
CREATE INDEX IF NOT EXISTS idx_claims_value ON claims USING gin (value);

-- Facetas macro materializadas para el filtro determinista
CREATE TABLE IF NOT EXISTS creator_facets (
  creator_id        uuid PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  followers         integer,
  er_estimate       numeric(8,5),
  facets            jsonb NOT NULL DEFAULT '{}',   -- {predicate_key: [values]} solo tier macro
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facets_gin ON creator_facets USING gin (facets jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_facets_followers ON creator_facets(followers);

CREATE TABLE IF NOT EXISTS briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  raw_text    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brief_specs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id    uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  spec        jsonb NOT NULL,
  compiled_by jsonb NOT NULL DEFAULT '{}',
  approved_by text,
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brief_id, version)
);

CREATE TABLE IF NOT EXISTS brief_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id      uuid NOT NULL REFERENCES brief_specs(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  cost_usd     numeric(10,4) NOT NULL DEFAULT 0,
  stage_counts jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS run_results (
  run_id             uuid NOT NULL REFERENCES brief_runs(id) ON DELETE CASCADE,
  creator_id         uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  verdicts           jsonb NOT NULL,     -- {requirement_id: {verdict, reason, claim_ids[]}}
  overall            text NOT NULL CHECK (overall IN ('PASS','FAIL','UNKNOWN')),
  score              numeric(6,4),
  evidence_claim_ids uuid[] DEFAULT '{}',
  PRIMARY KEY (run_id, creator_id)
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES brief_runs(id) ON DELETE CASCADE,
  creator_id  uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  decision    text NOT NULL CHECK (decision IN ('accept','reject','needs_more')),
  reviewer    text NOT NULL,
  note        text,
  claim_id    uuid REFERENCES claims(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  predicate_key    text NOT NULL REFERENCES predicates(key),
  content_scope    jsonb NOT NULL DEFAULT '{}',
  provider         text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,
  idempotency_key  text NOT NULL UNIQUE,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

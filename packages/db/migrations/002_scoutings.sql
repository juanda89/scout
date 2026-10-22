-- Producto: usuarios (Auth.js), scoutings, etapas, eventos, resultados y shortlist.

-- Esquema requerido por @auth/pg-adapter (ids enteros, nombres con comillas tal como los espera el adaptador)
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255),
  email           VARCHAR(255) UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
  id                  SERIAL PRIMARY KEY,
  "userId"            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(255) NOT NULL,
  provider            VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL PRIMARY KEY,
  "userId"       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL UNIQUE
);

ALTER TABLE creators ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS profile_url text;

CREATE TABLE IF NOT EXISTS scoutings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       integer REFERENCES users(id) ON DELETE SET NULL,
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','running','done','failed','cancelled')),
  description    text NOT NULL DEFAULT '',
  fields         jsonb NOT NULL DEFAULT '{}',   -- campos de negocio confirmados (ver ScoutingFieldsSchema)
  field_sources  jsonb NOT NULL DEFAULT '{}',   -- {field: detected|suggested|inferred|user}
  spans          jsonb NOT NULL DEFAULT '[]',   -- [{field, start, end}] sobre description, para la figura "Your description"
  brief_id       uuid REFERENCES briefs(id),
  spec_id        uuid REFERENCES brief_specs(id),
  run_id         uuid REFERENCES brief_runs(id),
  stage          integer NOT NULL DEFAULT 0,    -- 0 = no iniciado, 1..5 etapa actual, 5 + done = terminado
  stage_progress numeric(5,4) NOT NULL DEFAULT 0,
  metrics        jsonb NOT NULL DEFAULT '{}',   -- {found, passed, analyzed, strong, criteria, cost_usd}
  notify_email   boolean NOT NULL DEFAULT true,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scoutings_owner ON scoutings(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scouting_stages (
  scouting_id uuid NOT NULL REFERENCES scoutings(id) ON DELETE CASCADE,
  n           integer NOT NULL CHECK (n BETWEEN 1 AND 5),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  detail      text,
  started_at  timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (scouting_id, n)
);

CREATE TABLE IF NOT EXISTS scouting_events (
  id          bigserial PRIMARY KEY,
  scouting_id uuid NOT NULL REFERENCES scoutings(id) ON DELETE CASCADE,
  stage       integer,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL DEFAULT 'info',   -- info | find | drop | warn | error
  text        text NOT NULL,
  data        jsonb
);
CREATE INDEX IF NOT EXISTS idx_scouting_events ON scouting_events(scouting_id, id DESC);

CREATE TABLE IF NOT EXISTS scouting_results (
  scouting_id         uuid NOT NULL REFERENCES scoutings(id) ON DELETE CASCADE,
  creator_id          uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  rank                integer NOT NULL,
  fit                 integer NOT NULL CHECK (fit BETWEEN 0 AND 100),
  fit_parts           jsonb NOT NULL,     -- {topic, audience, engagement, brand_safety, rate_vs_budget}
  tier                text NOT NULL,      -- excellent | very_good | good
  verdict             text NOT NULL,      -- PASS | UNKNOWN
  summary             text,
  pros                text[] NOT NULL DEFAULT '{}',
  cons                text[] NOT NULL DEFAULT '{}',
  estimated_rate_usd  numeric(10,2),
  followers           integer,
  er                  numeric(8,5),
  target_audience_pct numeric(5,2),
  platform            text,
  city                text,
  preliminary         boolean NOT NULL DEFAULT false,
  evidence_claim_ids  uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (scouting_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_results_rank ON scouting_results(scouting_id, rank);

CREATE TABLE IF NOT EXISTS shortlist (
  scouting_id uuid NOT NULL REFERENCES scoutings(id) ON DELETE CASCADE,
  creator_id  uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  added_by    integer REFERENCES users(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scouting_id, creator_id)
);

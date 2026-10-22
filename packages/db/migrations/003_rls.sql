-- Aislamiento por usuario con Row Level Security.
-- La web se conecta con el rol scout_app (sin privilegios) y fija app.user_id en cada transacción.
-- El worker y las migraciones usan el rol administrador, que no está sujeto a RLS.

CREATE OR REPLACE FUNCTION app_user_id() RETURNS integer
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::integer $$;

-- scoutings: solo el dueño
ALTER TABLE scoutings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoutings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scoutings_owner ON scoutings;
CREATE POLICY scoutings_owner ON scoutings
  USING (owner_id IS NOT NULL AND owner_id = app_user_id())
  WITH CHECK (owner_id IS NOT NULL AND owner_id = app_user_id());

-- tablas hijas: visibles si el scouting padre es del usuario
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scouting_stages','scouting_events','scouting_results','shortlist'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM scoutings s WHERE s.id = %I.scouting_id AND s.owner_id = app_user_id()))
                                   WITH CHECK (EXISTS (SELECT 1 FROM scoutings s WHERE s.id = %I.scouting_id AND s.owner_id = app_user_id()))',
      t || '_owner', t, t, t);
  END LOOP;
END $$;

-- Índice para las subconsultas de las políticas
CREATE INDEX IF NOT EXISTS idx_scoutings_owner_id ON scoutings(owner_id);

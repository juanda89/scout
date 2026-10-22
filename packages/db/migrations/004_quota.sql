-- Cupo de scoutings por usuario, aplicado por la base de datos.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('quota_per_user', '2'), ('admin_emails', '') ON CONFLICT (key) DO NOTHING;
GRANT SELECT ON app_settings TO PUBLIC;

ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_override integer;

/** Cupo efectivo de un usuario: override individual, o ilimitado si es admin, o el valor global. */
CREATE OR REPLACE FUNCTION user_quota(uid integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT quota_override FROM users WHERE id = uid),
    CASE WHEN EXISTS (
      SELECT 1 FROM users u WHERE u.id = uid
        AND lower(u.email) = ANY (string_to_array(lower(COALESCE((SELECT value FROM app_settings WHERE key = 'admin_emails'), '')), ','))
    ) THEN 2147483647 END,
    (SELECT value::integer FROM app_settings WHERE key = 'quota_per_user'),
    2);
$$;

/** Scoutings lanzados (no borradores ni cancelados) de un usuario. */
CREATE OR REPLACE FUNCTION user_scoutings_used(uid integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT count(*)::integer FROM scoutings WHERE owner_id = uid AND status NOT IN ('draft', 'cancelled');
$$;

/** Al pasar de borrador a lanzado, comprueba el cupo. Corre con los privilegios del dueño de la función (sin RLS). */
CREATE OR REPLACE FUNCTION enforce_scouting_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE used integer; q integer;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.status NOT IN ('draft','cancelled'))
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('draft','cancelled') AND NEW.status NOT IN ('draft','cancelled')) THEN
    SELECT user_scoutings_used(NEW.owner_id), user_quota(NEW.owner_id) INTO used, q;
    IF used >= q THEN
      RAISE EXCEPTION 'quota_exceeded: user % has used % of % scoutings', NEW.owner_id, used, q USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scouting_quota ON scoutings;
CREATE TRIGGER trg_scouting_quota BEFORE INSERT OR UPDATE OF status ON scoutings
  FOR EACH ROW EXECUTE FUNCTION enforce_scouting_quota();

GRANT EXECUTE ON FUNCTION user_quota(integer), user_scoutings_used(integer) TO PUBLIC;

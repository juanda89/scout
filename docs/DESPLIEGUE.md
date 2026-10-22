# Despliegue de pruebas (Lightsail)

Entorno ligero para probar Scout con datos reales. Una sola instancia con Docker Compose y una distribución CDN de Lightsail delante para HTTPS sin dominio propio.

| Pieza | Qué es | Costo |
|---|---|---|
| Instancia `scout-1` | Lightsail `small_3_0`: Ubuntu 24.04, 2 vCPU, 2 GB RAM (+2 GB swap), 60 GB SSD, IP fija `scout-ip` | 12 USD/mes |
| Distribución `scout-cdn` | Lightsail CDN (CloudFront) con certificado propio de AWS, sin caché, reenvía cookies, query y cabeceras | 2,50 USD/mes (50 GB) |
| Dentro de la instancia | `db` (Postgres 16 + pgvector), `web` (Next.js, puerto 80), `worker` (cola pg-boss) | incluido |

URL pública: `https://dvize5gk9sjfs.cloudfront.net`. Origen: `http://100.63.14.124` (solo HTTP; el tramo CDN → instancia va sin cifrar, aceptable para pruebas, no para datos sensibles de clientes).

## Credenciales y accesos

- AWS: perfil local `scout` en `~/.aws/credentials` (usuario IAM `ai-scoutting`). Las claves pasaron por el chat: **rotarlas** en IAM cuando termine la configuración.
- SSH: `~/.ssh/scout-lightsail.pem` (par de claves `scout-lightsail` en Lightsail), usuario `ubuntu`.
- Variables de producción: `.env.prod` en la raíz (ignorado por git). Contiene las claves de proveedores, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `DEV_LOGIN_SECRET`, `AUTH_URL` y `APP_URL`.
- Acceso a la app: Google OAuth activo (proyecto de Google Cloud `scoutting-login`, cliente "Scout web"; `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.prod`, `DEV_LOGIN=0`). Redirect URI: `https://dvize5gk9sjfs.cloudfront.net/api/auth/callback/google`. Desde el 2026-10-22 `ALLOWED_EMAILS` está vacío: entra cualquier cuenta de Google, cada una ve solo lo suyo (RLS) y tiene el cupo de scoutings; `ADMIN_EMAILS` no tiene límite. Páginas públicas: `/privacy` y `/terms` (textos parametrizados por `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION`).
- Consola de Google (proyecto `scoutting-login`): marca "Scout", enlaces de inicio, privacidad y términos apuntando a la URL de CloudFront, dominio autorizado `dvize5gk9sjfs.cloudfront.net`, sin scopes sensibles, y app **publicada** ("In production") el 2026-10-22. Al cambiar de dominio hay que actualizar enlaces, dominio autorizado y redirect URIs del cliente "Scout web".

## Aislamiento por usuario (RLS)

- La web se conecta con el rol `scout_app` (sin privilegios de DDL ni superusuario). Cada petición autenticada corre dentro de una transacción con `app.user_id` fijado al usuario de Auth.js (`runAsUser` en `packages/core/src/db.ts`, `withViewer` en `apps/web/lib/session.ts`).
- Políticas (`packages/db/migrations/003_rls.sql`): `scoutings` solo visible y escribible por su `owner_id`; `scouting_stages`, `scouting_events`, `scouting_results` y `shortlist` heredan la visibilidad del scouting padre. Sin `app.user_id` no se ve ninguna fila.
- El worker y las migraciones usan el rol administrador (`scout`), que no está sujeto a RLS porque procesa los scoutings de todos. El rol `scout_app` y sus permisos los crea `ensureAppRole()` a partir de `APP_DB_PASSWORD`, al migrar y al arrancar el worker.
- Las tablas compartidas (creadoras, contenido, claims, registro de predicados) no tienen RLS: son el índice común que todos los scoutings consultan.
- Quién puede entrar lo decide Auth.js (`ALLOWED_EMAILS` / `ALLOWED_DOMAIN`). Con ambas vacías entra cualquier cuenta de Google y cada usuario ve solo lo suyo.

## Cupo de scoutings por usuario

- `SCOUT_QUOTA_PER_USER` (2 por defecto) y `ADMIN_EMAILS` (sin límite) se sincronizan a la tabla `app_settings` al migrar y al arrancar el worker. `users.quota_override` permite un cupo individual.
- Lo aplica el trigger `trg_scouting_quota` al pasar un scouting de borrador a lanzado: cuenta los scoutings del dueño que no sean borrador ni cancelados y rechaza con `quota_exceeded` si alcanzó el cupo. La web muestra el cupo en la lista, bloquea "New scouting" al agotarlo y traduce el error al lanzar.
- Para dar más cupo a alguien: `UPDATE users SET quota_override = 10 WHERE email = '...'` en la base, o añadir el correo a `ADMIN_EMAILS` y redesplegar.

## Imágenes de creadoras (S3)

- Las URLs de Instagram caducan en horas y bloquean el hotlink, así que las fotos de perfil y los tres posts recientes de cada creadora en resultados se copian al bucket `scout-media-548984830494` (us-east-1), público solo para lectura de objetos.
- Regla de ciclo de vida: el prefijo `content/` se borra a los 7 días; `avatars/` es permanente.
- Variables (en `.env.prod`): `MEDIA_BUCKET`, `MEDIA_REGION` y las credenciales del usuario IAM `scout-media` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), que solo puede escribir y leer en ese bucket. Sin `MEDIA_BUCKET` la app muestra las URLs originales.
- Rellenar un scouting ya terminado: `docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T worker node_modules/.bin/tsx packages/core/src/cli.ts scouting media <scouting_id>`.

## Operar

```bash
# Redesplegar tras un push a main (reconstruye imágenes en la instancia)
./deploy/lightsail/deploy.sh 100.63.14.124 .env.prod

# Entrar
ssh -i ~/.ssh/scout-lightsail.pem ubuntu@100.63.14.124

# Logs
cd /opt/scout && docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f web worker

# CLI del motor dentro del contenedor del worker
cd /opt/scout && docker compose --env-file .env.prod -f docker-compose.prod.yml exec worker node_modules/.bin/tsx packages/core/src/cli.ts scouting list
```

La base de datos vive en el volumen Docker `pgdata` de la instancia. No hay backups automáticos: antes de usarlo con clientes, activar snapshots de Lightsail o pasar a RDS según `docs/PLAN_PRODUCCION.md`.

## Límites de este entorno

- Un solo nodo: si la instancia cae, cae todo. Sin autoscaling ni alta disponibilidad.
- El worker y la web comparten 2 GB de RAM; un scouting grande con ingesta Apify puede ser lento.
- Sin email de resultados (SES no configurado): el worker lo registra en el log.
- El puerto 80 de la instancia está abierto a internet (la distribución no puede restringirse por IP en Lightsail). La app exige sesión para todo.

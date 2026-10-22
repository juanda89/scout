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
- Acceso a la app: Google OAuth activo (proyecto de Google Cloud `scoutting-login`, cliente "Scout web"; `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.prod`, `DEV_LOGIN=0`). Redirect URI: `https://dvize5gk9sjfs.cloudfront.net/api/auth/callback/google`. Entra solo quien esté en `ALLOWED_EMAILS` o en `ALLOWED_DOMAIN`. Páginas públicas: `/privacy` y `/terms` (textos parametrizados por `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION`).
- Pendiente en la consola de Google (requiere sesión del dueño): marca, enlaces y "Publish app" para salir del modo Testing; ver `docs/HANDOFF_GOOGLE_OAUTH.md`, parte C.

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

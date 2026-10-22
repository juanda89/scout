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
- Acceso a la app: hasta tener Google OAuth, el sign-in de desarrollo pide un correo de `ALLOWED_EMAILS` y el código `DEV_LOGIN_SECRET`. Cuando existan `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, pon `DEV_LOGIN=0` y redespliega. Redirect URI de Google: `https://dvize5gk9sjfs.cloudfront.net/api/auth/callback/google`.

## Operar

```bash
# Redesplegar tras un push a main (reconstruye imágenes en la instancia)
./deploy/lightsail/deploy.sh 100.63.14.124 .env.prod

# Entrar
ssh -i ~/.ssh/scout-lightsail.pem ubuntu@100.63.14.124

# Logs
docker compose -f /opt/scout/docker-compose.prod.yml logs -f web worker

# CLI del motor dentro del contenedor del worker
docker compose -f /opt/scout/docker-compose.prod.yml exec worker node_modules/.bin/tsx packages/core/src/cli.ts scouting list
```

La base de datos vive en el volumen Docker `pgdata` de la instancia. No hay backups automáticos: antes de usarlo con clientes, activar snapshots de Lightsail o pasar a RDS según `docs/PLAN_PRODUCCION.md`.

## Límites de este entorno

- Un solo nodo: si la instancia cae, cae todo. Sin autoscaling ni alta disponibilidad.
- El worker y la web comparten 2 GB de RAM; un scouting grande con ingesta Apify puede ser lento.
- Sin email de resultados (SES no configurado): el worker lo registra en el log.
- El puerto 80 de la instancia está abierto a internet (la distribución no puede restringirse por IP en Lightsail). La app exige sesión para todo.

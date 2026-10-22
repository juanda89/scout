# Plan de producción: Scout

Objetivo: llevar el motor de scouting (docs/ARQUITECTURA.md) a un producto desplegado con el diseño de `docs/design/` (seis pantallas: Sign in, Scoutings, Scouting results, New scouting describe, Confirm the brief, Scouting in progress, más el componente Orb).

## 1. Qué muestra el diseño y cómo se mapea al motor

| Pantalla | Qué hace | Qué la alimenta |
|---|---|---|
| 01 Sign in | Google OAuth | Auth.js con Google, lista de correos o dominio permitido |
| 02 Scoutings | Lista: en progreso (con etapa y %) y completadas (best fit, avg fit, top 3) | tabla `scoutings` + agregados de `scouting_results` |
| 04 Describe | Texto libre; chips de qué detectó (platform, location, size, topic, audience, budget, timing); ejemplos | detección local por regex (como en el diseño) + compilador LLM al pasar de paso |
| 05 Confirm the brief | Formulario con campos detectados, requeridos y sugeridos; figura con la descripción marcada por número de campo; estado del brief; "Create scouting" | salida del compilador: `BriefSpec` + `brief_fields` (campos de negocio) + spans de evidencia en el texto |
| 06 In progress | 5 etapas con Orb, contadores (found, passed, analyzed, strong), progreso, actividad en vivo, early finds, email al terminar | worker: `scouting_stages`, `scouting_events` (log), métricas por etapa; SSE al navegador |
| 03 Results | Ranking por fit, filtros por plataforma, orden, panel lateral con cómo se construye el score (Topic, Audience, Engagement, Brand safety, Rate vs budget), pros y contras, métricas, shortlist, exportar CSV | `scouting_results` con `fit_parts`, `pros`, `cons`, `summary`, `estimated_rate`; `shortlist` |

Las cinco etapas del diseño son exactamente el embudo ya construido:

1. **Interpreting the brief** = compilador de briefs (Gemini) → BriefSpec + campos de negocio.
2. **Finding candidates** = ingesta Apify por hashtags/keywords derivados del brief, más filtro macro.
3. **Analyzing content** = clasificación macro (Jev) + extracción micro (Gemini) → claims.
4. **Evaluating audiences** = CreatorDB para quienes pasan el filtro duro.
5. **Scoring fit** = motor de reglas (PASS/FAIL/UNKNOWN) + fit score 0–100 por cinco componentes + explicación.

## 2. Arquitectura de producto

```
apps/web      Next.js 15 (App Router, React Server Components), Auth.js (Google), UI del diseño, API y SSE
apps/worker   Proceso Node que consume la cola (pg-boss sobre Postgres) y ejecuta las 5 etapas
packages/core El motor actual (registro, claims, extractores, reglas, proveedores) como paquete compartido
packages/db   Migraciones SQL (las actuales + scoutings, users, events, results, shortlist, jobs)
infra/        AWS CDK (TypeScript): VPC, RDS Postgres 16 + pgvector, ECS Fargate (web y worker), ALB + ACM, ECR, Secrets Manager, SES, CloudWatch
.github/      CI (typecheck, tests) y CD (build de imágenes, deploy CDK)
```

Decisiones:

- **Una sola base de datos Postgres** para datos y cola de trabajos (pg-boss). Evita Redis/SQS hasta que haga falta.
- **Worker separado de la web.** Un scouting dura horas; la web nunca ejecuta extracción. El worker escribe eventos y progreso; la web los sirve por SSE.
- **Fit score determinista.** Cinco componentes con pesos del brief: Topic (requisitos micro y categorías), Audience (ubicación y edad de CreatorDB vs brief), Engagement (ER vs mínimo y benchmark por tamaño), Brand safety (flags), Rate vs budget (tarifa estimada por seguidores vs presupuesto/creadoras). El LLM solo redacta `summary`, `pros` y `cons` a partir de la evidencia; nunca decide el número.
- **Costos controlados por scouting.** Presupuesto máximo en USD por corrida (ya existe en BriefSpec) y contadores por proveedor en `extraction_jobs`.
- **Email al terminar** con SES (el diseño lo promete en dos pantallas).

## 3. Infraestructura AWS (CDK)

| Recurso | Elección inicial | Costo aproximado mensual |
|---|---|---|
| RDS Postgres 16 | db.t4g.small, 20 GB gp3, backups 7 días, pgvector | 25–30 USD |
| ECS Fargate web | 1 tarea 0.5 vCPU / 1 GB, autoscaling 1–2 | 15–30 USD |
| ECS Fargate worker | 1 tarea 1 vCPU / 2 GB (escala a 0 cuando no hay cola, opcional) | 30–40 USD |
| ALB + ACM | 1 balanceador | 20 USD |
| NAT | Fargate en subred pública con IP pública para evitar NAT (ahorra 32 USD) | 0 |
| ECR, Secrets Manager, CloudWatch, SES | uso bajo | < 10 USD |

Total estimado: 90–130 USD al mes. Si prefieres empezar más barato, la alternativa es Neon (Postgres serverless) + Vercel (web) + un solo Fargate para el worker, unos 40–60 USD, pero con tres proveedores en vez de uno.

Dominio: el que elijas en Cloudflare. DNS en Cloudflare apuntando al ALB (CNAME), certificado en ACM validado por DNS. Cloudflare en modo proxy opcional (WAF y caché gratis).

## 4. Fases

1. **Monorepo y datos.** Mover el motor a `packages/core`, crear `apps/worker` y `apps/web`, migraciones nuevas, cola pg-boss. Hecho cuando un scouting se crea por API y el worker lo ejecuta de punta a punta en local.
2. **Web.** Las seis pantallas con fidelidad al diseño, Auth.js con Google, SSE de progreso, export CSV. Hecho cuando el flujo describe → confirm → progress → results funciona en local con datos reales.
3. **Infra.** CDK desplegado en tu cuenta, dominio en Cloudflare, CI/CD desde GitHub, SES verificado. Hecho cuando la URL pública sirve la app con HTTPS y un scouting corre en el worker de producción.
4. **Endurecimiento.** Límites de gasto por scouting, reintentos, alarmas CloudWatch, backups probados, retención de datos de menores, pruebas e2e.

## 5. Accesos necesarios (en orden de urgencia)

1. **AWS.** Un usuario IAM o rol con `AdministratorAccess` en la cuenta (idealmente una cuenta dedicada), y la región (sugerida `us-east-1`). Lo más limpio: configurar `aws login` (IAM Identity Center) en esta máquina o pasar access key y secret por `.env`, nunca por chat.
2. **Cloudflare.** El dominio elegido y un API token con permisos `Zone:DNS:Edit` y `Zone:Read` sobre esa zona.
3. **Google OAuth.** Un proyecto en Google Cloud con pantalla de consentimiento y un cliente OAuth web. Necesita la URL final para los redirect URIs; puedo guiarte paso a paso o, si me das acceso al proyecto, lo creo yo.
4. **GitHub.** Repositorio para el código y Actions. No hay `gh` ni remoto configurado; con un token o `gh auth login` lo creo y subo.
5. **SES.** Sale de AWS, pero requiere verificar el dominio y pedir salida del sandbox (formulario de AWS, 24 h).

Mientras llegan estos accesos, las fases 1 y 2 avanzan en local sin bloqueo.

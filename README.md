# scoutting

Prototipo de scouting determinista de creadoras para agencias de influencers. La IA extrae **hechos con evidencia** (claims); un motor de reglas en código decide PASS / FAIL / UNKNOWN. El diseño completo está en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Qué hay

| Capa | Archivo | Qué hace |
|---|---|---|
| Esquema SQL | `db/migrations/001_init.sql` | creators, content_items, predicates, claims, creator_facets, briefs, brief_specs, brief_runs, run_results, review_decisions, extraction_jobs |
| Tipos | `src/schema/*.ts` | Predicate, Claim, BriefSpec, Rule (zod) |
| Registro de predicados | `src/registry/` | Vocabulario macro inicial (`seed.ts`) y repositorio |
| Ingesta | `src/ingest/` | Fixtures locales y Apify (`apidojo/instagram-scraper`) |
| Extracción | `src/extract/` | Jev (clasificación masiva) y Claude (extracción estructurada con evidencia); ambos con modo mock determinista |
| Motor de reglas | `src/rules/` | Derivaciones temporales, resolución de conflictos, evaluación. Puro, sin IA, con tests |
| Compilador de briefs | `src/brief/` | Brief en texto -> BriefSpec aprobable; validación contra el registro |
| Embudo | `src/funnel/` | Filtro macro SQL -> cobertura -> extracción dirigida -> reglas -> enriquecimiento (CreatorDB) -> resultados |
| CLI | `src/cli.ts` | Todo lo anterior desde terminal |

## Arranque

Requisitos: Node 24, Docker.

```bash
npm install
docker compose up -d            # Postgres 16 + pgvector en localhost:5433
cp .env.example .env            # sin claves todo corre en modo mock
npm run scout -- db migrate
npm run scout -- registry seed
npm run scout -- ingest fixtures
npm run scout -- extract-macro
npm run scout -- brief compile fixtures/briefs/mamas-1-3.txt
npm run scout -- brief approve "Mamás" --by tu-nombre
npm run scout -- brief run "Mamás"
```

Otros comandos útiles:

```bash
npm run scout -- claims laura.mamaprimeriza --predicate child.age_mention
npm run scout -- query child.age_mention
npm run scout -- review <run_id> paula.unpost accept --by jd --predicate child.age_mention --value '{"amount":16,"unit":"months"}'
npm run scout -- registry list
npm test
```

## Modo mock y modo vivo

Cada proveedor corre en vivo si su clave está en `.env`; si falta, corre un mock determinista:

| Proveedor | Variable | Mock |
|---|---|---|
| Claude (compilador de briefs, extracción profunda) | `ANTHROPIC_API_KEY` | Specs precompiladas en `fixtures/briefspecs/` y extracción por expresiones regulares para los predicados de ejemplo |
| Jev (clasificación macro) | `TYPESAFE_API_KEY` | Palabras clave en español |
| Apify (ingesta) | `APIFY_TOKEN` | Solo fixtures |
| CreatorDB (audiencia) | `CREATORDB_API_KEY` | Números deterministas por handle |

`SCOUT_MOCK=1` fuerza mock aunque haya claves.

Los mocks existen para probar el pipeline, no la calidad de extracción. Con claves reales, el compilador y el extractor son genéricos: cualquier predicado nuevo que proponga un brief se extrae sin tocar código.

## Cómo fluye un brief

1. `brief compile` convierte el texto en un `BriefSpec`: filtros macro (SQL), requisitos con reglas, predicados nuevos propuestos, preguntas abiertas. Se guarda versionado y no ejecuta nada.
2. `brief approve` valida la spec contra el registro, registra los predicados nuevos y la habilita.
3. `brief run` ejecuta el embudo:
   - **[1] macro**: `SELECT` sobre `creator_facets`. Sin faceta = sin evidencia = no candidata.
   - **[2] cobertura**: por cada candidata y predicado, si ya hay un `extraction_job` terminado con el mismo alcance de contenido, no se vuelve a extraer.
   - **[3] extracción**: Jev para predicados con pregunta cerrada, Claude para valores estructurados. Todo se guarda como claims con post, cita, fecha y confianza.
   - **[4] reglas**: `src/rules/engine.ts`. Derivaciones (edad hoy = edad mencionada + meses desde el post), `min_evidence` por posts distintos, `max_evidence_age_days`, claims humanos que ganan, `denies` que fuerzan FAIL.
   - **[5] enriquecimiento**: audiencia de CreatorDB solo para PASS.
   - **[6] resultados**: `run_results` con veredicto por requisito y los ids de claims que lo sustentan.

## Pendiente para pasar de prototipo a producto

- Verificar el endpoint y los campos reales de CreatorDB (`src/enrich/creatordb.ts` asume una forma).
- Transcripción de video y descripción visual (`content_items.transcript`, `vision_description`) aún no se rellenan; los predicados ya los aceptan como modalidad.
- `location.city` es el único predicado macro que usa Claude; en volumen conviene moverlo a un modelo más barato o a Jev con una lista cerrada de ciudades.
- Embeddings (`content_items.embedding`) para lookalikes y moodboard: columna lista, sin uso.
- UI de revisión. Hoy la revisión es por CLI (`review`).
- Retención y anonimización de datos sobre menores (ver decisiones abiertas en la arquitectura).

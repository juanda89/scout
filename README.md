# scoutting

Prototipo de scouting determinista de creadoras para agencias de influencers. La IA extrae **hechos con evidencia** (claims); un motor de reglas en código decide PASS / FAIL / UNKNOWN. El diseño completo está en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Qué hay

| Capa | Archivo | Qué hace |
|---|---|---|
| Esquema SQL | `db/migrations/001_init.sql` | creators, content_items, predicates, claims, creator_facets, briefs, brief_specs, brief_runs, run_results, review_decisions, extraction_jobs |
| Tipos | `src/schema/*.ts` | Predicate, Claim, BriefSpec, Rule (zod) |
| Registro de predicados | `src/registry/` | Vocabulario macro inicial (`seed.ts`) y repositorio |
| Ingesta | `src/ingest/` | Fixtures locales y Apify (`apify/instagram-scraper`, modo `details` para perfiles y `posts` para hashtags) |
| LLM | `src/llm/client.ts` | Abstracción con salida estructurada: OpenRouter (Gemini por defecto) o Anthropic |
| Extracción | `src/extract/` | Clasificador macro (Jev, LLM barato o mock) y extractor estructurado con evidencia (LLM o mock) |
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

Ingesta real con Apify (con `APIFY_TOKEN`):

```bash
npm run scout -- ingest apify --profiles handle1,handle2
npm run scout -- ingest apify --hashtags mamaprimeriza,bebe --limit 100
```

El modo por perfil trae bio, seguidores y hasta 12 posts recientes por cuenta en un solo item. Algunas cuentas muy grandes devuelven la lista de posts vacía sin sesión; el perfil se guarda igual y se puede completar después con `--hashtags` o con otro actor (`APIFY_INSTAGRAM_ACTOR`). El plan gratuito de Apify incluye 5 USD de uso al mes, suficiente para probar; para cientos de perfiles por campaña conviene el plan Starter.

Otros comandos útiles:

```bash
npm run scout -- enrich nasa                      # demografía de audiencia de un perfil (CreatorDB)
npm run scout -- llm-probe                        # comprueba Jev, CreatorDB (créditos) y los modelos LLM
npm run scout -- claims laura.mamaprimeriza --predicate child.age_mention
npm run scout -- query child.age_mention
npm run scout -- review <run_id> paula.unpost accept --by jd --predicate child.age_mention --value '{"amount":16,"unit":"months"}'
npm run scout -- registry list
npm test
```

## Modo mock y modo vivo

Cada proveedor corre en vivo si su clave está en `.env`; si falta, corre un mock determinista:

| Rol | Variable | Por defecto en vivo | Mock |
|---|---|---|---|
| Razonamiento: compilar briefs y extraer hechos | `OPENROUTER_API_KEY` (o `ANTHROPIC_API_KEY`) | `google/gemini-3.8-flash` vía OpenRouter | Specs precompiladas en `fixtures/briefspecs/` y extracción por expresiones regulares para los predicados de ejemplo |
| Clasificación macro | `TYPESAFE_API_KEY` (Jev) o la misma clave LLM | Jev si hay clave; si no `google/gemini-3.5-flash-lite` | Palabras clave en español |
| Ingesta | `APIFY_TOKEN` | Apify | Solo fixtures |
| Audiencia | `CREATORDB_API_KEY` | CreatorDB API v3 (`POST /instagram/audience`, 10 créditos por perfil) | Números deterministas por handle |

Una sola clave de OpenRouter cubre los dos primeros roles. Los modelos se cambian con `LLM_MODEL_REASONING` y `LLM_MODEL_CLASSIFY` (cualquier id de OpenRouter). `SCOUT_MOCK=1` fuerza mock aunque haya claves; `npm run scout -- llm-probe` comprueba que los modelos configurados responden.

Costo medido en vivo sobre las 13 creadoras de prueba: la clasificación macro completa cuesta 0,003 USD con Jev (117 llamadas, 242 ms cada una) o 0,09 USD con Gemini 3.5-flash-lite; la compilación de un brief con Gemini 3.8-flash, 0,03 USD; la extracción profunda, unos 0,005 USD por creadora. Las facetas que producen Jev y Gemini son casi idénticas. El grueso del costo por corrida es la demografía de audiencia de CreatorDB (0,40 USD por finalista en pay-as-you-go).

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

- CreatorDB devuelve países en ISO alpha-3 (`USA`, `ESP`) y el vocabulario macro usa alpha-2; unificar cuando se use `audience.top_country` en reglas. El precio por crédito se ajusta con `CREATORDB_USD_PER_CREDIT` (0,04 PAYG, 0,025 Pro).
- Transcripción de video y descripción visual (`content_items.transcript`, `vision_description`) aún no se rellenan; los predicados ya los aceptan como modalidad.
- `location.city` es el único predicado macro que usa Claude; en volumen conviene moverlo a un modelo más barato o a Jev con una lista cerrada de ciudades.
- Embeddings (`content_items.embedding`) para lookalikes y moodboard: columna lista, sin uso.
- UI de revisión. Hoy la revisión es por CLI (`review`).
- Retención y anonimización de datos sobre menores (ver decisiones abiertas en la arquitectura).

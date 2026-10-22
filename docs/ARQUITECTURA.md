# Arquitectura de scouting: macro determinista + micro bajo demanda

Estado: borrador v1 (2026-10-21). Stack base acordado: Apify (ingesta) + CreatorDB pay-as-you-go (demografía de audiencia para finalistas) + Jev (clasificación masiva) + Claude (extracción profunda con evidencia) + Postgres.

## 1. El problema real

Los briefs llegan con peticiones arbitrariamente específicas ("mamás con hijos de 1 a 3 años", "corredores de maratón que usan Garmin y viven en Madrid", "parejas que renovaron su casa este año"). No se puede pre-extraer todo lo imaginable de cada creadora. Pero tampoco se puede empezar de cero en cada brief.

La solución es dividir el conocimiento en dos niveles con el mismo formato de almacenamiento:

| Nivel | Qué es | Cuándo se calcula | Para quién | Costo |
|---|---|---|---|---|
| **Macro** | Vocabulario cerrado y estable: categorías de contenido, etapa de vida, idioma, país, formato, tono, brand safety, tamaño | Al ingerir, para toda creadora crawleada | Todas | Centavos (Jev) |
| **Micro** | Vocabulario abierto que crece con cada brief: edad de hijos, marca de reloj, tipo de mascota, dieta | Bajo demanda, solo sobre candidatas que pasaron el filtro macro | Pocas | Caro (Claude, visión, transcripción) pero se guarda para siempre |

El filtro macro es una consulta SQL determinista sobre facetas indexadas. El filtro micro es extracción dirigida más reglas deterministas sobre los hechos extraídos. Ambos niveles producen el mismo tipo de registro: un **claim**.

## 2. La unidad de datos: el claim

Todo lo que la IA (o un humano) afirma sobre una creadora es un claim. Nunca se guarda "es mamá" como una columna booleana; se guarda la afirmación con su prueba.

```
claim
  id
  creator_id
  predicate_key        -> referencia al registro de predicados (ej. "child.birth_event", "life_stage")
  value                -> jsonb tipado según el predicado (enum, number, date, text, object)
  polarity             -> affirms | denies      (permite registrar "dice explícitamente que no tiene hijos")
  observed_at          -> fecha del post donde aparece la evidencia (NO la fecha de extracción)
  evidence_content_id  -> post / video / bio de donde sale
  evidence_span        -> cita textual, timestamp del video o bbox del frame
  evidence_modality    -> caption | transcript | vision | bio | comment | external_api
  confidence           -> 0..1 calibrada (Jev la da nativa; Claude la declara)
  extractor            -> {model, prompt_version, run_id}
  status               -> auto | human_confirmed | human_rejected | superseded
  superseded_by        -> claim_id (cuando una revisión humana o una re-extracción lo reemplaza)
  created_at
```

Reglas que hacen que esto funcione:

- **Un claim nunca se edita, se supersede.** Historial completo y auditable.
- **observed_at es la fecha de la evidencia.** Es lo que permite hacer matemática temporal determinista después.
- **La revisión humana también es un claim** (extractor = human, confidence = 1). No hay dos sistemas de verdad.
- **Los hechos derivados no se guardan como claims**, se calculan: la edad actual del hijo sale de un claim `child.birth_event` con `observed_at` más la fecha de hoy.

## 3. Registro de predicados: la ontología que crece

El registro es lo que mantiene el sistema flexible sin que se vuelva un pantano de JSON. Cada predicado se declara una vez y desde ahí es extraíble, consultable y evaluable por reglas.

```
predicate
  key                 -> "child.birth_event", "wearable.brand", "pet.species"
  label               -> texto para humanos
  tier                -> macro | micro
  value_type          -> enum | number | date | text | object
  value_schema        -> JSON Schema del valor (enum values, rango, campos del objeto)
  temporal_kind       -> static        (año de nacimiento)
                      |  slow          (ciudad de residencia)
                      |  event         (nacimiento, mudanza, boda: tiene fecha y de él se derivan cosas)
                      |  point_in_time (está embarazada, entrena para una carrera)
  cardinality         -> one | many     (una creadora puede tener varios hijos, varias mascotas)
  extraction_spec     -> cómo extraerlo: preguntas Jev (noul/choice/score), prompt Claude, si requiere visión o transcripción
  derivations         -> funciones deterministas que producen hechos virtuales (ej. child.age_months = today - birth_event.date)
  created_from_brief  -> brief_id si nació de un pedido específico
  version
```

Vocabulario macro inicial (cerrado, se calcula para todas):

- `content.category[]` (taxonomía tipo IAB adaptada a creadores: maternidad, fitness, belleza, cocina, viajes, gaming, finanzas...)
- `life_stage[]` (estudiante, pareja, padre/madre, embarazo, recién casada, jubilado...)
- `language.primary`, `location.country`, `location.city` (si lo declara)
- `format[]` (talking head, vlog, GRWM, tutorial, unboxing, storytime)
- `tone[]` (educativo, humor, aspiracional, cercano)
- `brand_safety.flags[]`, `sponsorship.has_history`, `sponsorship.categories[]`
- `audience.*` (viene de CreatorDB, solo para finalistas; se guarda también como claims con modality external_api)

Vocabulario micro: vacío al inicio. Cada brief que necesita algo nuevo lo registra. Ejemplos que irán apareciendo: `child.birth_event`, `child.age_bracket`, `wearable.brand`, `pet.species`, `home.renovation_event`, `diet.type`, `car.brand`, `sport.event_participation`.

Regla de oro: **antes de registrar un predicado nuevo, el compilador del brief busca uno existente que lo cubra.** Si "corredores de maratón" ya generó `sport.event_participation` con enum {marathon, half, 10k, triathlon}, un brief de triatlón lo reutiliza.

## 4. El compilador de briefs

Entrada: brief en lenguaje natural. Salida: `BriefSpec`, un documento estructurado que un humano aprueba antes de gastar un centavo.

```json
{
  "brief_id": "b_0042",
  "macro_filters": {
    "life_stage": {"any_of": ["parent"]},
    "language.primary": {"eq": "es"},
    "location.country": {"any_of": ["ES", "MX", "CO"]},
    "followers": {"between": [5000, 500000]},
    "brand_safety.flags": {"none_of": ["adult", "political_extreme"]}
  },
  "micro_requirements": [
    {
      "predicate": "child.birth_event",
      "status": "existing",
      "rule": {"derived": "child.age_months", "op": "between", "value": [12, 36]},
      "hard": true,
      "min_evidence": 2,
      "max_evidence_age_days": 365
    },
    {
      "predicate": "child.visible_in_content",
      "status": "new",
      "proposed_definition": {
        "value_type": "enum", "values": ["never", "sometimes", "often"],
        "temporal_kind": "slow",
        "extraction_spec": {"modality": ["vision"], "jev_question": {"type": "choice", "...": "..."}}
      },
      "rule": {"op": "in", "value": ["sometimes", "often"]},
      "hard": false,
      "weight": 0.3
    }
  ],
  "soft_scores": [
    {"predicate": "content.category", "contains": "maternidad", "weight": 0.4},
    {"source": "audience.gender_female_pct", "op": ">=", "value": 70, "weight": 0.3}
  ],
  "budget": {"max_candidates_deep": 300, "max_usd": 120}
}
```

Lo que hace el compilador, en orden:

1. Separa lo macro de lo micro. Lo macro se mapea a facetas existentes; si el brief pide algo macro que no existe (una categoría nueva), eso es señal de ampliar el vocabulario cerrado, no de crear un micro.
2. Para cada requisito micro, busca predicados existentes por similitud semántica y por enum. Propone reutilizar o crear.
3. Para predicados nuevos, genera la definición completa (tipo, esquema, temporalidad, preguntas de extracción).
4. Traduce cada requisito a una regla del DSL (sección 6).
5. Estima costo con los contadores del embudo y lo muestra.
6. Un humano aprueba, edita o rechaza. El BriefSpec aprobado se versiona.

## 4b. Descubrimiento: cómo se encuentran las candidatas

La medida de éxito del descubrimiento no es cuántos perfiles pasan los filtros de tamaño, zona e idioma, sino cuántas creadoras quedan **verificadas en el tema del brief**: los requisitos duros (p. ej. "reseña locales de comida callejera") con evidencia en sus posts. En la prueba de foodies de Medellín, 28 perfiles pasaban los filtros macro y el top 5 eran bailarines y humoristas de Medellín con buen engagement; medir solo filtros macro premia exactamente eso. Por eso `packages/core/src/scouting/discovery.ts` verifica cada lote en caliente (Jev sobre bio y captions, centavos) antes de decidir el siguiente paso, y trabaja como lo haría una persona con criterio: si una fuente rinde, insiste; si deja de rendir, la abandona (una página sin verificadas cierra esa consulta).

| Orden | Fuente | Qué hace | Costo |
|---|---|---|---|
| 0 | **Releer el índice** | Busca la zona del brief en handle, nombre, bio, geotags, captions y hashtags de lo ya guardado (`cityEvidence`) y verifica a quien ya pasa filtros. | Jev |
| 1 | **CreatorDB: tema × zona** | Nichos del tema (`keywords: niches|id_food_All`, elegidos cruzando palabras de nicho con la lista de 40.000) **y** hashtags de la zona (#medellin, #paisa, #mde). Luego los hashtags semilla del brief. | 0,04 USD por página + detalle Apify |
| 2 | **Bola de nieve desde las verificadas** (hasta 4 rondas) | a) `relatedCreator`: las cuentas que Instagram recomienda junto a las verificadas (el "similares" del índice). b) `taggedCreator`: quién más etiqueta los hubs que ellas etiquetan (festivales, guías, restaurantes: @medellingourmet, @burfest.col). c) los hashtags reales que usan dos o más verificadas (así aparece #medellingourmet). Una ronda que no aporta verificadas nuevas corta el bucle. | 0,04 USD por página + detalle Apify |
| 3 | **Más amplio** | Nicho del tema en todo el país; hashtags de la zona solos. Solo si sigue corto. | igual |
| 4 | **Apify** | Lo que el índice no tiene: búsqueda de perfiles por palabra clave y posts bajo los hashtags aprendidos. | Apify por resultado |

Meta: tres verificadas por creadora pedida (mínimo 6, máximo 60) o el presupuesto `SCOUT_DISCOVERY_MAX_USD` (3 USD). Cada consulta registra en `discovery_runs` perfiles traídos, nuevos, cuántos pasan filtros y cuántos quedaron verificados, con su costo: el rendimiento por dólar de cada fuente queda medido.

**Grafo de lugares (bola de nieve por donde se come).** Es lo que hace una persona: de una foodie verificada va al restaurante que reseñó, y en el feed del restaurante encuentra el post en colaboración con otra foodie. En código: los lugares son las cuentas que mencionan las verificadas y que no son creadoras del índice; se ordenan por peso (cuántas verificadas apuntan a cada uno, cuántas menciones) y se exploran los ocho mejores por ronda con el modo "posts" de Apify, donde un post en colaboración aparece con la creadora como dueña (3 puntos), y las etiquetas y menciones del lugar suman 1. Las cuentas nuevas se traen, se clasifican y se verifican antes de contar; una ronda sin verificadas nuevas corta el bucle. Es un ascenso por gradiente sobre la densidad de verificadas: se expande desde donde ya hay evidencia y solo mientras rinde.

**Verificación profunda con el reel.** Hay creadoras cuyos captions son "#viral #fyp" y toda la evidencia está en el video. Cuando bio y captions no bastan pero hay señales (publica de la categoría principal, tiene algún claim del tema o llegó por el grafo de lugares), se abren hasta dos reels (el fijado primero): Gemini recibe el audio del reel, el caption y los comentarios del público y responde con citas a las preguntas duras del brief, la ciudad donde graba y el tipo de cuenta (`packages/core/src/extract/deep.ts`). Cuesta unos 0,002 USD por reel en Gemini más 0,01 de Apify; el video completo (23 MB) no se envía porque el audio basta. Los claims quedan con modalidad `transcript` y el resumen del reel se guarda en el post. El mismo paso rescata perfiles que pasaban todo menos la ciudad: los comentarios ("eso en Medellín está caro") los sitúan. Presupuesto `SCOUT_DEEP_MAX_USD` (1,5 USD por corrida); `SCOUT_DEEP_VERIFY=0` lo apaga.

**Solo verificadas en la lista.** Con requisitos duros, la lista de resultados son las creadoras con evidencia (PASS). Quien pasó filtros de tamaño y zona pero no mostró evidencia del tema ni en bio, ni en posts, ni en el reel no es una recomendación: se cuenta ("N más sin evidencia") y no se lista.

**Calibración de Jev.** Las respuestas sí/no de Jev salen con confianzas prudentes: "buñuelo grande relleno de queso con su natilla" es comida antioqueña al 0,67 y "los típicos más típicos de Antioquia" al 0,77. Con el umbral general de 0,85 esas evidencias no contaban y foodies reales quedaban sin verificar. Los predicados clasificados por Jev usan su propio umbral (`JEV_MIN_CONFIDENCE`, 0,7; apoyo desde 0,6), calibrado leyendo muestras reales; el resto sigue en 0,85.

**Más posts no es la palanca.** Apify devuelve 12 posts por perfil en modo detalle (0,0025 USD por perfil); el modo posts da 30 pero cuesta 0,06 USD por perfil, 25 veces más, y no cambió ningún veredicto en la prueba.

**A quién mencionan los hubs.** Cuando las verificadas etiquetan los mismos sitios (un festival, una guía gastronómica), se leen los posts de esos hubs y se traen las cuentas que ellos mencionan: camino para creadoras que el índice de CreatorDB no tiene. En la prueba los hubs mencionaban sobre todo patrocinadores y restaurantes, así que rinde poco en foodies; se mantiene por su costo bajo.

**Creadora o negocio.** La plataforma marca las cuentas de negocio (`isBusinessAccount`) y eso se guarda como claim `account.kind` con confianza 0,97; si no es obvio, Jev lo decide por la bio y el handle. El filtro macro excluye negocios y medios.

**Ubicación lógica.** El brief se expande con un LLM a su alcance real (`expandLocation`): una ciudad incluye su área metropolitana, un departamento o región incluye todos sus municipios, "Latinoamérica" incluye todos sus países. Ciudad es filtro duro solo cuando el brief baja de país; país siempre. La evidencia de ciudad se obtiene primero sin IA: la ciudad o sus apodos en el handle o el nombre (0,85), en la bio (0,9), dos o más geotags (0,9), cuatro o más menciones en captions o hashtags (0,9) o dos o tres (0,8). Una sola mención no cuenta.

**Seguidores: duro pero lógico.** "Entre 200 y 500 mil" admite un 10 % de tolerancia (`FOLLOWER_TOLERANCE`): una creadora de 186 mil no queda fuera por redondeo.

**Proveedores.** Si Gemini devuelve 503 o 429, el cliente de OpenRouter reintenta con espera exponencial y modelos de respaldo; un perfil que aun así no se pudo clasificar queda en el índice para la siguiente corrida.

**Control de gasto por etapa.** Descubrimiento: `SCOUT_DISCOVERY_MAX_USD`. Informes de audiencia de CreatorDB (10 créditos, 0,40 USD cada uno): solo para las mejores por fit preliminar, el doble de las creadoras pedidas (mínimo 6), con tope `SCOUT_AUDIENCE_MAX_USD` (4 USD). El presupuesto del brief no es filtro ni puntúa: la tarifa se negocia con cada creadora y no se estima por seguidores.

**Orden de resultados.** Primero las creadoras que cumplen los requisitos duros con evidencia (PASS), después las no verificadas (UNKNOWN), y dentro de cada grupo por fit. Una no verificada tiene el componente de tema en 30, así que nunca llega a "fuerte".

**Diagnóstico.** Si tras descubrir hay menos candidatas que las pedidas, el pipeline calcula qué filtro dejó fuera a la mayoría y lo muestra con números en la pantalla de resultados.

**Imágenes.** Las URLs de Instagram caducan en horas: las fotos de perfil y los tres posts recientes de cada creadora en resultados se espejan en S3 (`packages/core/src/media/s3.ts`, variable `MEDIA_BUCKET`). Perfiles permanentes en `avatars/`; contenido en `content/` con regla de ciclo de vida de 7 días.

## 5. El embudo de ejecución

```
BriefSpec aprobado
   │
   ▼
[1] Filtro macro: SELECT sobre creator_facets (materializada, índices GIN)
   │   miles -> cientos. Costo: cero.
   ▼
[2] Cobertura de claims: para cada candidata y cada predicado micro,
   │   ¿ya hay claims vigentes (observed_at dentro de max_evidence_age)?
   │   Si sí, no se extrae nada. Si no, va a la cola de extracción.
   ▼
[3] Extracción dirigida, en capas de costo:
   │   a. Jev sobre captions/bio ya almacenados (centavos)
   │   b. Transcripción + descripción visual con Gemini Flash-Lite solo si el predicado lo exige
   │   c. Claude con salida estructurada para hechos con evidencia y cita
   │   Todo se guarda como claims. Nunca se vuelve a pagar por el mismo post y predicado.
   ▼
[4] Motor de reglas (código, sin IA): evalúa cada requisito -> PASS | FAIL | UNKNOWN
   │   con la lista de claims que lo sustentan.
   ▼
[5] Enriquecimiento externo solo para PASS: CreatorDB audiencia (10 créditos c/u)
   ▼
[6] Shortlist con evidencia -> revisión humana -> decisiones se guardan como claims humanos
```

UNKNOWN es un resultado de primera clase. Significa "no hay evidencia suficiente", no "no cumple". El reviewer decide si vale la pena pagar extracción más profunda o descartar.

## 6. DSL de reglas (deliberadamente pequeño)

Una regla siempre se evalúa contra los claims vigentes de un predicado para una creadora. Operadores:

| Operador | Sobre | Ejemplo |
|---|---|---|
| `eq`, `in`, `any_of`, `none_of` | enum, text | `pet.species in [dog]` |
| `between`, `>=`, `<=` | number, date, derivados | `child.age_months between [12,36]` |
| `exists`, `not_exists` | cualquier predicado | `home.renovation_event exists` |
| `derived` | aplica una derivación del predicado antes del operador | `derived: child.age_months` |
| `min_evidence` | número de claims independientes (distinto post) que sustentan el PASS | 2 |
| `max_evidence_age_days` | frescura: observed_at mínimo aceptado | 365 |
| `min_confidence` | umbral sobre la confianza calibrada | 0.85 |
| `polarity` | `affirms` por defecto; un claim `denies` reciente con alta confianza fuerza FAIL | |

Resolución de conflictos entre claims (determinista, en este orden): claim humano gana; luego el más reciente por `observed_at`; luego mayor confianza. Con cardinalidad `many`, la regla pasa si **algún** valor cumple (un hijo de 2 años basta aunque haya otro de 7), salvo que el BriefSpec diga `all`.

## 7. Esquema físico (Postgres)

Tablas núcleo:

- `creators` (id, platform, handle, display_name, discovered_via, first_seen, last_crawled)
- `creator_metrics_snapshots` (creator_id, taken_at, followers, following, posts, er_estimate, source)
- `content_items` (id, creator_id, platform_post_id, kind, posted_at, caption, transcript, vision_description, media_urls, raw jsonb, embedding vector)
- `predicates` (registro de la sección 3)
- `claims` (sección 2) con índices en (creator_id, predicate_key, status) y en observed_at
- `creator_facets` (materializada: una fila por creadora con arrays de los predicados macro vigentes; índices GIN; se refresca por trigger al insertar claims macro)
- `briefs`, `brief_specs` (jsonb versionado, approved_by, approved_at)
- `brief_runs` (spec_version, started_at, cost_usd, counts por etapa)
- `run_results` (run_id, creator_id, verdict_por_requisito jsonb, score, evidence_claim_ids[])
- `review_decisions` (run_id, creator_id, decision, reviewer, note) y su claim humano asociado
- `extraction_jobs` (creator_id, predicate_key, content_scope, status, cost_usd, idempotency_key)

Por qué no un grafo o un documento: con Postgres se consulta con SQL normal, pgvector cubre la similitud, y jsonb cubre la flexibilidad del valor. Un grafo se justificaría si aparecen relaciones entre creadoras (colaboraciones, familias), y los claims ya soportan eso con `value_type: object` apuntando a otro creator_id.

## 8. Consultas futuras que este modelo permite

- "Todas las creadoras que alguna vez confirmamos con perro": `claims` por `pet.species = dog` con status confirmado.
- "Quién tenía un bebé en 2025 y hoy tendría un hijo de 1 a 2 años": derivación sobre `child.birth_event`.
- "Reutilizar el BriefSpec de la campaña de pañales cambiando el país": clonar spec, editar macro_filters.
- "Qué predicados nos ha pedido cada marca y cuánto costó extraerlos": `predicates.created_from_brief` + `extraction_jobs.cost_usd`.
- "Precisión real por predicado": claims auto vs claims humanos que los superseden.

## 9. Segundo ejemplo, para comprobar que generaliza

Brief: "Hombres de 18 a 25 en Madrid que corren maratones y usan reloj Garmin".

- Macro: `content.category any_of [running, fitness]`, `location.city = Madrid`, `gender = male` (gender es macro, se infiere con confianza y se guarda como claim), `age_bracket any_of [18-24, 25-34]`.
- Micro existente: `sport.event_participation` (si ya existe por un brief anterior) con regla `in [marathon]`, `min_evidence 1`, `max_evidence_age_days 540`.
- Micro nuevo: `wearable.brand` enum {garmin, apple, coros, polar, other, none}, modality vision + caption, temporal slow.
- Derivación nueva: `age_years` a partir de `birth_year` (static) o de `age_mention` con observed_at.

Ni el pipeline, ni el motor de reglas, ni el esquema cambian. Solo se añaden dos filas en `predicates`.

## 10. Decisiones abiertas

1. Taxonomía macro inicial: cuántas categorías y etapas de vida. Propuesta: empezar con 25 categorías y 10 etapas de vida, ampliar cuando un brief no encaje.
2. Umbral de confianza por defecto para considerar un claim automático como evidencia: 0.85 para Jev (calibrado), 0.8 declarado para Claude, siempre con `min_evidence 2` en requisitos duros.
3. Retención: claims sobre menores (hijos) solo como rango de edad y evento con fecha, sin nombres ni descripciones físicas; `vision_description` no debe describir a niños más allá de "bebé presente".
4. Qué pasa cuando un predicado cambia de definición (nueva versión): los claims viejos quedan con la versión vieja y el compilador decide si son compatibles o si fuerza re-extracción.

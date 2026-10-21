import type { PredicateInput } from "../schema/predicate.js";

/**
 * Vocabulario MACRO inicial: cerrado, estable, se calcula para toda creadora al ingerir.
 * Cada predicado declara cómo se extrae (pregunta Jev) para que la ingesta sea automática.
 */
export const CATEGORY_VALUES = [
  "maternidad", "familia", "fitness", "running", "belleza", "moda", "cocina", "viajes",
  "hogar_decoracion", "finanzas", "tecnologia", "gaming", "educacion", "salud_bienestar",
  "mascotas", "humor", "lifestyle", "emprendimiento", "musica", "arte",
] as const;

export const LIFE_STAGE_VALUES = [
  "parent", "pregnant", "student", "couple", "newlywed", "single", "retired", "entrepreneur", "unknown",
] as const;

export const SEED_PREDICATES: PredicateInput[] = [
  {
    key: "content.category",
    label: "Categorías de contenido",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: [...CATEGORY_VALUES] },
    temporal_kind: "slow",
    cardinality: "many",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption", "bio"],
      jev: {
        type: "choice",
        instructions: "Qué categoría principal de contenido representa este texto de una creadora de redes sociales.",
        criteria: Object.fromEntries([...CATEGORY_VALUES, "ninguna"].map((v) => [v, null])),
        none_labels: ["ninguna"],
      },
    },
  },
  {
    key: "life_stage",
    label: "Etapa de vida declarada o evidente",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: [...LIFE_STAGE_VALUES] },
    temporal_kind: "slow",
    cardinality: "many",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption", "bio"],
      jev: {
        type: "choice",
        instructions: "Qué etapa de vida de la autora del texto se evidencia. 'parent' si habla de un hijo o hija propio; 'pregnant' si está embarazada; 'unknown' si no hay evidencia.",
        criteria: {
          parent: "Habla de su propio hijo, hija o bebé",
          pregnant: "Está embarazada o anuncia embarazo",
          student: "Estudia actualmente",
          couple: "Habla de su pareja de forma estable",
          newlywed: "Se casó recientemente",
          single: "Se declara soltera o soltero",
          retired: "Jubilada o jubilado",
          entrepreneur: "Tiene un negocio propio",
          unknown: "No hay evidencia de etapa de vida",
        },
        none_labels: ["unknown"],
      },
    },
  },
  {
    key: "language.primary",
    label: "Idioma principal",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["es", "en", "pt", "fr", "it", "de", "other"] },
    temporal_kind: "static",
    cardinality: "one",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption", "bio"],
      jev: {
        type: "choice",
        instructions: "En qué idioma está escrito principalmente este texto.",
        criteria: { es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", it: "Italiano", de: "Alemán", other: "Otro" },
      },
    },
  },
  {
    key: "location.country",
    label: "País de residencia declarado",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["ES", "MX", "CO", "AR", "CL", "PE", "US", "BR", "other", "unknown"] },
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: {
      provider: "jev",
      modalities: ["bio", "caption"],
      jev: {
        type: "choice",
        instructions: "En qué país vive la autora según este texto (ciudades, banderas, menciones explícitas). 'unknown' si no se puede saber.",
        criteria: { ES: "España", MX: "México", CO: "Colombia", AR: "Argentina", CL: "Chile", PE: "Perú", US: "Estados Unidos", BR: "Brasil", other: "Otro país", unknown: "No se puede saber" },
        none_labels: ["unknown"],
      },
    },
  },
  {
    key: "location.city",
    label: "Ciudad declarada",
    tier: "macro",
    value_type: "text",
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: {
      provider: "claude",
      modalities: ["bio", "caption"],
      claude: { instructions: "Ciudad de residencia de la creadora si la declara explícitamente (bio, 'vivo en', ubicación recurrente). Normaliza a nombre de ciudad en español sin país." },
    },
  },
  {
    key: "gender",
    label: "Género de la creadora",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["female", "male", "nonbinary", "unknown"] },
    temporal_kind: "static",
    cardinality: "one",
    extraction_spec: {
      provider: "jev",
      modalities: ["bio", "caption"],
      jev: {
        type: "choice",
        instructions: "Género con el que se identifica la autora según el texto (concordancias gramaticales, autodescripción). 'unknown' si no es claro.",
        criteria: { female: "Mujer", male: "Hombre", nonbinary: "No binario", unknown: "No es claro" },
        none_labels: ["unknown"],
      },
    },
  },
  {
    key: "age_bracket",
    label: "Rango de edad de la creadora",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["18-24", "25-34", "35-44", "45+", "unknown"] },
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: {
      provider: "jev",
      modalities: ["bio", "caption"],
      jev: {
        type: "choice",
        instructions: "Rango de edad de la autora si lo declara o es evidente (edad explícita, cumpleaños, 'tengo X años'). 'unknown' si no hay evidencia.",
        criteria: { "18-24": null, "25-34": null, "35-44": null, "45+": null, unknown: "Sin evidencia" },
        none_labels: ["unknown"],
      },
    },
  },
  {
    key: "format",
    label: "Formatos de contenido",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["talking_head", "vlog", "grwm", "tutorial", "unboxing", "storytime", "haul", "recipe", "workout", "other"] },
    temporal_kind: "slow",
    cardinality: "many",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption", "transcript"],
      jev: {
        type: "choice",
        instructions: "Qué formato de pieza describe este texto.",
        criteria: { talking_head: null, vlog: null, grwm: "Get ready with me", tutorial: null, unboxing: null, storytime: null, haul: null, recipe: null, workout: null, other: null },
        none_labels: ["other"],
      },
    },
  },
  {
    key: "brand_safety.flags",
    label: "Alertas de brand safety",
    tier: "macro",
    value_type: "enum",
    value_schema: { values: ["adult", "political_extreme", "hate", "violence", "gambling", "alcohol_heavy", "none"] },
    temporal_kind: "slow",
    cardinality: "many",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption", "bio", "transcript"],
      jev: {
        type: "choice",
        instructions: "Si el texto contiene alguna señal de riesgo para una marca. 'none' si no hay ninguna.",
        criteria: { adult: "Contenido sexual explícito", political_extreme: "Política extrema", hate: "Discurso de odio", violence: "Violencia", gambling: "Apuestas", alcohol_heavy: "Consumo excesivo de alcohol", none: "Sin señales" },
        none_labels: ["none"],
      },
    },
  },
  {
    key: "sponsorship.has_history",
    label: "Tiene historial de contenido patrocinado",
    tier: "macro",
    value_type: "boolean",
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: {
      provider: "jev",
      modalities: ["caption"],
      jev: { type: "noul", instructions: "Este texto es o describe una colaboración pagada o patrocinada (#ad, #publicidad, 'en colaboración con', código de descuento)." },
    },
  },
  // Audiencia: viene de CreatorDB solo para finalistas. Se registran como predicados para que
  // las reglas blandas puedan usarlos y para que queden como claims con modalidad external_api.
  {
    key: "audience.gender_female_pct",
    label: "Porcentaje de audiencia femenina",
    tier: "micro",
    value_type: "number",
    value_schema: { min: 0, max: 100 },
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: { provider: "external_api", modalities: [] },
  },
  {
    key: "audience.top_country",
    label: "País principal de la audiencia",
    tier: "micro",
    value_type: "text",
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: { provider: "external_api", modalities: [] },
  },
  {
    key: "audience.age_25_34_pct",
    label: "Porcentaje de audiencia de 25 a 34",
    tier: "micro",
    value_type: "number",
    value_schema: { min: 0, max: 100 },
    temporal_kind: "slow",
    cardinality: "one",
    extraction_spec: { provider: "external_api", modalities: [] },
  },
];

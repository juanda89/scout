import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { config, isLive, PRICES } from "../config.js";
import type { JevSpec } from "../schema/predicate.js";

export interface JevAnswer {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  score?: number;
}

export interface JevResult { answers: Record<string, JevAnswer>; inputTokens: number; costUsd: number }

export interface JevClient {
  readonly mode: "live" | "mock";
  ask(state: string, questions: Record<string, JevSpec>): Promise<JevResult>;
}

function toQuestions(specs: Record<string, JevSpec>): Questions {
  const q: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(specs)) {
    if (s.type === "noul") q[k] = { type: "noul", instructions: s.instructions };
    else if (s.type === "choice") q[k] = { type: "choice", instructions: s.instructions, criteria: s.criteria ?? {} };
    else q[k] = { type: "score", instructions: s.instructions, criteria: s.criteria ?? [] };
  }
  return q as Questions;
}

class LiveJev implements JevClient {
  readonly mode = "live" as const;
  private client = new TypeSafeClient({ apiKey: config.typesafeKey, defaultModel: config.jevModel });
  async ask(state: string, questions: Record<string, JevSpec>): Promise<JevResult> {
    const res = await this.client.systemOne({ state, questions: toQuestions(questions) });
    const usage = (res as unknown as { usage?: { input_tokens?: number } }).usage;
    const inputTokens = usage?.input_tokens ?? 0;
    return { answers: res.answers as unknown as Record<string, JevAnswer>, inputTokens, costUsd: (inputTokens / 1e6) * PRICES.jevPerMTokIn };
  }
}

/**
 * Mock determinista por palabras clave. Solo cubre los predicados del seed; cualquier
 * otra pregunta devuelve "sin evidencia". Sirve para correr el embudo sin claves.
 */
/** Regex con límites de palabra que entienden acentos (\b en JS es solo ASCII). */
function kw(words: string[]): RegExp {
  return new RegExp(`(?<![a-záéíóúñ])(?:${words.join("|")})(?![a-záéíóúñ])`, "i");
}
const KW = {
  parent: /\b(mi hij[oa]|mis hij[oa]s|mi beb[eé]|mi peque|mam[aá] de|pap[aá] de|pap[aá] primeriz|mam[aá] primeriz|a[ñn]ito|naci[oó] |nacimiento de|los peques|con mi hij)/i,
  pregnant: /\b(embaraz|semana \d+ de embarazo|esperando a)/i,
  single: /\bsolter[oa]\b/i,
  entrepreneur: /\b(mi negocio|emprend)/i,
  sponsored: /(#ad\b|#publicidad|#publi\b|colaboraci[oó]n con|c[oó]digo [A-Z0-9]{3,}|@\w+ #ad)/i,
  female: kw(["mam[aá]", "soltera", "entrenadora", "corredora", "decoradora", "embarazada", "primeriza", "cansada", "estrenada"]),
  male: kw(["pap[aá]", "soltero", "corredor", "entrenador", "primerizo"]),
  en: /\b(the|and|with|my|for|today)\b/i,
};
const CATEGORY_KW: Array<[string, RegExp]> = [
  ["maternidad", /\b(mam[aá]|beb[eé]|maternidad|postparto|embaraz|toddler|pur[eé]s|peque)/i],
  ["familia", /\b(familia|vuelta al cole|hij[oa]s?)\b/i],
  ["running", /\b(marat[oó]n|corredor|corredora|rodaje|series|km\b|running|garmin)/i],
  ["fitness", /\b(entren|workout|rutina|core|fitness)/i],
  ["viajes", /\b(viaj|tips de viaje|qu[eé] ver|cartagena|guatap[eé])/i],
  ["cocina", /\b(receta|cena de|cocina en)/i],
  ["hogar_decoracion", /\b(decoraci|reform|habitaci[oó]n|cojines|antes y despu[eé]s)/i],
  ["lifestyle", /\b(cafeter[ií]as|planes|lifestyle|atardecer)/i],
];
const COUNTRY_KW: Array<[string, RegExp]> = [
  ["ES", kw(["madrid", "valencia", "sevilla", "barcelona", "bilbao", "zaragoza", "m[aá]laga", "espa[ñn]a", "retiro", "casa de campo"])],
  ["MX", kw(["cdmx", "m[eé]xico", "monterrey", "guadalajara"])],
  ["CO", kw(["colombia", "bogot[aá]", "medell[ií]n", "cartagena", "guatap[eé]"])],
];

export function mockJevAnswer(key: string, spec: JevSpec, state: string): JevAnswer {
  const pick = (choice: string, p = 0.93): JevAnswer => ({ type: "choice", choice, confidence: p, probabilities: { [choice]: p } });
  switch (key) {
    case "life_stage": {
      if (KW.pregnant.test(state)) return pick("pregnant");
      if (KW.parent.test(state)) return pick("parent");
      if (KW.single.test(state)) return pick("single");
      if (KW.entrepreneur.test(state)) return pick("entrepreneur", 0.8);
      return pick("unknown");
    }
    case "content.category": {
      for (const [cat, re] of CATEGORY_KW) if (re.test(state)) return pick(cat, 0.9);
      return pick("ninguna");
    }
    case "language.primary": return pick(KW.en.test(state) && !/\b(el|la|de|con|mi)\b/i.test(state) ? "en" : "es", 0.98);
    case "location.country": {
      for (const [cc, re] of COUNTRY_KW) if (re.test(state)) return pick(cc, 0.9);
      return pick("unknown");
    }
    case "gender": {
      if (KW.female.test(state)) return pick("female", 0.9);
      if (KW.male.test(state)) return pick("male", 0.9);
      return pick("unknown");
    }
    case "age_bracket": {
      const m = state.match(/\b(?:tengo|cumplo)\s+(\d{2})\s+a[ñn]os|\b(\d{2})\s+a[ñn]os\s*\|/i);
      const age = m ? Number(m[1] ?? m[2]) : NaN;
      if (Number.isNaN(age)) return pick("unknown");
      return pick(age < 25 ? "18-24" : age < 35 ? "25-34" : age < 45 ? "35-44" : "45+", 0.9);
    }
    case "format": {
      if (/\bworkout|rutina\b/i.test(state)) return pick("workout", 0.85);
      if (/\breceta\b/i.test(state)) return pick("recipe", 0.85);
      if (/\bgu[ií]a|trucos|tips|lista\b/i.test(state)) return pick("tutorial", 0.8);
      return pick("other");
    }
    case "brand_safety.flags": return pick("none", 0.97);
    case "sponsorship.has_history": {
      const p = KW.sponsored.test(state) ? 0.95 : 0.05;
      return { type: "noul", noul: p };
    }
    default: {
      if (spec.type === "noul") return { type: "noul", noul: 0.1 };
      if (spec.type === "choice") {
        const labels = Object.keys((spec.criteria as Record<string, unknown>) ?? {});
        const none = spec.none_labels[0] ?? labels[labels.length - 1] ?? "unknown";
        return pick(none, 0.5);
      }
      return { type: "score", score: 0, confidence: 0.5 };
    }
  }
}

class MockJev implements JevClient {
  readonly mode = "mock" as const;
  async ask(state: string, questions: Record<string, JevSpec>): Promise<JevResult> {
    const answers: Record<string, JevAnswer> = {};
    for (const [k, s] of Object.entries(questions)) answers[k] = mockJevAnswer(k, s, state);
    const inputTokens = Math.ceil((state.length + JSON.stringify(questions).length) / 4);
    return { answers, inputTokens, costUsd: (inputTokens / 1e6) * PRICES.jevPerMTokIn };
  }
}

let instance: JevClient | null = null;
export function jev(): JevClient {
  if (!instance) instance = isLive("jev") ? new LiveJev() : new MockJev();
  return instance;
}

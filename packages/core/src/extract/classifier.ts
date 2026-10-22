import { z } from "zod/v4";
import { config } from "../config.js";
import type { JevSpec } from "../schema/predicate.js";
import { jev, mockJevAnswer, type JevAnswer } from "./jev.js";
import { llm } from "../llm/client.js";

export interface ClassifyItem { id: string; text: string }
export interface ClassifyResult { answers: Map<string, Record<string, JevAnswer>>; costUsd: number }

/**
 * Clasificador de vocabulario cerrado. Tres implementaciones con el mismo contrato de preguntas (noul/choice/score):
 *  - jev: una llamada por item (Jev es tan barato que no hace falta agrupar).
 *  - llm: un modelo barato (Gemini Flash-Lite por defecto) con lotes de items por llamada.
 *  - mock: palabras clave, sin red.
 */
export interface Classifier {
  readonly mode: "jev" | "llm" | "mock";
  readonly label: string;
  classify(items: ClassifyItem[], questions: Record<string, JevSpec>): Promise<ClassifyResult>;
}

class JevClassifier implements Classifier {
  readonly mode = "jev" as const;
  readonly label = `jev/${config.jevModel}`;
  async classify(items: ClassifyItem[], questions: Record<string, JevSpec>): Promise<ClassifyResult> {
    const client = jev();
    const answers = new Map<string, Record<string, JevAnswer>>();
    let costUsd = 0;
    for (const it of items) {
      const r = await client.ask(it.text, questions);
      answers.set(it.id, r.answers);
      costUsd += r.costUsd;
    }
    return { answers, costUsd };
  }
}

class MockClassifier implements Classifier {
  readonly mode = "mock" as const;
  readonly label = "mock";
  async classify(items: ClassifyItem[], questions: Record<string, JevSpec>): Promise<ClassifyResult> {
    const answers = new Map<string, Record<string, JevAnswer>>();
    for (const it of items) answers.set(it.id, Object.fromEntries(Object.entries(questions).map(([k, s]) => [k, mockJevAnswer(k, s, it.text)])));
    return { answers, costUsd: 0 };
  }
}

const BATCH = 25;

const LlmOutput = z.object({
  items: z.array(z.object({
    id: z.string(),
    answers: z.array(z.object({
      key: z.string(),
      /** Para choice: una etiqueta exacta de la lista. Para noul/score: null. */
      choice: z.string().nullable(),
      /** Para noul: probabilidad de que la afirmación sea cierta (0 a 1). Si no, null. */
      yes_probability: z.number().nullable(),
      /** Para score: índice del nivel elegido (0 = primero). Si no, null. */
      score: z.number().nullable(),
      confidence: z.number(),
    })),
  })),
});

const SYSTEM = `Eres un clasificador determinista de textos de creadoras de redes sociales (bios y captions, mayormente en español).
Para cada texto respondes TODAS las preguntas. Reglas:
- choice: devuelve exactamente una etiqueta de las listadas en "labels". Si no hay evidencia clara, usa la etiqueta marcada como "sin evidencia" cuando exista.
- noul: devuelve yes_probability entre 0 y 1 (probabilidad de que la afirmación sea cierta para ese texto).
- score: devuelve el índice del nivel (0 = primero de la lista).
- confidence es tu seguridad en la respuesta, entre 0 y 1. Sé conservador: solo >0.85 cuando el texto lo dice de forma inequívoca.
- No inventes: una bio sin ciudad no tiene país; un caption sin hijos no tiene etapa de vida "parent".
Responde solo el JSON pedido.`;

class LlmClassifier implements Classifier {
  readonly mode = "llm" as const;
  readonly label: string;
  constructor(private client: NonNullable<ReturnType<typeof llm>>) { this.label = `${client.provider}/${client.model}`; }
  async classify(items: ClassifyItem[], questions: Record<string, JevSpec>): Promise<ClassifyResult> {
    const answers = new Map<string, Record<string, JevAnswer>>();
    let costUsd = 0;
    const qdesc = Object.entries(questions).map(([key, s]) => ({
      key, type: s.type, instructions: s.instructions,
      ...(s.type === "choice" ? { labels: s.criteria as Record<string, string | null> } : {}),
      ...(s.type === "score" ? { levels: s.criteria as string[] } : {}),
    }));
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const r = await this.client.complete({
        system: SYSTEM,
        user: `PREGUNTAS:\n${JSON.stringify(qdesc)}\n\nTEXTOS:\n${JSON.stringify(batch)}`,
        schema: LlmOutput, schemaName: "classification", maxTokens: 4000,
      });
      costUsd += r.costUsd;
      for (const it of r.data.items) {
        const out: Record<string, JevAnswer> = {};
        for (const a of it.answers) {
          const spec = questions[a.key];
          if (!spec) continue;
          const conf = clamp(a.confidence);
          if (spec.type === "noul") out[a.key] = { type: "noul", noul: clamp(a.yes_probability ?? 0) };
          else if (spec.type === "choice") {
            const labels = Object.keys((spec.criteria as Record<string, unknown>) ?? {});
            if (!a.choice || !labels.includes(a.choice)) continue;
            out[a.key] = { type: "choice", choice: a.choice, confidence: conf, probabilities: { [a.choice]: conf } };
          } else out[a.key] = { type: "score", score: a.score ?? 0, confidence: conf };
        }
        answers.set(it.id, out);
      }
    }
    return { answers, costUsd };
  }
}

function clamp(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

let instance: Classifier | null = null;
export function classifier(): Classifier {
  if (instance) return instance;
  const want = config.classifier;
  const hasJev = !!config.typesafeKey && !config.forceMock;
  const l = llm("classify");
  if (want === "jev" || (want === "auto" && hasJev)) instance = new JevClassifier();
  else if (want === "llm" || (want === "auto" && l)) { if (!l) throw new Error("CLASSIFIER=llm pero no hay OPENROUTER_API_KEY ni ANTHROPIC_API_KEY"); instance = new LlmClassifier(l); }
  else instance = new MockClassifier();
  return instance;
}

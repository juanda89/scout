import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
// .env vive en la raíz del monorepo; también se acepta el cwd.
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"), quiet: true });
loadEnv({ quiet: true });

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://scout:scout@localhost:5433/scoutting",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  typesafeKey: process.env.TYPESAFE_API_KEY ?? "",
  apifyToken: process.env.APIFY_TOKEN ?? "",
  creatordbKey: process.env.CREATORDB_API_KEY ?? "",
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  /** auto: openrouter si hay clave, si no anthropic, si no mock. */
  llmProvider: (process.env.LLM_PROVIDER ?? "auto") as "auto" | "openrouter" | "anthropic",
  /** Modelo para razonar (compilar briefs, extracción profunda) y para clasificar (macro), por proveedor. */
  llmModelReasoning: {
    openrouter: process.env.LLM_MODEL_REASONING ?? "google/gemini-3.8-flash",
    anthropic: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  },
  llmModelClassify: {
    openrouter: process.env.LLM_MODEL_CLASSIFY ?? "google/gemini-3.5-flash-lite",
    anthropic: process.env.CLAUDE_MODEL_CLASSIFY ?? "claude-haiku-5-5",
  },
  /** Clasificador macro: auto = jev si hay clave, si no llm, si no mock. */
  classifier: (process.env.CLASSIFIER ?? "auto") as "auto" | "jev" | "llm" | "mock",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  jevModel: process.env.JEV_MODEL ?? "jev-latest",
  defaultMinConfidence: Number(process.env.DEFAULT_MIN_CONFIDENCE ?? 0.85),
  /** Jev responde sí/no con confianzas prudentes: "buñuelo con natilla" sale como comida antioqueña al 0,67. Umbral propio, calibrado con muestras reales. */
  jevMinConfidence: Number(process.env.JEV_MIN_CONFIDENCE ?? 0.7),
  /** Fuerza modo mock aunque haya claves (útil en tests): SCOUT_MOCK=1 */
  forceMock: process.env.SCOUT_MOCK === "1",
};

export type Provider = "claude" | "jev" | "apify" | "creatordb";

/** Un proveedor corre en vivo solo si hay clave y no se forzó mock. */
export function isLive(p: Provider): boolean {
  if (config.forceMock) return false;
  switch (p) {
    case "claude": return !!config.anthropicKey;
    case "jev": return !!config.typesafeKey;
    case "apify": return !!config.apifyToken;
    case "creatordb": return !!config.creatordbKey;
  }
}

/** Precios de referencia (USD). Se usan solo para estimar costo por corrida. */
export const PRICES = {
  jevPerMTokIn: 0.042,
  claudeInPerMTok: 4.0,     // claude-opus-5-5
  claudeOutPerMTok: 20.0,
  creatordbAudienceUsd: 0.40, // 10 créditos a 0,04 USD en PAYG
  apifyPerPostUsd: 0.0005,
};

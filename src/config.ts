import "dotenv/config";

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://scout:scout@localhost:5433/scoutting",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  typesafeKey: process.env.TYPESAFE_API_KEY ?? "",
  apifyToken: process.env.APIFY_TOKEN ?? "",
  creatordbKey: process.env.CREATORDB_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  jevModel: process.env.JEV_MODEL ?? "jev-latest",
  defaultMinConfidence: Number(process.env.DEFAULT_MIN_CONFIDENCE ?? 0.85),
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

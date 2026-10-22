import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// En desarrollo la web se conecta con el rol scout_app (RLS) si DATABASE_URL_WEB está definido.
if (process.env.DATABASE_URL_WEB) process.env.DATABASE_URL = process.env.DATABASE_URL_WEB;
process.env.SCOUT_PROCESS ??= "web";

const config: NextConfig = {
  transpilePackages: ["@scout/core"],
  serverExternalPackages: ["pg", "pg-boss", "@typesafe-ai/sdk", "apify-client", "@anthropic-ai/sdk", "dotenv"],
  output: "standalone",
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  // @scout/core usa imports ESM de Node con sufijo .js sobre fuentes .ts; webpack los resuelve con extensionAlias
  // (Turbopack aún no, por eso los scripts usan --webpack).
  webpack: (cfg) => { cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; return cfg; },
};
export default config;

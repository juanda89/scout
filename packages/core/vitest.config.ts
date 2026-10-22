import { defineConfig } from "vitest/config";
// Los tests nunca tocan la red aunque haya claves en .env
export default defineConfig({ test: { env: { SCOUT_MOCK: "1" } } });

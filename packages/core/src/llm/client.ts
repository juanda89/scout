import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { config } from "../config.js";

/**
 * Cliente LLM mínimo con salida estructurada. Dos proveedores:
 *  - openrouter: cualquier modelo (Gemini por defecto) vía chat/completions + json_schema estricto.
 *  - anthropic: Claude vía Messages API + output_config.format.
 * El resto del código no sabe qué modelo hay detrás.
 */
export interface CompletionRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Completion<T> { data: T; inputTokens: number; outputTokens: number; costUsd: number; model: string }

export interface LlmClient {
  readonly provider: "openrouter" | "anthropic";
  readonly model: string;
  complete<T>(req: CompletionRequest<T>): Promise<Completion<T>>;
}

export type LlmRole = "reasoning" | "classify";

/** JSON Schema estricto (todas las propiedades requeridas, sin extras) a partir de zod v4. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return tighten(js) as Record<string, unknown>;
}
function tighten(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tighten);
  if (typeof node !== "object" || node === null) return node;
  const o = { ...(node as Record<string, unknown>) };
  if (o.type === "object" && typeof o.properties === "object" && o.properties) {
    o.additionalProperties = false;
    o.required = Object.keys(o.properties as Record<string, unknown>);
    o.properties = Object.fromEntries(Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => [k, tighten(v)]));
  }
  if (o.items) o.items = tighten(o.items);
  if (Array.isArray(o.anyOf)) o.anyOf = o.anyOf.map(tighten);
  return o;
}

/** Modelos de respaldo por si el principal devuelve 5xx o 429 (OpenRouter los prueba en orden). */
const FALLBACKS: Record<string, string[]> = {
  "google/gemini-3.8-flash": ["google/gemini-3.7-flash", "google/gemini-2.5-flash"],
  "google/gemini-3.5-flash-lite": ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"],
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class OpenRouterClient implements LlmClient {
  readonly provider = "openrouter" as const;
  constructor(readonly model: string) {}
  async complete<T>(req: CompletionRequest<T>): Promise<Completion<T>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await this.once(req); }
      catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/OpenRouter (5\d\d|429)|UNAVAILABLE|high demand|overloaded|rate limit/i.test(msg) || attempt === 3) throw e;
        await sleep(1500 * 2 ** attempt);
      }
    }
    throw lastErr;
  }
  private async once<T>(req: CompletionRequest<T>): Promise<Completion<T>> {
    const extra = (process.env.LLM_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const models = [this.model, ...(FALLBACKS[this.model] ?? []), ...extra];
    const body = {
      model: this.model,
      models,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: strictJsonSchema(req.schema) } },
      provider: { require_parameters: true },
      usage: { include: true },
      max_tokens: req.maxTokens ?? 8000,
      temperature: req.temperature ?? 0,
    };
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openrouterKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/scoutting", "X-Title": "scoutting" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
    if (j.error) throw new Error(`OpenRouter: ${j.error.message}`);
    const content = j.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(stripFences(content)); } catch { throw new Error(`OpenRouter (${this.model}) no devolvió JSON válido: ${content.slice(0, 300)}`); }
    const data = req.schema.parse(parsed);
    const served = (j as { model?: string }).model ?? this.model;
    return { data, inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0, costUsd: j.usage?.cost ?? 0, model: served };
  }
}

class AnthropicClient implements LlmClient {
  readonly provider = "anthropic" as const;
  private client = new Anthropic({ apiKey: config.anthropicKey });
  constructor(readonly model: string) {}
  async complete<T>(req: CompletionRequest<T>): Promise<Completion<T>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      output_config: { format: { type: "json_schema", schema: strictJsonSchema(req.schema) } },
      messages: [{ role: "user", content: req.user }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    if (res.stop_reason === "refusal" || !text) throw new Error(`Claude sin salida (stop_reason=${res.stop_reason})`);
    const data = req.schema.parse(JSON.parse(text));
    const costUsd = (res.usage.input_tokens / 1e6) * 4 + (res.usage.output_tokens / 1e6) * 20; // claude-opus-5-5
    return { data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd, model: this.model };
  }
}

function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}

const cache = new Map<string, LlmClient>();

/** Devuelve el cliente para un rol, o null si no hay proveedor configurado (modo mock). */
export function llm(role: LlmRole): LlmClient | null {
  const provider = config.llmProvider === "auto" ? (config.openrouterKey ? "openrouter" : config.anthropicKey ? "anthropic" : null) : config.llmProvider;
  if (!provider || config.forceMock) return null;
  if (provider === "openrouter" && !config.openrouterKey) return null;
  if (provider === "anthropic" && !config.anthropicKey) return null;
  const model = role === "classify" ? config.llmModelClassify[provider] : config.llmModelReasoning[provider];
  const key = `${provider}:${model}`;
  let c = cache.get(key);
  if (!c) { c = provider === "openrouter" ? new OpenRouterClient(model) : new AnthropicClient(model); cache.set(key, c); }
  return c;
}

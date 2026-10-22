import { z } from "zod/v4";
import { llm } from "../llm/client.js";
import type { ScoutingFields } from "./types.js";

/** Semillas de búsqueda (hashtags y handles) derivadas del brief para la etapa "Finding candidates". */
export interface Seeds { hashtags: string[]; keywords: string[] }

const Out = z.object({ hashtags: z.array(z.string()), keywords: z.array(z.string()) });

export async function deriveSeeds(f: ScoutingFields, max = 8): Promise<Seeds> {
  const client = llm("classify");
  const fallback = fallbackSeeds(f, max);
  if (!client) return fallback;
  try {
    const res = await client.complete({
      system: `Propones hashtags de Instagram/TikTok reales y populares en el idioma del contenido para encontrar creadoras. Sin el símbolo #, en minúsculas, sin espacios. Mezcla tema + lugar (ej. runningbogota) y tema general. Devuelve como máximo ${max} hashtags y hasta 5 palabras clave.`,
      user: JSON.stringify({ topics: f.topics, location: f.location, countries: f.countries, language: f.language, platforms: f.platforms }),
      schema: Out, schemaName: "seeds", maxTokens: 800,
    });
    const hashtags = [...new Set([...res.data.hashtags.map(clean), ...fallback.hashtags])].filter(Boolean).slice(0, max);
    return { hashtags, keywords: res.data.keywords.slice(0, 5) };
  } catch { return fallback; }
}

const clean = (s: string) => s.toLowerCase().replace(/^#/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function fallbackSeeds(f: ScoutingFields, max = 8): Seeds {
  const places = f.location.split(/[,&y]|and/i).map((s) => clean(s.replace(/\(.*\)/, ""))).filter((s) => s.length > 2);
  const topics = f.topics.map(clean).filter(Boolean);
  const tags = new Set<string>();
  for (const t of topics) { tags.add(t); for (const p of places) tags.add(t + p); }
  return { hashtags: [...tags].slice(0, max), keywords: f.topics.slice(0, 5) };
}

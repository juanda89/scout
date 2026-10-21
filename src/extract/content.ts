import { db } from "../db.js";

export interface ContentItem {
  id: string;
  creator_id: string;
  kind: string;
  posted_at: Date | null;
  caption: string | null;
  transcript: string | null;
  vision_description: string | null;
}

export async function loadContent(creatorId: string, maxItems = 30): Promise<ContentItem[]> {
  const { rows } = await db().query(
    `SELECT id, creator_id, kind, posted_at, caption, transcript, vision_description
     FROM content_items WHERE creator_id = $1
     ORDER BY (kind = 'bio') DESC, posted_at DESC NULLS LAST LIMIT $2`,
    [creatorId, maxItems],
  );
  return rows as ContentItem[];
}

/** Texto y modalidad de un item según lo que haya disponible. */
export function textOf(item: ContentItem): Array<{ modality: "bio" | "caption" | "transcript" | "vision"; text: string }> {
  const out: Array<{ modality: "bio" | "caption" | "transcript" | "vision"; text: string }> = [];
  if (item.kind === "bio" && item.caption) out.push({ modality: "bio", text: item.caption });
  else if (item.caption) out.push({ modality: "caption", text: item.caption });
  if (item.transcript) out.push({ modality: "transcript", text: item.transcript });
  if (item.vision_description) out.push({ modality: "vision", text: item.vision_description });
  return out;
}

/** Huella determinista del alcance de contenido, para idempotencia de extracciones. */
export function scopeHash(items: ContentItem[]): string {
  const latest = items.reduce((m, i) => Math.max(m, i.posted_at?.getTime() ?? 0), 0);
  return `${items.length}:${latest}`;
}

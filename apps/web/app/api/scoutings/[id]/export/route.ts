import { viewerOrNull } from "@/lib/session";
import { runAsUser } from "@scout/core/db";
import { listResults } from "@scout/core/scouting/repo";
import { getScouting } from "@scout/core/scouting/repo";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const data = await runAsUser(viewer.id, async () => { const s = await getScouting(id); return s ? { s, rows: await listResults(id, { limit: 1000 }) } : null; });
  if (!data) return new Response("not found", { status: 404 });
  const { s, rows } = data;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["rank", "name", "handle", "platform", "city", "followers", "engagement_pct", "target_audience_pct", "fit", "tier", "topic", "audience", "engagement", "brand_safety", "on_shortlist", "summary", "pros", "cons", "profile_url"];
  const lines = rows.map((r) => [r.rank, r.display_name ?? r.handle, "@" + r.handle, r.platform, r.city, r.followers, r.er == null ? "" : (r.er * 100).toFixed(2), r.target_audience_pct, r.fit, r.tier, r.fit_parts.topic, r.fit_parts.audience, r.fit_parts.engagement, r.fit_parts.brand_safety, r.on_shortlist ? "yes" : "no", r.summary, r.pros.join(" | "), r.cons.join(" | "), `https://www.${r.platform === "tiktok" ? "tiktok.com/@" : r.platform === "youtube" ? "youtube.com/@" : "instagram.com/"}${r.handle}`].map(esc).join(","));
  const csv = [head.join(","), ...lines].join("\r\n");
  const name = s.name.replace(/[^\w\-]+/g, "_").slice(0, 60);
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="scout_${name}.csv"` } });
}

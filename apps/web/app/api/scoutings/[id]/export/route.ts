import { auth } from "@/auth";
import { listResults } from "@scout/core/scouting/repo";
import { getScouting } from "@scout/core/scouting/repo";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const s = await getScouting(id);
  if (!s) return new Response("not found", { status: 404 });
  const rows = await listResults(id, { limit: 1000 });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["rank", "name", "handle", "platform", "city", "followers", "engagement_pct", "target_audience_pct", "fit", "tier", "topic", "audience", "engagement", "brand_safety", "rate_vs_budget", "estimated_rate_usd", "on_shortlist", "summary", "pros", "cons", "profile_url"];
  const lines = rows.map((r) => [r.rank, r.display_name ?? r.handle, "@" + r.handle, r.platform, r.city, r.followers, r.er == null ? "" : (r.er * 100).toFixed(2), r.target_audience_pct, r.fit, r.tier, r.fit_parts.topic, r.fit_parts.audience, r.fit_parts.engagement, r.fit_parts.brand_safety, r.fit_parts.rate_vs_budget, r.estimated_rate_usd, r.on_shortlist ? "yes" : "no", r.summary, r.pros.join(" | "), r.cons.join(" | "), `https://www.${r.platform === "tiktok" ? "tiktok.com/@" : r.platform === "youtube" ? "youtube.com/@" : "instagram.com/"}${r.handle}`].map(esc).join(","));
  const csv = [head.join(","), ...lines].join("\r\n");
  const name = s.name.replace(/[^\w\-]+/g, "_").slice(0, 60);
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="scout_${name}.csv"` } });
}

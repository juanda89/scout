"use client";
import { useMemo, useState, useTransition } from "react";
import { Avatar, FitRing } from "@/components/FitRing";
import { toggleShortlistAction } from "@/lib/actions";
import type { ScoutingResult } from "@/lib/data";
import { FIT_LABELS, type FitParts } from "@scout/core/scouting/types";
import { fmtK, fmtPct, platformLabel, tierColor } from "@/lib/format";

const PAGE = 10;

export function Results({ id, results }: { id: string; results: ScoutingResult[] }) {
  const [sel, setSel] = useState<string | null>(results[0]?.creator_id ?? null);
  const [plat, setPlat] = useState("all");
  const [sort, setSort] = useState<"fit" | "followers" | "engagement">("fit");
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<Record<string, boolean>>(Object.fromEntries(results.map((r) => [r.creator_id, !!r.on_shortlist])));
  const [, start] = useTransition();

  const rows = useMemo(() => {
    const list = results.filter((r) => plat === "all" || r.platform === plat);
    if (sort === "followers") list.sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
    else if (sort === "engagement") list.sort((a, b) => (b.er ?? 0) - (a.er ?? 0));
    else list.sort((a, b) => a.rank - b.rank);
    return list;
  }, [results, plat, sort]);
  const cur = results.find((r) => r.creator_id === sel) ?? rows[0] ?? null;
  const plats = ["all", ...new Set(results.map((r) => r.platform).filter((p): p is string => !!p))];
  const toggle = (creatorId: string) => { setSaved((s) => ({ ...s, [creatorId]: !s[creatorId] })); start(async () => { const on = await toggleShortlistAction(id, creatorId); setSaved((s) => ({ ...s, [creatorId]: on })); }); };
  const profileUrl = (r: ScoutingResult) => r.platform === "tiktok" ? `https://www.tiktok.com/@${r.handle}` : r.platform === "youtube" ? `https://www.youtube.com/@${r.handle}` : `https://www.instagram.com/${r.handle}/`;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
      <section aria-label="Creators" className="card" style={{ flex: "999 1 640px", minWidth: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px 14px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-3)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{results.length} creators</h2>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>ranked by fit with the brief</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {plats.length > 2 && (
              <div role="group" aria-label="Platform" className="seggroup sm">
                {plats.map((p) => <button key={p} className="seg" aria-pressed={plat === p} onClick={() => { setPlat(p); setShown(PAGE); }}>{p === "all" ? "All" : platformLabel(p)}</button>)}
              </div>
            )}
            <div className="selectwrap">
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="in" style={{ height: 32, width: "auto", padding: "0 30px 0 10px", borderRadius: 9, fontSize: 12.5, fontWeight: 500 }}>
                <option value="fit">Sort: fit</option><option value="followers">Sort: followers</option><option value="engagement">Sort: engagement</option>
              </select>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#52525B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ top: 9, right: 9 }}><path d="m4 6 4 4 4-4" /></svg>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 680, padding: "6px 8px 8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "24px minmax(200px, 1fr) 84px 84px 92px 128px", gap: 14, alignItems: "center", padding: "8px 12px", fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
              <span>#</span><span>Creator</span><span style={{ textAlign: "right" }}>Followers</span><span style={{ textAlign: "right" }}>Engagement</span><span style={{ textAlign: "right" }}>Target aud.</span><span>Fit</span>
            </div>
            {rows.slice(0, shown).map((r) => { const t = tierColor(r.fit); return (
              <button key={r.creator_id} className="row" aria-pressed={cur?.creator_id === r.creator_id} onClick={() => setSel(r.creator_id)}>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{String(r.rank).padStart(2, "0")}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Avatar name={r.display_name ?? r.handle ?? "?"} src={r.avatar_url} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.display_name ?? r.handle}</span>
                    <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>@{r.handle} · {platformLabel(r.platform)}</span>
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 13, textAlign: "right" }}>{fmtK(r.followers)}</span>
                <span className="mono" style={{ fontSize: 13, textAlign: "right" }}>{fmtPct(r.er)}</span>
                <span className="mono" style={{ fontSize: 13, textAlign: "right" }}>{r.target_audience_pct == null ? "—" : `${Math.round(r.target_audience_pct)}%`}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><FitRing fit={r.fit} /><span style={{ fontSize: 12.5, fontWeight: 500, color: t.text }}>{t.label}</span></span>
              </button>
            ); })}
            {!rows.length && <p style={{ margin: 0, padding: "24px 12px", fontSize: 13.5, color: "var(--muted)" }}>No creators on this platform.</p>}
          </div>
        </div>
        <div className="card-foot" style={{ padding: "12px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Showing {Math.min(shown, rows.length)} of {rows.length}</span>
          {shown < rows.length && <button className="sec" style={{ height: 32, padding: "0 12px", borderRadius: 9, fontSize: 13 }} onClick={() => setShown((n) => n + PAGE)}>Load more</button>}
        </div>
      </section>

      {cur && (() => { const t = tierColor(cur.fit); const parts = Object.entries(cur.fit_parts) as Array<[keyof FitParts, number]>; const isSaved = !!saved[cur.creator_id]; return (
        <aside aria-label="Creator details" className="card" style={{ flex: "1 1 340px", maxWidth: 420, minWidth: 0, display: "flex", flexDirection: "column", boxShadow: "var(--shadow-2)", overflow: "hidden" }}>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, borderBottom: "1px solid var(--line-3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={cur.display_name ?? cur.handle ?? "?"} size={56} src={cur.avatar_url} />
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 18, lineHeight: 1.25, fontWeight: 600, letterSpacing: "-0.015em" }}>{cur.display_name ?? cur.handle}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>@{cur.handle} · {platformLabel(cur.platform)}{cur.city ? ` · ${cur.city}` : ""}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" aria-pressed={isSaved} onClick={() => toggle(cur.creator_id)} style={{ flex: 1, height: 38, justifyContent: "center", fontSize: 13.5 }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.5L8 10.8l-4.5 2.7V3a.5.5 0 0 1 .5-.5Z" /></svg>
                <span>{isSaved ? "On shortlist" : "Add to shortlist"}</span>
              </button>
              <a href={profileUrl(cur)} target="_blank" rel="noreferrer" className="sec" style={{ height: 38, padding: "0 12px", fontSize: 13.5 }}>
                <span>View profile</span>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9" /></svg>
              </a>
            </div>
          </div>
          <div style={{ padding: 20, display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid var(--line-3)" }}>
            <FitRing fit={cur.fit} size={72} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{t.long}</span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-3)", textWrap: "pretty" }}>{cur.summary ?? (cur.verdict === "UNKNOWN" ? "Some brief requirements could not be verified from public content yet." : "")}</span>
            </div>
          </div>
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, borderBottom: "1px solid var(--line-3)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>How the score is built</span>
            {parts.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}><span style={{ fontSize: 13, color: "var(--ink-2)" }}>{FIT_LABELS[k]}</span><span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{v}</span></div>
                <div aria-hidden="true" style={{ height: 5, borderRadius: 3, background: "#EFEFF1", overflow: "hidden" }}><div style={{ width: `${v}%`, height: 5, borderRadius: 3, background: v >= 90 ? "#15803D" : v >= 80 ? "#0B0B0C" : "#9A9AA2" }} /></div>
              </div>
            ))}
          </div>
          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, borderBottom: "1px solid var(--line-3)" }}>
            {[["Followers", fmtK(cur.followers)], ["Engagement", fmtPct(cur.er)], ["Target audience", cur.target_audience_pct == null ? "—" : `${Math.round(cur.target_audience_pct)}%`], ["Estimated rate", cur.estimated_rate_usd == null ? "—" : `~$${cur.estimated_rate_usd.toLocaleString("en-US")}`]].map(([k, v]) => (
              <div key={k} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--chip-3)", display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{k}</span><span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{v}</span></div>
            ))}
          </div>
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, borderBottom: "1px solid var(--line-3)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>Why it fits</span>
              {cur.pros.length ? cur.pros.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>
                  <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>{p}</span>
                </div>
              )) : <span style={{ fontSize: 13, color: "var(--muted)" }}>No explanation available.</span>}
            </div>
            {cur.cons.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>Keep in mind</span>
                {cur.cons.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span aria-hidden="true" style={{ flex: "none", width: 14, height: 14, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C2410C" }} /></span>
                    <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>Recent content</span>
            <RecentContent creatorId={cur.creator_id} />
          </div>
        </aside>
      ); })()}
    </div>
  );
}

function RecentContent({ creatorId }: { creatorId: string }) {
  const [items, setItems] = useState<Array<{ id: string; media_urls: string[]; caption: string | null }> | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== creatorId) {
    setLoadedFor(creatorId); setItems(null);
    fetch(`/api/creators/${creatorId}/content`).then((r) => r.ok ? r.json() : []).then(setItems).catch(() => setItems([]));
  }
  const slots = items ?? [null, null, null];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      {[0, 1, 2].map((i) => { const it = slots[i]; const url = it?.media_urls?.[0]; return (
        <div key={i} title={it?.caption ?? undefined} style={{ aspectRatio: "9 / 14", borderRadius: 10, background: "#EFEFF1", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: "var(--muted)", padding: 8, textAlign: "center" }}>
          {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : it?.caption ? <span style={{ display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>{it.caption}</span> : items ? "No media" : "…"}
        </div>
      ); })}
    </div>
  );
}

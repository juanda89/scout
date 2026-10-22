"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Orb } from "@/components/Orb";
import { HudRings } from "@/components/HudRings";
import { launchScouting, saveDraft } from "@/lib/actions";
import type { FieldSource, ScoutingFields, Span } from "@scout/core/scouting/types";

type F = ScoutingFields;
const PLATFORMS: Array<[F["platforms"][number], string]> = [["tiktok", "TikTok"], ["instagram", "Instagram"], ["youtube", "YouTube"]];

const Check = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>;
const Chevron = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#52525B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;

function Tag({ src, n, required }: { src?: FieldSource; n?: number; required?: boolean }) {
  if (src === "missing" && required) return <span className="badge req">Required</span>;
  if (src === "missing") return <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Optional</span>;
  if (src === "user") return <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--green)" }}><Check />Edited</span>;
  if (src === "suggested") return <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)" }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", border: "1px solid #8A8A92" }} />Suggested</span>;
  if (src === "inferred") return <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)" }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", border: "1px solid #3F3F46", background: "linear-gradient(90deg, #3F3F46 50%, #fff 50%)" }} />Inferred</span>;
  return <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)" }}>{n != null && <span className="mono" style={{ minWidth: 16, height: 16, borderRadius: 4, background: "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--ink-2)" }}>{n}</span>}Detected</span>;
}

function Field({ label, htmlFor, tag, required, children, hint, span }: { label: string; htmlFor?: string; tag: React.ReactNode; required?: boolean; children: React.ReactNode; hint?: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0, gridColumn: span ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <label htmlFor={htmlFor} style={{ fontSize: 13, fontWeight: 500 }}>{label} {required && <span style={{ color: "var(--orange)" }}>*</span>}</label>
        {tag}
      </div>
      {children}
      {hint}
    </div>
  );
}

function Section({ n, title, badge, children, cols = 240 }: { n: number; title: string; badge: number; children: React.ReactNode; cols?: number }) {
  return (
    <section className="card rise" aria-label={title} style={{ overflow: "hidden" }}>
      <div className="card-hd">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mono" style={{ width: 22, height: 22, borderRadius: 6, background: "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--ink-2)" }}>{n}</span>
          <h2>{title}</h2>
        </div>
        <span className="badge" style={{ height: 22, padding: "0 9px", fontSize: 12, background: badge ? "var(--orange-bg)" : "var(--green-bg)", color: badge ? "var(--orange-ink)" : "var(--green)" }}>{badge ? `${badge} missing` : "Complete"}</span>
      </div>
      <div style={{ padding: "18px 20px 20px", display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${cols}px, 100%), 1fr))`, gap: "18px 20px" }}>{children}</div>
    </section>
  );
}

const numOrNull = (s: string): number | null => { const t = s.replace(/[^\d.,kKmM]/g, "").toLowerCase(); if (!t) return null; const mult = t.endsWith("m") ? 1_000_000 : t.endsWith("k") ? 1000 : 1; const n = parseFloat(t.replace(/[km]$/, "").replace(/,/g, "")); return Number.isFinite(n) ? Math.round(n * mult) : null; };
const fmtK = (n: number | null) => n == null ? "" : n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : String(n);

export function ConfirmBrief({ id, initialName, description, initialFields, sources, spans }: { id: string; initialName: string; description: string; initialFields: F; sources: Record<string, FieldSource>; spans: Span[] }) {
  const [name, setName] = useState(initialName);
  const [f, setF] = useState<F>(initialFields);
  const [src, setSrc] = useState(sources);
  const [newTopic, setNewTopic] = useState("");
  const [intro, setIntro] = useState(true);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [launching, startLaunch] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});

  useEffect(() => { const t = setTimeout(() => setIntro(false), 1300); return () => clearTimeout(t); }, []);

  const flush = (nextName?: string) => {
    if (timer.current) clearTimeout(timer.current);
    setSaving("saving");
    timer.current = setTimeout(async () => {
      const patch = pendingPatch.current; pendingPatch.current = {};
      const r = await saveDraft(id, { fields: patch, name: nextName ?? name });
      setSaving(r.ok ? "saved" : "error"); if (!r.ok) setError(r.error);
    }, 500);
  };
  const set = (patch: Partial<F>, touched: string[]) => {
    setF((prev) => ({ ...prev, ...patch }));
    setSrc((s) => { const c = { ...s }; for (const k of touched) c[k] = "user"; return c; });
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    flush();
  };
  const changeName = (v: string) => { setName(v); flush(v); };

  const missing: Array<[string, string]> = [];
  if (!f.brand.trim()) missing.push(["Brand", "#f-brand"]);
  if (!f.creators_wanted) missing.push(["Number of creators", "#f-count"]);
  if (!f.platforms.length) missing.push(["Platforms", "#l-plat"]);
  if (!f.location.trim()) missing.push(["Location", "#f-loc"]);
  if (f.budget == null) missing.push(["Total budget", "#f-budget"]);
  const filled = [name, f.brand, f.product, f.goal, f.launch_date, f.creators_wanted, f.followers_min, f.min_engagement_pct, f.location, f.age_min, f.language, f.budget].filter((v) => v != null && String(v).trim() !== "").length + (f.platforms.length ? 1 : 0) + (f.topics.length ? 1 : 0);
  const totalN = 14; const ready = missing.length === 0;

  const marked = useMemo(() => {
    const out: React.ReactNode[] = []; let i = 0;
    for (const sp of spans) { if (sp.start > i) out.push(description.slice(i, sp.start)); out.push(<mark key={sp.n}>{description.slice(sp.start, sp.end)}<sup>{sp.n}</sup></mark>); i = sp.end; }
    if (i < description.length) out.push(description.slice(i));
    return out;
  }, [description, spans]);
  const nOf = (field: string) => spans.find((s) => s.field === field || (field === "followers" && /followers/.test(s.field)) || (field === "age" && /age/.test(s.field)))?.n;

  const launch = () => startLaunch(async () => { setError(null); if (timer.current) { clearTimeout(timer.current); } const patch = pendingPatch.current; pendingPatch.current = {}; const r0 = await saveDraft(id, { fields: patch, name }); if (!r0.ok) { setError(r0.error); return; } const r = await launchScouting(id); if (r && !r.ok) setError(r.error); });

  return (
    <>
      {intro && (
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 220, gap: 18, background: "rgba(244,244,246,0.86)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", textAlign: "center", animation: "fadeout .4s ease .8s both" }}>
          <div style={{ position: "relative", width: 72, height: 72, margin: "64px 0 52px" }}>
            <div aria-hidden="true" style={{ position: "absolute", left: -84, top: -84 }}><HudRings px={240} /></div>
            <div style={{ position: "relative" }}><Orb mode="shaping" px={72} /></div>
          </div>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Shaping your brief…</span>
          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>Reading your description and turning it into fields.</span>
          <style>{`@keyframes fadeout { to { opacity: 0; visibility: hidden } }`}</style>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: "999 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card rise" aria-label="Name" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <label htmlFor="f-name" style={{ fontSize: 13, fontWeight: 500 }}>Scouting name</label><Tag src={src.name ?? "suggested"} />
            </div>
            <input id="f-name" className="in" value={name} onChange={(e) => changeName(e.target.value)} placeholder="e.g. Urban running — Bogotá & Medellín (topic — place)" style={{ height: 48, padding: "0 14px", fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }} />
          </section>

          <Section n={1} title="Campaign" badge={f.brand.trim() ? 0 : 1}>
            <Field label="Brand" htmlFor="f-brand" required tag={<Tag src={f.brand.trim() ? src.brand : "missing"} required />} hint={!f.brand.trim() && <span style={{ fontSize: 12, color: "var(--orange-ink)" }}>You didn’t mention it in your description.</span>}>
              <input id="f-brand" className={`in${f.brand.trim() ? "" : " missing"}`} value={f.brand} onChange={(e) => set({ brand: e.target.value }, ["brand"])} placeholder="e.g. Nike, Oatly or your client’s brand" aria-required="true" />
            </Field>
            <Field label="Product" htmlFor="f-product" tag={<Tag src={src.product} n={nOf("product")} />}>
              <input id="f-product" className="in" value={f.product} onChange={(e) => set({ product: e.target.value }, ["product"])} placeholder="e.g. Running shoes, oat milk, vitamin C serum" />
            </Field>
            <Field label="Goal" htmlFor="f-goal" tag={<Tag src={src.goal} n={nOf("goal")} />}>
              <div className="selectwrap"><select id="f-goal" className="in" value={f.goal} onChange={(e) => set({ goal: e.target.value as F["goal"] }, ["goal"])}>{["Product launch", "Brand awareness", "Sales and conversions", "UGC content"].map((g) => <option key={g}>{g}</option>)}</select><Chevron /></div>
            </Field>
            <Field label="Launch date" htmlFor="f-date" tag={<Tag src={src.launch_date} n={nOf("launch_date")} />}>
              <input id="f-date" className="in" value={f.launch_date} onChange={(e) => set({ launch_date: e.target.value }, ["launch_date"])} placeholder="e.g. March 2027, or 15 Mar 2027" />
            </Field>
          </Section>

          <Section n={2} title="Creators" badge={(f.creators_wanted ? 0 : 1) + (f.platforms.length ? 0 : 1)}>
            <Field label="Number of creators" htmlFor="f-count" required tag={<Tag src={f.creators_wanted ? src.creators_wanted : "missing"} n={nOf("creators_wanted")} required />} hint={<span style={{ fontSize: 12, color: "var(--muted)" }}>How many creators you want to end up hiring. We’ll shortlist about twice as many.</span>}>
              <input id="f-count" className={`in mono${f.creators_wanted ? "" : " missing"}`} inputMode="numeric" value={f.creators_wanted ?? ""} onChange={(e) => set({ creators_wanted: numOrNull(e.target.value) }, ["creators_wanted"])} placeholder="e.g. 15" aria-required="true" />
            </Field>
            <div role="group" aria-labelledby="l-plat" id="l-plat" style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Platforms <span style={{ color: "var(--orange)" }}>*</span></span>
                <Tag src={f.platforms.length ? src.platforms : "missing"} n={nOf("platforms")} required />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {PLATFORMS.map(([k, label]) => { const on = f.platforms.includes(k); return (
                  <button key={k} type="button" className="pchip" aria-pressed={on} onClick={() => set({ platforms: on ? f.platforms.filter((p) => p !== k) : [...f.platforms, k] }, ["platforms"])}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: on ? 1 : 0 }}><path d="M2.5 6.2 5 8.5l4.5-5" /></svg><span>{label}</span>
                  </button>); })}
              </div>
            </div>
            <Field label="Followers" tag={<Tag src={src.followers} n={nOf("followers")} />} hint={<span style={{ fontSize: 12, color: "var(--muted)" }}>Range per creator. Use k for thousands (20k) and m for millions.</span>}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input className="in mono" aria-label="Minimum followers" defaultValue={fmtK(f.followers_min)} onBlur={(e) => set({ followers_min: numOrNull(e.target.value) }, ["followers_min"])} placeholder="e.g. 20k" />
                <span aria-hidden="true" style={{ color: "var(--muted-2)" }}>–</span>
                <input className="in mono" aria-label="Maximum followers" defaultValue={fmtK(f.followers_max)} onBlur={(e) => set({ followers_max: numOrNull(e.target.value) }, ["followers_max"])} placeholder="e.g. 300k" />
              </div>
            </Field>
            <Field label="Minimum engagement" htmlFor="f-er" tag={<Tag src={src.min_engagement_pct ?? "suggested"} />} hint={<span style={{ fontSize: 12, color: "var(--muted)" }}>Likes + comments ÷ followers, per post. 3% is a healthy floor for most niches.</span>}>
              <div style={{ position: "relative" }}>
                <input id="f-er" className="in mono" inputMode="decimal" value={f.min_engagement_pct ?? ""} onChange={(e) => set({ min_engagement_pct: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) }, ["min_engagement_pct"])} placeholder="e.g. 3" style={{ paddingRight: 34 }} />
                <span aria-hidden="true" className="mono" style={{ position: "absolute", right: 12, top: 11, fontSize: 14, color: "var(--muted)" }}>%</span>
              </div>
            </Field>
            <Field label="Topics" htmlFor="f-topic" span tag={<Tag src={src.topics} n={nOf("topics")} />}>
              <div className="in" style={{ height: "auto", minHeight: 48, padding: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {f.topics.map((t, i) => (
                  <span key={t + i} style={{ height: 34, padding: "0 4px 0 11px", display: "flex", alignItems: "center", gap: 2, borderRadius: 7, background: "var(--chip)", fontSize: 13.5 }}>
                    <span>{t}</span>
                    <button type="button" onClick={() => set({ topics: f.topics.filter((_, j) => j !== i) }, ["topics"])} aria-label={`Remove ${t}`} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", border: 0, borderRadius: 6, background: "transparent", color: "var(--muted-3)", cursor: "pointer" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
                    </button>
                  </span>
                ))}
                <input id="f-topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const t = newTopic.trim(); if (t) { set({ topics: [...f.topics, t] }, ["topics"]); setNewTopic(""); } } }} placeholder={f.topics.length ? "Add another and press Enter" : "e.g. running, active lifestyle — type one and press Enter"} style={{ flex: 1, minWidth: 160, height: 34, padding: "0 8px", border: 0, outline: "none", background: "transparent", fontSize: 14 }} />
              </div>
            </Field>
          </Section>

          <Section n={3} title="Audience" badge={f.location.trim() ? 0 : 1} cols={200}>
            <Field label="Location" htmlFor="f-loc" required tag={<Tag src={f.location.trim() ? src.location : "missing"} n={nOf("location")} required />} hint={<span style={{ fontSize: 12, color: "var(--muted)" }}>Where the creators live. Cities or countries, separated by commas.</span>}>
              <input id="f-loc" className={`in${f.location.trim() ? "" : " missing"}`} value={f.location} onChange={(e) => set({ location: e.target.value }, ["location"])} aria-required="true" placeholder="e.g. Bogotá and Medellín · Mexico · Spain" />
            </Field>
            <Field label="Age" htmlFor="f-age" tag={<Tag src={src.age} n={nOf("age")} />} hint={<span style={{ fontSize: 12, color: "var(--muted)" }}>Age range of the audience you want to reach, not of the creator.</span>}>
              <input id="f-age" className="in mono" defaultValue={f.age_min != null || f.age_max != null ? `${f.age_min ?? ""}–${f.age_max ?? ""}` : ""} placeholder="e.g. 18–34" onBlur={(e) => { const m = e.target.value.match(/(\d{1,2})\D+(\d{1,2})/); set({ age_min: m ? Number(m[1]) : null, age_max: m ? Number(m[2]) : null }, ["age_min", "age_max"]); }} />
            </Field>
            <Field label="Content language" htmlFor="f-lang" tag={<Tag src={src.language ?? "inferred"} />}>
              <div className="selectwrap"><select id="f-lang" className="in" value={f.language} onChange={(e) => set({ language: e.target.value as F["language"] }, ["language"])}>{["Spanish", "English", "Portuguese"].map((l) => <option key={l}>{l}</option>)}</select><Chevron /></div>
            </Field>
          </Section>

          <Section n={4} title="Budget and constraints" badge={f.budget == null ? 1 : 0}>
            <Field label="Total budget" htmlFor="f-budget" required tag={<Tag src={f.budget == null ? "missing" : src.budget} required />} hint={<span style={{ fontSize: 12, lineHeight: 1.45, color: f.budget == null ? "var(--orange-ink)" : "var(--muted)" }}>{f.budget == null ? "You didn’t mention it. Total for all creators; we use it to rule out creators outside your rate range." : "Total for all creators. We use it to rule out creators outside your rate range."}</span>}>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="f-budget" className={`in mono${f.budget == null ? " missing" : ""}`} inputMode="numeric" defaultValue={f.budget ?? ""} onBlur={(e) => set({ budget: numOrNull(e.target.value) }, ["budget"])} placeholder="e.g. 12,000" aria-required="true" style={{ flex: 1, minWidth: 0 }} />
                <div className="selectwrap" style={{ flex: "none", width: 92 }}><select className="in mono" aria-label="Currency" value={f.currency} onChange={(e) => set({ currency: e.target.value as F["currency"] }, ["currency"])} style={{ paddingRight: 28, fontSize: 14 }}>{["USD", "COP", "EUR", "MXN"].map((c) => <option key={c}>{c}</option>)}</select><Chevron /></div>
              </div>
            </Field>
            <Field label="Exclude" htmlFor="f-excl" tag={<span style={{ fontSize: 11.5, color: "var(--muted)" }}>Optional</span>}>
              <textarea id="f-excl" className="in" rows={2} value={f.exclude} onChange={(e) => set({ exclude: e.target.value }, ["exclude"])} placeholder="e.g. Competing brands (Adidas, Puma), creators you already worked with, no alcohol or gambling content" />
            </Field>
          </Section>
        </div>

        <aside style={{ flex: "1 1 320px", maxWidth: 380, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card rise" aria-labelledby="s-state" style={{ boxShadow: "var(--shadow-2)", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <h2 id="s-state" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Brief status</h2>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{filled} / {totalN}</span>
              </div>
              <div role="progressbar" aria-label="Fields complete" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={totalN} style={{ height: 6, borderRadius: 3, background: "var(--chip-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.round((filled / totalN) * 100)}%`, height: 6, borderRadius: 3, background: ready ? "var(--green-2)" : "var(--ink)", transition: "width .3s ease" }} />
              </div>
              {ready ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 500, color: "var(--green)" }}><Check />Ready to launch</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Still needed:</span>
                  {missing.map(([t, href]) => (
                    <a key={t} href={href} className="jump"><span style={{ display: "flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--orange)" }} />{t}</span><span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted-3)" }}>Fill in</span></a>
                  ))}
                </div>
              )}
            </div>
            <div className="card-foot" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
              <Orb mode="breathing" px={32} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>Estimated time: 20–60 min</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--muted)" }}>Runs in the background. You can close the app — we’ll email you when it’s done.</span>
              </div>
            </div>
            <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line-3)" }}>
              <button type="button" className="btn btn-lg" disabled={!ready || launching} onClick={launch}>
                <span>{launching ? "Creating…" : ready ? "Create scouting" : missing.length === 1 ? "1 field missing" : `${missing.length} fields missing`}</span>
                {ready && !launching && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>}
              </button>
              {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--orange-ink)" }}>{error}</p>}
              <span style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", minHeight: 14 }}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Could not save" : ""}</span>
              <Link href="/scoutings/new" className="ghost" style={{ height: 38, fontSize: 13.5 }}>Back to description</Link>
            </div>
          </section>

          <figure className="card rise" style={{ margin: 0, position: "relative", padding: "44px 22px" }}>
            {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => <span key={v + h} aria-hidden="true" style={{ position: "absolute", [v]: 10, [h]: 10, width: 5, height: 5, borderRadius: "50%", border: "1px solid #D4D4DA" }} />)}
            <span className="mono" style={{ position: "absolute", top: 18, left: 22, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Fig. 01</span>
            <span className="mono" style={{ position: "absolute", top: 18, right: 22, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Your description</span>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.85, textWrap: "pretty" }}>{marked}</p>
            <span className="mono" style={{ position: "absolute", bottom: 18, left: 22, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Number = field</span>
            <span className="mono" style={{ position: "absolute", bottom: 18, right: 22, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink)" }}>{spans.length} data points</span>
          </figure>
        </aside>
      </div>
    </>
  );
}

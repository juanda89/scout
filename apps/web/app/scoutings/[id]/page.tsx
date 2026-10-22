import { notFound, redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { Header } from "@/components/Header";
import { Shell } from "@/components/Shell";
import { progressSnapshot, runningHint, scoutingDetail } from "@/lib/data";
import { Progress } from "./Progress";
import { Results } from "./Results";
import { fmtDate, fmtDuration, fmtInt, platformLabel } from "@/lib/format";
import { duplicateScouting } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ScoutingPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const d = await scoutingDetail(id);
  if (!d) notFound();
  const { s, results } = d;
  if (s.status === "draft") redirect(`/scoutings/new/${s.id}`);
  const running = await runningHint();
  const crumbs = [{ label: "Scoutings", href: "/scoutings" }, { label: s.name }];
  const f = s.fields;
  const plats = (f.platforms.length ? f.platforms : ["instagram"]).map(platformLabel).join(", ");

  if (s.status === "running" || s.status === "queued" || s.status === "failed" || s.status === "cancelled") {
    const snap = await progressSnapshot(id);
    const subtitle = [s.started_at ? `Started ${new Date(s.started_at).toDateString() === new Date().toDateString() ? "today at " : "on " + fmtDate(s.started_at) + " at "}${new Date(s.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}` : "Queued", plats, f.location || null, f.creators_wanted ? `${f.creators_wanted} creators` : null, f.followers_min != null || f.followers_max != null ? `${Math.round((f.followers_min ?? 0) / 1000)}k–${f.followers_max ? Math.round(f.followers_max / 1000) + "k" : "∞"} followers` : null].filter(Boolean).join(" · ");
    return (
      <Shell fx={0.36} fy={0.36} intensity={1.15}>
        <Header viewer={viewer} crumbs={crumbs} running={running && running.id !== id ? running : null} />
        <main style={{ flex: 1, width: "100%", maxWidth: 1320, margin: "0 auto", padding: "28px 24px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
          <Progress id={id} name={s.name} subtitle={subtitle} initial={snap!} notifyEmail={s.notify_email} email={viewer.email} countries={f.countries} platforms={plats} />
        </main>
      </Shell>
    );
  }

  const brief = [["Platforms", plats], ["Location", f.location || "—"], ["Followers", f.followers_min != null || f.followers_max != null ? `${Math.round((f.followers_min ?? 0) / 1000)}k–${f.followers_max ? Math.round(f.followers_max / 1000) + "k" : "∞"}` : "Any"], ["Audience age", f.age_min != null || f.age_max != null ? `${f.age_min ?? ""}–${f.age_max ?? ""}` : "Any"], ["Creators wanted", f.creators_wanted ? String(f.creators_wanted) : "—"], ["Budget", f.budget != null ? `${f.budget.toLocaleString("en-US")} ${f.currency}` : "—"]];
  const dur = s.started_at && s.finished_at ? fmtDuration(new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) : null;
  return (
    <Shell fx={0.8} fy={0.14}>
      <Header viewer={viewer} crumbs={crumbs} running={running} />
      <main style={{ flex: 1, width: "100%", maxWidth: 1320, margin: "0 auto", padding: "28px 24px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>{s.name}</h1>
              <span className="badge done lg"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>Done</span>
            </div>
            <span style={{ fontSize: 13.5, color: "var(--muted)" }}>Completed {fmtDate(s.finished_at)} · {fmtInt(s.metrics.profiles_analyzed ?? s.metrics.analyzed ?? 0)} profiles analyzed{dur ? ` in ${dur}` : ""}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <form action={async () => { "use server"; await duplicateScouting(id); }}>
              <button type="submit" className="sec"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></svg><span>Duplicate brief</span></button>
            </form>
            <a href={`/api/scoutings/${id}/export`} className="sec"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg><span>Export CSV</span></a>
          </div>
        </div>

        <section aria-label="Brief" className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", overflow: "hidden" }}>
          <div style={{ flex: "1 1 640px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))" }}>
            {brief.map(([k, v]) => (
              <div key={k} style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4, borderRight: "1px solid var(--line-3)", minWidth: 0 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{k}</span>
                <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: "0 0 auto", padding: "14px 18px", display: "flex", alignItems: "center" }}>
            <details style={{ position: "relative" }}>
              <summary style={{ listStyle: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13.5, fontWeight: 500, cursor: "pointer" }}>View full brief <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg></summary>
              <div className="card" style={{ position: "absolute", right: 0, top: 30, zIndex: 5, width: 420, maxWidth: "80vw", padding: 16, fontSize: 13.5, lineHeight: 1.6, boxShadow: "var(--shadow-2)" }}>
                <p style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{s.description}</p>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
                  {[["Brand", f.brand], ["Product", f.product], ["Goal", f.goal], ["Launch", f.launch_date], ["Topics", f.topics.join(", ")], ["Language", f.language], ["Min. engagement", f.min_engagement_pct != null ? `${f.min_engagement_pct}%` : ""], ["Exclude", f.exclude]].filter(([, v]) => v).map(([k, v]) => <span key={k} style={{ display: "contents" }}><dt style={{ color: "var(--muted)" }}>{k}</dt><dd style={{ margin: 0 }}>{v}</dd></span>)}
                </dl>
              </div>
            </details>
          </div>
        </section>

        <Results id={id} results={results} />
      </main>
    </Shell>
  );
}

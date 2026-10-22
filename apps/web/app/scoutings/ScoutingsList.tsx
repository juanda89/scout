"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Orb } from "@/components/Orb";
import { initials } from "@/lib/format";

export interface ListRow { id: string; title: string; status: "running" | "done" | "failed"; date: string; plats: string; loc: string; count: number; avg: number | null; best: number | null; top: string[]; stage: number; stageTitle: string; pct: number; stageProgress: number; error: string | null }

export function ScoutingsList({ rows, note, noteTone = "muted" }: { rows: ListRow[]; note?: string; noteTone?: "muted" | "warn" }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "run" | "done">("all");
  const ql = q.trim().toLowerCase();
  const match = (r: ListRow) => !ql || r.title.toLowerCase().includes(ql);
  const running = useMemo(() => rows.filter((r) => r.status === "running" && match(r)), [rows, ql]);
  const done = useMemo(() => rows.filter((r) => r.status !== "running" && match(r)), [rows, ql]);
  const showRun = (filter === "all" || filter === "run") && running.length > 0;
  const showDone = (filter === "all" || filter === "done") && done.length > 0;
  const tabs = [["all", "All", rows.length], ["run", "Running", rows.filter((r) => r.status === "running").length], ["done", "Done", rows.filter((r) => r.status !== "running").length]] as const;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>Scoutings</h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>Your creator searches and what we found for each brief.</p>
          {note && <p style={{ margin: "2px 0 0", fontSize: 13, color: noteTone === "warn" ? "var(--orange-ink)" : "var(--muted)" }}>{note}</p>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label className="in" style={{ height: 36, width: 260, maxWidth: "100%", display: "flex", alignItems: "center", gap: 8, cursor: "text" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#6B6B73" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            <input aria-label="Search scoutings" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scoutings" style={{ flex: 1, minWidth: 0, height: 34, border: 0, outline: "none", background: "transparent", fontSize: 14 }} />
          </label>
          <div role="group" aria-label="Filter by status" className="seggroup">
            {tabs.map(([k, label, n]) => (
              <button key={k} className="seg" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                <span>{label}</span><span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showRun && (
        <section aria-labelledby="h-run" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="h-run" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--muted-3)" }}>In progress</h2>
          {running.map((r) => (
            <Link key={r.id} href={`/scoutings/${r.id}`} className="rowcard">
              <span style={{ width: 56, height: 56, borderRadius: 12, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Orb mode="working" px={44} /></span>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 32px", minWidth: 0 }}>
                <span style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 15.5, lineHeight: 1.3, fontWeight: 600, letterSpacing: "-0.01em" }}>{r.title}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
                    <span className="badge run"><span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />In progress</span>
                    <span>{r.date}</span><span aria-hidden="true">·</span><span>{r.plats}</span><span aria-hidden="true">·</span><span>{r.loc}</span>
                  </span>
                </span>
                <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{r.stage > 0 ? `Stage ${r.stage} of 5 · ${r.stageTitle}` : "Queued"}</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.pct}%</span>
                  </span>
                  <span role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scouting progress" style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const w = n < r.stage ? 100 : n === r.stage ? Math.round(r.stageProgress * 100) : 0;
                      return <span key={n} style={{ flex: 1, height: 5, borderRadius: 3, background: w >= 100 ? "var(--ink)" : w > 0 ? `linear-gradient(90deg, #0B0B0C ${w}%, #E3E3E7 ${w}%)` : "#E3E3E7" }} />;
                    })}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Runs in the background · we’ll email you when it’s done</span>
                </span>
              </span>
              <svg className="chev" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
            </Link>
          ))}
        </section>
      )}

      {showDone && (
        <section aria-labelledby="h-done" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="h-done" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--muted-3)" }}>Completed</h2>
          {done.map((r) => {
            const best = r.best ?? 0; const ring = best >= 90 ? "#15803D" : "#0B0B0C";
            return (
              <Link key={r.id} href={`/scoutings/${r.id}`} className="rowcard">
                <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 12, background: `conic-gradient(${ring} ${Math.round(best * 3.6)}deg, #ECECEF 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 46, height: 46, borderRadius: 10, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span className="mono" style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.1 }}>{r.best ?? "—"}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: "var(--muted)", lineHeight: 1.2 }}>best fit</span>
                  </span>
                </span>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 32px", minWidth: 0 }}>
                  <span style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 15.5, lineHeight: 1.3, fontWeight: 600, letterSpacing: "-0.01em" }}>{r.title}</span>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
                      {r.status === "done" ? (
                        <span className="badge done"><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>Done</span>
                      ) : <span className="badge req">Failed</span>}
                      <span>{r.date}</span><span aria-hidden="true">·</span><span>{r.plats}</span><span aria-hidden="true">·</span><span>{r.loc}</span>
                    </span>
                  </span>
                  <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
                    <span aria-hidden="true" style={{ display: "flex", flex: "none" }}>
                      {r.top.slice(0, 3).map((n, i) => <span key={i} style={{ width: 30, height: 30, marginRight: -8, borderRadius: "50%", border: "2px solid #fff", background: "#EDEDEF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, color: "var(--ink-2)" }}>{initials(n)}</span>)}
                    </span>
                    <span style={{ paddingLeft: 8, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{r.count} creators</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.top.length ? `Top: ${r.top.join(", ")}` : r.error ? r.error.slice(0, 80) : "No creators matched"}</span>
                    </span>
                    <span style={{ marginLeft: "auto", flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.avg ?? "—"}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>avg. fit</span>
                    </span>
                  </span>
                </span>
                <svg className="chev" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
              </Link>
            );
          })}
        </section>
      )}

      {!showRun && !showDone && (
        <div style={{ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", background: "#fff", border: "1px dashed var(--line-2)", borderRadius: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{rows.length ? "No scoutings match your search" : "No scoutings yet"}</span>
          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{rows.length ? "Try another keyword or change the status filter." : "Start with “New scouting” and describe who you’re looking for."}</span>
        </div>
      )}
    </>
  );
}

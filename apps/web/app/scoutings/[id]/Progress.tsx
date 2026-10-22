"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { LiveOrb, Orb, type OrbMode } from "@/components/Orb";
import { HudRings } from "@/components/HudRings";
import { Avatar } from "@/components/FitRing";
import { cancelScouting, setNotify } from "@/lib/actions";
import type { ProgressSnapshot } from "@/lib/data";
import { STAGES } from "@scout/core/scouting/types";
import { fmtInt, fmtK, platformLabel } from "@/lib/format";

const ETA_MIN = [2, 6, 20, 6, 3]; // minutos típicos por etapa, para la estimación

export function Progress({ id, name, subtitle, initial, notifyEmail, email, countries, platforms }: { id: string; name: string; subtitle: string; initial: ProgressSnapshot; notifyEmail: boolean; email: string; countries: string[]; platforms: string }) {
  const [snap, setSnap] = useState<ProgressSnapshot>(initial);
  const [events, setEvents] = useState(initial.events);
  const [notify, setNotifyState] = useState(notifyEmail);
  const [cancelling, startCancel] = useTransition();

  useEffect(() => {
    if (["done", "failed", "cancelled"].includes(snap.status)) { if (snap.status === "done") window.location.reload(); return; }
    const last = events[0]?.id ?? 0;
    const es = new EventSource(`/api/scoutings/${id}/stream?after=${last}`);
    es.addEventListener("state", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as ProgressSnapshot;
      setSnap(s);
      if (s.events.length) setEvents((prev) => { const ids = new Set(prev.map((x) => x.id)); return [...s.events.filter((x) => !ids.has(x.id)), ...prev].slice(0, 40); });
      if (s.status === "done") { es.close(); setTimeout(() => window.location.reload(), 800); }
      if (s.status === "failed" || s.status === "cancelled") es.close();
    });
    es.onerror = () => { es.close(); setTimeout(() => window.location.reload(), 4000); };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const activity = events.length ? events[0].id : 0;
  const stageN = Math.max(1, Math.min(5, snap.stage || 1));
  const stage = STAGES[stageN - 1];
  const m = snap.metrics;
  const failed = snap.status === "failed", cancelled = snap.status === "cancelled", queued = snap.status === "queued";
  const etaMin = useMemo(() => Math.max(1, Math.round(ETA_MIN.slice(stageN - 1).reduce((a, b) => a + b, 0) - ETA_MIN[stageN - 1] * snap.progress)), [stageN, snap.progress]);
  const dash = (v: number | undefined) => v == null ? "—" : fmtInt(v);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>{name}</h1>
            {failed ? <span className="badge req lg">Failed</span> : cancelled ? <span className="badge soft lg">Cancelled</span> : (
              <span className="badge run lg"><span className="live" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />{queued ? "Queued" : "In progress"}</span>
            )}
          </div>
          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{subtitle}</span>
        </div>
        <Link href="/scoutings" className="sec">Close and keep it running</Link>
      </div>

      {(failed || cancelled) ? (
        <section className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{failed ? "This scouting stopped with an error." : "This scouting was cancelled."}</span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{events.find((e) => e.kind === "error")?.text ?? "You can duplicate the brief and launch it again."}</span>
        </section>
      ) : (
        <section aria-label="Background notice" className="card" style={{ padding: "14px 16px 14px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, borderRadius: 14 }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 10, background: "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#0B0B0C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="m3 5.5 7 5.5 7-5.5" /></svg>
          </span>
          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>You can close this tab — the scouting keeps running on our servers.</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>We’ll email you at {email} when the results are ready. Usually 20–60 minutes.</span>
          </div>
          <button role="switch" aria-checked={notify} onClick={() => { const n = !notify; setNotifyState(n); void setNotify(id, n); }} style={{ height: 36, padding: "0 4px 0 12px", display: "flex", alignItems: "center", gap: 10, border: 0, borderRadius: 10, background: "transparent", fontSize: 13.5, fontWeight: 500, cursor: "pointer" }}>
            <span>Email me</span>
            <span aria-hidden="true" style={{ width: 36, height: 22, padding: 2, borderRadius: 999, background: notify ? "var(--ink)" : "#D4D4DA", display: "flex", transition: "background .2s" }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)", transform: `translateX(${notify ? 14 : 0}px)`, transition: "transform .2s" }} />
            </span>
          </button>
        </section>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
        <div style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <figure className="card" style={{ margin: 0, position: "relative", padding: "56px 28px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, borderRadius: 18 }}>
            <span aria-hidden="true" style={{ position: "absolute", top: 12, left: 12, width: 5, height: 5, borderRadius: "50%", border: "1px solid #D4D4DA" }} />
            <span aria-hidden="true" style={{ position: "absolute", top: 12, right: 12, width: 5, height: 5, borderRadius: "50%", border: "1px solid #D4D4DA" }} />
            <span className="mono" style={{ position: "absolute", top: 22, left: 26, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Fig. 02 — In progress</span>
            <span className="mono" style={{ position: "absolute", top: 22, right: 26, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Stage {String(stageN).padStart(2, "0")} / 05</span>

            <div style={{ position: "relative", width: 720, maxWidth: "100%", height: 360, overflow: "visible" }}>
              {/* Anillos y orbe comparten centro: (50 %, 180 px) del escenario. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "calc(50% - 190px)", top: -10, pointerEvents: "none" }}><HudRings px={380} speed={queued ? 0.5 : 1 + Math.min(1, activity / 40)} /></div>
              <div style={{ position: "absolute", left: "calc(50% - 140px)", top: 40 }}><LiveOrb mode={stage.mode as OrbMode} px={280} activity={activity} passed={m.passed ?? 0} idle={queued} done={failed || cancelled} /></div>
              <div className="hide-sm" aria-hidden="true">
                {[[172, 100, 281], [172, 260, 281], [438, 100, 433], [438, 260, 433]].map(([l, t, d], i) => (
                  <span key={i} style={{ display: "contents" }}>
                    <span style={{ position: "absolute", left: l, top: t, width: 110, height: 1, background: "#CFCFD5" }} />
                    <span style={{ position: "absolute", left: d, top: t - 3, width: 7, height: 7, borderRadius: "50%", background: "var(--ink)" }} />
                  </span>
                ))}
              </div>
              {[
                { l: 0, t: 72, align: "flex-end" as const, k: "Found", v: dash(m.found), sub: `profiles on ${platforms}` },
                { l: 0, t: 232, align: "flex-end" as const, k: "Passed filters", v: dash(m.passed), sub: "size, location and language" },
                { l: 556, t: 72, align: "flex-start" as const, k: "Analyzed", v: dash(m.analyzed), sub: m.passed ? `of ${fmtInt(m.passed)} profiles` : "pending" },
                { l: 556, t: 232, align: "flex-start" as const, k: "Strong candidates", v: dash(m.strong), sub: "good fit with the brief" },
              ].map((a) => (
                <div key={a.k} className="hide-sm" style={{ position: "absolute", left: a.l, top: a.t, width: 164, display: "flex", flexDirection: "column", alignItems: a.align, gap: 4, textAlign: a.align === "flex-end" ? "right" : "left" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{a.k}</span>
                  <span className="mono" style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>{a.v}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{a.sub}</span>
                </div>
              ))}
            </div>

            <figcaption style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: 480, textAlign: "center" }}>
              <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.02em" }}>{queued ? "Waiting for a worker" : stage.title}</h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--ink-3)", textWrap: "pretty" }}>{queued ? "Your scouting is queued and will start in a moment." : stage.description}</p>
              {!queued && !failed && !cancelled && events[0] && (
                <span key={events[0].id} className="mono tick" style={{ marginTop: 6, maxWidth: 440, fontSize: 11.5, lineHeight: 1.5, letterSpacing: "0.01em", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  › {events[0].text}
                </span>
              )}
            </figcaption>

            <div style={{ width: "100%", marginTop: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, borderRadius: 12, background: "rgba(11,11,12,0.035)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Overall progress</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{snap.pct}%</span>
                  {!failed && !cancelled && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>~{etaMin} min left</span>}
                </span>
              </div>
              <div role="progressbar" aria-valuenow={snap.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scouting progress" style={{ display: "flex", gap: 4 }}>
                {STAGES.map((s) => { const w = s.n < stageN ? 100 : s.n === stageN ? Math.round(snap.progress * 100) : 0; return (
                  <span key={s.n} style={{ flex: 1, height: 6, borderRadius: 3, background: "#E3E3E7", overflow: "hidden" }}><span style={{ display: "block", width: `${w}%`, height: 6, borderRadius: 3, background: "var(--ink)", transition: "width .6s ease" }} /></span>
                ); })}
              </div>
            </div>
          </figure>

          <section aria-labelledby="h-stages" className="card" style={{ overflow: "hidden" }}>
            <div className="card-hd"><h2 id="h-stages">Stages</h2></div>
            <ol style={{ margin: 0, padding: "6px 12px", listStyle: "none", display: "flex", flexDirection: "column" }}>
              {STAGES.map((s) => {
                const st = snap.stages.find((x) => x.n === s.n);
                const done = st?.status === "done", cur = st?.status === "running" || (s.n === stageN && !done && !failed && !cancelled && !queued), fail = st?.status === "failed";
                const detail = done ? `${st?.detail ?? ""}${st?.started_at && st?.finished_at ? ` · ${new Date(st.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}–${new Date(st.finished_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}` : ""}` : cur ? (events.find((e) => e.stage === s.n)?.text ?? "Working…") : fail ? st?.detail ?? "Failed" : s.n === stageN + 1 ? "Up next" : "Pending";
                return (
                  <li key={s.n} aria-current={cur ? "step" : undefined} style={{ padding: "12px 8px", display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 14, alignItems: "center", borderRadius: 10, background: cur ? "rgba(11,11,12,0.04)" : "transparent" }}>
                    <span style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {done ? <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--green-bg)", color: "var(--green-2)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg></span>
                        : cur ? <Orb mode={s.mode as OrbMode} px={28} />
                        : fail ? <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--orange-bg)", border: "1px solid var(--orange)" }} />
                        : <span style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px dashed #C4C4CB" }} />}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: s.n > stageN ? "var(--muted)" : "var(--ink)" }}>{String(s.n).padStart(2, "0")} · {s.title}</span>
                      <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{detail}</span>
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: done ? "var(--green)" : fail ? "var(--orange-ink)" : "var(--ink)", whiteSpace: "nowrap" }}>{done ? "Done" : cur ? "In progress" : fail ? "Failed" : ""}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside style={{ flex: "1 1 320px", maxWidth: 400, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <section aria-labelledby="h-log" className="card" style={{ overflow: "hidden" }}>
            <div className="card-hd">
              <h2 id="h-log">Live activity</h2>
              {!failed && !cancelled && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}><span className="live" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green-2)" }} />Live</span>}
            </div>
            <ol aria-live="polite" style={{ margin: 0, padding: "4px 20px 8px", listStyle: "none", display: "flex", flexDirection: "column" }}>
              {events.slice(0, 9).map((e, i) => (
                <li key={e.id} className={i === 0 ? "fresh" : ""} style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", gap: 10, padding: "10px 0", borderBottom: "1px solid #F3F3F5", opacity: Math.max(0.3, 1 - i * 0.08) }}>
                  <span className="mono" style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--muted)" }}>{new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.45, textWrap: "pretty", color: e.kind === "error" ? "var(--orange-ink)" : e.kind === "warn" ? "var(--ink-2)" : "var(--ink)" }}>{e.text}</span>
                </li>
              ))}
              {!events.length && <li style={{ padding: "12px 0", fontSize: 13.5, color: "var(--muted)" }}>Waiting for the first update…</li>}
            </ol>
          </section>

          <section aria-labelledby="h-finds" className="card" style={{ overflow: "hidden" }}>
            <div className="card-hd"><h2 id="h-finds">Early finds</h2><span className="badge soft" style={{ height: 22, padding: "0 9px", fontSize: 12 }}>Preliminary</span></div>
            {snap.finds.length ? (
              <>
                <div style={{ padding: "6px 20px 4px", display: "flex", flexDirection: "column" }}>
                  {snap.finds.map((f) => (
                    <div key={f.creator_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F3F3F5" }}>
                      <Avatar name={f.display_name ?? f.handle} size={34} />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.display_name ?? f.handle}</span>
                        <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{platformLabel(f.platform)} · {fmtK(f.followers)} · @{f.handle}</span>
                      </div>
                      <span className="mono" style={{ minWidth: 40, height: 24, padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, border: "1px dashed #C4C4CB", fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>~{f.fit}</span>
                    </div>
                  ))}
                </div>
                <p style={{ margin: 0, padding: "12px 20px 16px", fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>Final scores are calculated in stage 05 and may change.</p>
              </>
            ) : <p style={{ margin: 0, padding: "18px 20px", fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}>Creators will show up here as soon as we start analyzing profiles.</p>}
          </section>

          {!failed && !cancelled && <button className="quiet" disabled={cancelling} onClick={() => { if (confirm("Cancel this scouting? Progress so far is kept, but no results will be produced.")) startCancel(() => cancelScouting(id)); }} style={{ alignSelf: "flex-start" }}>{cancelling ? "Cancelling…" : "Cancel scouting"}</button>}
        </aside>
      </div>
    </>
  );
}

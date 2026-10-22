"use client";
import { useMemo, useState, useTransition } from "react";
import { Orb } from "@/components/Orb";
import { HudRings } from "@/components/HudRings";
import { createDraft } from "@/lib/actions";
import { DETECTORS } from "@scout/core/scouting/detectors";

const EXAMPLES: Array<[string, string]> = [
  ["Running in Bogotá & Medellín", "Looking for 15 creators on TikTok and Instagram in Bogotá and Medellín who talk about running and an active lifestyle, with 20k to 300k followers, for the launch of a running shoe in March. Their audience should be 18 to 34 years old."],
  ["Specialty coffee in Spain", "Specialty coffee micro-creators in Spain, Instagram only, 5k to 40k followers, for a 6-week campaign with a budget of €5,000."],
  ["Moms with toddlers", "Creadoras en Instagram que sean mamás con hijos de 1 a 3 años, en España o México, de 5k a 300k seguidores, para una marca de alimentación infantil con presupuesto de 8.000 USD para 10 creadoras."],
];

export function Describe() {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const t = text.toLowerCase();
  const checks = useMemo(() => DETECTORS.map(([label, re]) => ({ label, on: re.test(t) })), [t]);
  const hits = checks.filter((c) => c.on).length;
  const missing = checks.filter((c) => !c.on).map((c) => c.label.toLowerCase());
  const empty = text.trim().length === 0;
  const caption = empty ? "Include platform, location, size, topic, audience, budget and timing if you have them."
    : missing.length === 0 ? "We have the essentials. You’ll confirm the brief in the next step."
    : `We picked up ${hits} of ${checks.length}. We’ll ask for ${missing.join(", ")} in the next step.`;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
        <div style={{ position: "relative", width: 72, height: 72, margin: "22px 0 16px" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: -54, top: -54, pointerEvents: "none" }}><HudRings px={180} labels={false} /></div>
          <div style={{ position: "relative" }}><Orb mode={pending ? "shaping" : "listening"} px={72} /></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-0.03em", textWrap: "balance" }}>{pending ? "Shaping your brief…" : "Who are you looking for?"}</h1>
          <p style={{ margin: 0, maxWidth: 520, fontSize: 15.5, lineHeight: 1.55, color: "var(--ink-3)", textWrap: "pretty" }}>{pending ? "Reading your description and turning it into fields." : "Describe it the way you’d tell your team. We’ll turn it into a brief and only ask for what’s missing."}</p>
        </div>
      </div>

      <form action={(fd) => start(() => createDraft(fd))} className="card" style={{ borderRadius: 18, boxShadow: "var(--shadow-3)", overflow: "hidden", opacity: pending ? 0.6 : 1, transition: "opacity .2s" }}>
        <label htmlFor="nl" style={{ display: "block", padding: "18px 22px 0", fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}>Your description</label>
        <textarea id="nl" name="description" value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={pending}
          placeholder={"e.g. Looking for 15 TikTok and Instagram creators in Lima who talk about healthy cooking, with 10k to 100k followers, for a product launch in March. Audience 25 to 40 years old, budget $8,000 USD. Avoid creators who worked with competing brands.\n\nMention platform, location, topic, size, audience, budget and timing if you know them. Spanish or English both work."}
          style={{ display: "block", width: "100%", minHeight: 196, padding: "8px 22px 16px", border: 0, outline: "none", resize: "none", background: "transparent", fontSize: 17, lineHeight: 1.65, letterSpacing: "-0.005em" }} />
        <div style={{ padding: "12px 12px 12px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, }} className="card-foot">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 }}>
            {checks.map((k) => (
              <span key={k.label} className={`chip${k.on ? " on" : ""}`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: k.on ? 1 : 0.35 }}><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>
                <span>{k.label}</span>
              </span>
            ))}
          </div>
          <button type="submit" className="btn" disabled={empty || pending} style={{ height: 40, padding: "0 14px 0 16px" }}>
            <span>{pending ? "Shaping…" : "Turn into a brief"}</span>
            {!pending && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>}
          </button>
        </div>
      </form>
      <p role="status" style={{ margin: "-12px 0 0", padding: "0 4px", fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>{caption}</p>

      <section aria-labelledby="h-ex" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
        <h2 id="h-ex" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Or start from an example</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 12 }}>
          {EXAMPLES.map(([label, ex]) => (
            <button key={label} type="button" className="ex" onClick={() => setText(ex)}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ex}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

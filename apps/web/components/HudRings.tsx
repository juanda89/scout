"use client";
import { useEffect, useRef } from "react";

/** Anillos de instrumento alrededor del Orb: regla graduada que gira, arcos, barrido y etiquetas 000/090/180/270. Portado del componente "HUD rings". */
export function HudRings({ px = 320, intensity = 1, speed = 1, labels = true }: { px?: number; intensity?: number; speed?: number; labels?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(px * dpr); c.height = Math.round(px * dpr);
    let alive = true, t = Math.random() * 8, age = 0, last: number | null = null, drawn = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const draw = (time: number, intro: number) => {
      const ctx = c.getContext("2d"); if (!ctx) return;
      const TAU = Math.PI * 2, I = Math.max(0, intensity) * intro, R = (px / 2) * (0.86 + 0.14 * intro);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, px, px); ctx.translate(px / 2, px / 2);
      const ink = (a: number) => `rgba(11,11,12,${Math.max(0, Math.min(1, a * I)).toFixed(3)})`;
      ctx.lineWidth = 1; ctx.strokeStyle = ink(0.07); ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 0, TAU); ctx.stroke();
      const rA = R * 0.94, rotA = time * 0.05;
      ctx.strokeStyle = ink(0.1); ctx.beginPath(); ctx.arc(0, 0, rA, 0, TAU); ctx.stroke();
      const minor = new Path2D(), major = new Path2D();
      for (let i = 0; i < 120; i++) {
        const a = rotA + (i * TAU) / 120, big = i % 10 === 0, len = big ? Math.max(5, px * 0.026) : Math.max(2.5, px * 0.011);
        const p = big ? major : minor, cs = Math.cos(a), sn = Math.sin(a);
        p.moveTo(cs * rA, sn * rA); p.lineTo(cs * (rA - len), sn * (rA - len));
      }
      ctx.strokeStyle = ink(0.11); ctx.stroke(minor); ctx.strokeStyle = ink(0.24); ctx.stroke(major);
      const rB = R * 0.83, rotB = -time * 0.12;
      ctx.lineWidth = 1.25; ctx.strokeStyle = ink(0.16);
      for (let i = 0; i < 4; i++) { const b0 = rotB + (i * TAU) / 4; ctx.beginPath(); ctx.arc(0, 0, rB, b0, b0 + 0.95); ctx.stroke(); }
      ctx.fillStyle = ink(0.32);
      for (let i = 0; i < 4; i++) { const e = rotB + (i * TAU) / 4 + 0.95; ctx.beginPath(); ctx.arc(Math.cos(e) * rB, Math.sin(e) * rB, 1.6, 0, TAU); ctx.fill(); }
      const sw = time * 0.7; ctx.lineWidth = 1.6;
      for (let i = 0; i < 16; i++) { ctx.strokeStyle = ink(0.42 * (1 - i / 16)); ctx.beginPath(); ctx.arc(0, 0, rA, sw - (i + 1) * 0.045, sw - i * 0.045); ctx.stroke(); }
      ctx.fillStyle = ink(0.75); ctx.beginPath(); ctx.arc(Math.cos(sw) * rA, Math.sin(sw) * rA, 2.2, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = ink(0.26);
      for (let i = 0; i < 4; i++) { const a = (i * TAU) / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.975, Math.sin(a) * R * 0.975); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
      if (labels && px >= 200) {
        ctx.fillStyle = ink(0.38); ctx.font = `500 ${Math.max(8, Math.round(px * 0.026))}px "Geist Mono", ui-monospace, Menlo, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const L = ["000", "090", "180", "270"], rl = R * 0.765;
        for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (i * TAU) / 4; ctx.fillText(L[i], Math.cos(a) * rl, Math.sin(a) * rl); }
      }
    };
    let raf = 0;
    const loop = (now: number) => {
      if (!alive) return;
      if (last == null) last = now;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
      if (reduce) { if (!drawn) { drawn = true; draw(2, 1); } }
      else { t += dt * speed; age += dt; const k = Math.min(1, age / 1.4); draw(t, 1 - Math.pow(1 - k, 3)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [px, intensity, speed, labels]);
  return (
    <div aria-hidden="true" style={{ position: "relative", flex: "none", width: px, height: px, pointerEvents: "none" }}>
      <canvas ref={ref} style={{ position: "absolute", left: 0, top: 0, width: px, height: px, display: "block" }} />
    </div>
  );
}

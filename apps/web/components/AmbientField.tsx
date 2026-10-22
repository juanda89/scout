"use client";
import { useEffect, useRef } from "react";

/**
 * Fondo ambiental del diseño: retícula de puntos con ondas desde un foco, brillo que sigue al puntero
 * y dos anillos segmentados que giran. Portado del componente "Ambient field" del diseño.
 */
export function AmbientField({ fx = 0.5, fy = 0.3, intensity = 1, spacing = 22 }: { fx?: number; fy?: number; intensity?: number; spacing?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    let alive = true, t = Math.random() * 20, last: number | null = null, lastDraw = 0, mx = -9999, my = -9999, seen = -1e9, glow = 0, staticDrawn = false;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const onMove = (e: PointerEvent) => { const r = c.getBoundingClientRect(); if (!r.width) return; const k = c.clientWidth / r.width; mx = (e.clientX - r.left) * k; my = (e.clientY - r.top) * k; seen = performance.now(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    const draw = (time: number) => {
      const w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const FX = w * fx, FY = h * fy, I = Math.max(0, intensity), S = Math.max(12, Math.round(spacing));
      const far = Math.hypot(Math.max(FX, w - FX), Math.max(FY, h - FY));
      const g = ctx.createRadialGradient(FX, FY, 0, FX, FY, far);
      g.addColorStop(0, "#FDFDFE"); g.addColorStop(0.45, "#F6F6F8"); g.addColorStop(1, "#ECECF0");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const B = 12, paths: Path2D[] = []; for (let i = 0; i < B; i++) paths.push(new Path2D());
      const TAU = Math.PI * 2; let row = 0;
      for (let y = S * 0.5; y < h + S; y += S * 0.866, row++) {
        const off = row % 2 ? S * 0.5 : 0;
        for (let x = off; x < w + S; x += S) {
          const dx = x - FX, dy = y - FY, d = Math.sqrt(dx * dx + dy * dy);
          const wave = Math.cos(TAU * (d / 460 - time / 7.5));
          const ring = wave > 0 ? Math.pow(wave, 22) : 0;
          const fall = Math.exp(-d / 1150);
          const ex = x - mx, ey = y - my;
          const spot = glow * Math.exp(-(ex * ex + ey * ey) / 39200);
          const sh = 0.5 + 0.5 * Math.sin(x * 0.012 + time * 0.55) * Math.sin(y * 0.01 - time * 0.38);
          const near = Math.exp(-d / 700);
          const a = (0.045 + 0.035 * sh + 0.05 * near + 0.17 * ring * fall + 0.24 * spot) * I;
          if (a < 0.012) continue;
          const r = 0.7 + 0.85 * Math.min(1, ring * fall * 1.4 + spot);
          const k = Math.min(B - 1, Math.floor((a / 0.42) * B));
          paths[k].moveTo(x + r, y); paths[k].arc(x, y, r, 0, TAU);
        }
      }
      for (let i = 0; i < B; i++) { ctx.fillStyle = `rgba(11,11,12,${(((i + 0.5) / B) * 0.42).toFixed(3)})`; ctx.fill(paths[i]); }
      ctx.lineWidth = 1;
      const rings: Array<[number, number, number, number]> = [[340, 0.05, 0.035, 10], [520, 0.035, -0.022, 14]];
      for (const [R, al, sp, segs] of rings) {
        ctx.strokeStyle = `rgba(11,11,12,${(al * I).toFixed(3)})`;
        const base = time * sp;
        for (let s = 0; s < segs; s++) { const a0 = base + (s * TAU) / segs; ctx.beginPath(); ctx.arc(FX, FY, R, a0, a0 + (TAU / segs) * 0.62); ctx.stroke(); }
      }
    };
    let raf = 0;
    const loop = (now: number) => {
      if (!alive) return;
      if (last == null) last = now;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; t += dt;
      const target = now - seen < 2500 ? 1 : 0; glow += (target - glow) * Math.min(1, dt * 3);
      if (reduce) { if (!staticDrawn) { staticDrawn = true; draw(3.2); } }
      else if (now - lastDraw > 32) { lastDraw = now; draw(t); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [fx, fy, intensity, spacing]);
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none", background: "#F4F4F6" }}>
      <canvas ref={ref} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

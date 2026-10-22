"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

export type OrbMode = "breathing" | "searching" | "working" | "listening" | "connecting" | "solving" | "shaping" | "weaving" | "composing";
const LABELS: Record<OrbMode, string> = { breathing: "Idle", searching: "Searching", working: "Analyzing", listening: "Listening", connecting: "Connecting data", solving: "Scoring", shaping: "Shaping", weaving: "Weaving", composing: "Composing" };

const ThinkingOrb = dynamic(() => import("thinking-orbs").then((m) => m.ThinkingOrb), {
  ssr: false,
  loading: () => <span aria-hidden="true" style={{ position: "absolute", inset: "14%", borderRadius: "50%", backgroundImage: "radial-gradient(circle, #0B0B0C 0.8px, transparent 1.3px)", backgroundSize: "6px 6px", opacity: 0.22 }} />,
});

/**
 * Orb del diseño: motor thinking-orbs (MIT). La librería trae dos tamaños afinados (20 y 64).
 * Para tamaños grandes se dibuja con su motor de geometría en un canvas propio a resolución real
 * (escalar el canvas de 64 px lo volvía una nube borrosa).
 */
export function Orb({ mode = "working", px = 64, opacity = 1, speed = 1, dots = 1, paused = false, pulseKey = 0 }: { mode?: OrbMode; px?: number; opacity?: number; speed?: number; dots?: number; paused?: boolean; pulseKey?: number }) {
  const big = px >= 120;
  const preset = px < 40 ? 20 : 64;
  const scale = px / preset;
  return (
    <span role="img" aria-label={LABELS[mode]} style={{ position: "relative", display: "inline-flex", flex: "none", width: px, height: px, opacity, color: "#0B0B0C" }}>
      {pulseKey > 0 && big && (
        // Onda que sale del orbe cada vez que llega actividad nueva; la clave reinicia la animación.
        <span key={pulseKey} aria-hidden="true" className="orb-ripple" style={{ position: "absolute", inset: "12%", borderRadius: "50%", border: "1px solid rgba(11,11,12,0.45)", pointerEvents: "none" }} />
      )}
      {big ? <BigOrb mode={mode} px={px} speed={speed} dots={dots} paused={paused} /> : (
        <span style={{ position: "absolute", left: 0, top: 0, width: preset, height: preset, transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}>
          <ThinkingOrb state={mode} size={preset} speed={speed} dots={dots} paused={paused} />
        </span>
      )}
    </span>
  );
}

type Engine = typeof import("thinking-orbs/engine");
let enginePromise: Promise<Engine> | null = null;
const loadEngine = () => (enginePromise ??= import("thinking-orbs/engine"));
const COUNT_KEYS = ["lonDensity", "ghostN", "nodeN", "segs", "particles", "orbitN"];

/** Canvas a resolución real con la geometría del preset de 64 (radios afinados para ~300 pt, así que a 280 px los puntos quedan nítidos). */
function BigOrb({ mode, px, speed, dots, paused }: { mode: OrbMode; px: number; speed: number; dots: number; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, speed, dots, paused });
  live.current = { mode, speed, dots, paused };
  useEffect(() => {
    const c = ref.current; if (!c) return;
    let alive = true, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(px * dpr); c.height = Math.round(px * dpr);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    void loadEngine().then((eng) => {
      if (!alive) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      let t = Math.random() * 10, last: number | null = null, cur = live.current.mode, prev: OrbMode | null = null, fade = 1, vel = 1;
      const draw = (m: OrbMode, alpha: number) => {
        const r = eng.resolvePreset(m, 64);
        const d = live.current.dots;
        const opts = { ...r.opts };
        if (d !== 1) for (const k of COUNT_KEYS) if (opts[k] != null) opts[k] = Math.max(1, Math.round((opts[k] as number) * (k === "lonDensity" || k === "segs" ? Math.sqrt(d) : d)));
        ctx.globalAlpha = alpha;
        eng.MODE_DRAWS[r.mode](ctx, px, t * r.speed, false, opts);
      };
      const frame = (now: number) => {
        if (!alive) return;
        if (last == null) last = now;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (live.current.mode !== cur) { prev = cur; cur = live.current.mode; fade = 0; }
        vel += (live.current.speed - vel) * Math.min(1, dt * 4);   // la velocidad cambia suave
        if (!live.current.paused && !reduce) t += dt * vel;
        fade = Math.min(1, fade + dt * 2.2);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, px, px);
        if (prev && fade < 1) draw(prev, 1 - fade);
        draw(cur, prev && fade < 1 ? fade : 1);
        ctx.globalAlpha = 1;
        if (reduce && !prev) return;                                  // un solo cuadro si el usuario pide menos movimiento
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [px]);
  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: px, height: px, display: "block" }} />;
}

/**
 * Orbe que reacciona al pipeline: el estado lo da la etapa; la densidad de puntos crece con las
 * candidatas que van pasando los filtros; cada evento nuevo acelera un instante y emite una onda;
 * en cola respira despacio y al terminar se detiene.
 */
export function LiveOrb({ mode, px, activity, passed, idle = false, done = false }: { mode: OrbMode; px: number; activity: number; passed: number; idle?: boolean; done?: boolean }) {
  const [boost, setBoost] = useState(0);
  useEffect(() => {
    if (!activity) return;
    setBoost(1);
    const steps = [setTimeout(() => setBoost(0.5), 900), setTimeout(() => setBoost(0), 2200)];
    return () => steps.forEach(clearTimeout);
  }, [activity]);
  const dots = Math.min(1.7, 0.85 + passed / 50);
  const speed = idle ? 0.55 : 1 + boost * 1.2;
  return <Orb mode={idle ? "breathing" : mode} px={px} speed={speed} dots={idle ? 0.9 : dots} paused={done} pulseKey={idle ? 0 : activity} />;
}

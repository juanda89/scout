"use client";
import dynamic from "next/dynamic";

export type OrbMode = "breathing" | "searching" | "working" | "listening" | "connecting" | "solving" | "shaping" | "weaving" | "composing";
const LABELS: Record<OrbMode, string> = { breathing: "Idle", searching: "Searching", working: "Analyzing", listening: "Listening", connecting: "Connecting data", solving: "Scoring", shaping: "Shaping", weaving: "Weaving", composing: "Composing" };

const ThinkingOrb = dynamic(() => import("thinking-orbs").then((m) => m.ThinkingOrb), {
  ssr: false,
  loading: () => <span aria-hidden="true" style={{ position: "absolute", inset: "14%", borderRadius: "50%", backgroundImage: "radial-gradient(circle, #0B0B0C 0.8px, transparent 1.3px)", backgroundSize: "6px 6px", opacity: 0.22 }} />,
});

/**
 * Orb del diseño: motor thinking-orbs (MIT). La librería trae dos tamaños afinados (20 y 64);
 * para otros tamaños se escala el preset más cercano.
 */
export function Orb({ mode = "working", px = 64, opacity = 1 }: { mode?: OrbMode; px?: number; opacity?: number }) {
  const preset = px < 40 ? 20 : 64;
  const scale = px / preset;
  return (
    <span role="img" aria-label={LABELS[mode]} style={{ position: "relative", display: "inline-flex", flex: "none", width: px, height: px, opacity, color: "#0B0B0C" }}>
      <span style={{ position: "absolute", left: 0, top: 0, width: preset, height: preset, transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}>
        <ThinkingOrb state={mode} size={preset} />
      </span>
    </span>
  );
}

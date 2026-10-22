import { tierColor } from "@/lib/format";

export function FitRing({ fit, size = 34, dashed = false }: { fit: number; size?: number; dashed?: boolean }) {
  const t = tierColor(fit);
  const inner = size - (size >= 60 ? 12 : 7);
  const fontSize = size >= 60 ? 22 : size >= 44 ? 15 : 11.5;
  return (
    <span aria-hidden="true" style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: `conic-gradient(${t.ring} ${Math.round(fit * 3.6)}deg, #ECECEF 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span className="mono" style={{ width: inner, height: inner, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize, fontWeight: 600, letterSpacing: size >= 60 ? "-0.02em" : 0, border: dashed ? "1px dashed #C4C4CB" : 0 }}>{fit}</span>
    </span>
  );
}

export function Avatar({ name, size = 36, src }: { name: string; size?: number; src?: string | null }) {
  const ini = name.split(/[\s._]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  const fs = size >= 56 ? 17 : size >= 36 ? 12 : 10.5;
  if (src) return <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--chip)" }} />;
  return <span aria-hidden="true" style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: fs, fontWeight: 600, color: "var(--ink-2)" }}>{ini}</span>;
}

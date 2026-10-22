export const fmtK = (n: number | null | undefined): string => n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
export const fmtPct = (f: number | null | undefined, digits = 1): string => f == null ? "—" : `${(f * 100).toFixed(digits)}%`;
export const fmtInt = (n: number | null | undefined): string => n == null ? "—" : n.toLocaleString("en-US");
export const fmtDate = (d: Date | string | null | undefined): string => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
export const fmtTime = (d: Date | string | null | undefined): string => d ? new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false }) : "—";
export const initials = (name: string): string => name.split(/[\s._]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
export const platformLabel = (p: string | null | undefined): string => p === "tiktok" ? "TikTok" : p === "youtube" ? "YouTube" : p === "instagram" ? "Instagram" : p ?? "—";
export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export const tierColor = (fit: number) => fit >= 90 ? { ring: "#15803D", text: "#14692F", label: "Excellent", long: "Excellent fit with the brief" } : fit >= 80 ? { ring: "#0B0B0C", text: "#27272A", label: "Very good", long: "Very good fit with the brief" } : { ring: "#9A9AA2", text: "#52525B", label: "Good", long: "Good fit with the brief" };

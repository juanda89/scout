import Link from "next/link";
import { Shell } from "./Shell";
import { Wordmark } from "./Logo";

/** Lienzo común de las páginas legales públicas (sin sesión). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <Shell fx={0.5} fy={0.05}>
      <header className="glass-hd" style={{ minHeight: 60, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 2 }}>
        <Link href="/" aria-label="scout — home" style={{ display: "flex", alignItems: "center" }}><Wordmark /></Link>
        <nav style={{ display: "flex", gap: 16, fontSize: 13.5, color: "var(--muted)" }}>
          <Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms</Link><Link href="/signin" style={{ color: "var(--ink)", fontWeight: 500 }}>Sign in</Link>
        </nav>
      </header>
      <main className="card" style={{ width: "100%", maxWidth: 760, margin: "32px auto 64px", padding: "36px 40px 40px", borderRadius: 20 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 28, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>{title}</h1>
        <p className="mono" style={{ margin: "0 0 28px", fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>Last updated {updated}</p>
        <div className="legal">{children}</div>
        <style>{`.legal h2{margin:28px 0 8px;font-size:17px;font-weight:600;letter-spacing:-0.01em}.legal p,.legal li{font-size:15px;line-height:1.65;color:var(--ink-3)}.legal p{margin:0 0 12px}.legal ul{margin:0 0 12px;padding-left:20px}.legal li{margin-bottom:4px}.legal a{text-decoration:underline}`}</style>
      </main>
    </Shell>
  );
}

export const legalEntity = process.env.LEGAL_ENTITY ?? "the agency that operates this Scout workspace";
export const legalContact = process.env.LEGAL_CONTACT_EMAIL ?? (process.env.ALLOWED_EMAILS ?? "").split(",")[0]?.trim() ?? "";
export const legalLaw = process.env.LEGAL_JURISDICTION ?? "";

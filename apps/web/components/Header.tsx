import Link from "next/link";
import { Wordmark } from "./Logo";
import { Orb } from "./Orb";
import type { Viewer } from "@/lib/session";
import { signOut } from "@/auth";

export interface Crumb { label: string; href?: string }
export interface RunningHint { id: string; pct: number; count: number }

export function Header({ viewer, crumbs, running, right, steps, newDisabled }: { viewer: Viewer; crumbs: Crumb[]; running?: RunningHint | null; right?: React.ReactNode; steps?: React.ReactNode; newDisabled?: string }) {
  return (
    <header className="glass-hd" style={{ flex: "none", minHeight: 60, padding: "10px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 16px", position: "relative", zIndex: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <Link href="/scoutings" aria-label="scout — home" style={{ display: "flex", alignItems: "center" }}><Wordmark /></Link>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: "var(--line)" }} />
        <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 14 }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true" style={{ color: "#B4B4BB" }}>/</span>}
              {c.href ? <Link href={c.href} style={{ color: "var(--muted)" }}>{c.label}</Link>
                : <span aria-current="page" style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 420 }}>{c.label}</span>}
            </span>
          ))}
        </nav>
      </div>
      {steps}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        {right ?? (
          <>
            {running && (
              <Link href={`/scoutings/${running.id}`} className="sec pill">
                <Orb mode="working" px={20} />
                <span>{running.count === 1 ? "1 running" : `${running.count} running`}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{running.pct}%</span>
              </Link>
            )}
            {newDisabled ? (
              <span className="btn" aria-disabled="true" title={newDisabled} style={{ cursor: "not-allowed" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
                <span>New scouting</span>
              </span>
            ) : (
              <Link href="/scoutings/new" className="btn">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
                <span>New scouting</span>
              </Link>
            )}
            <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
              <button type="submit" aria-label={`${viewer.name}’s account · sign out`} title={`${viewer.email} · Sign out`} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--line)", background: "#F4F4F5", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", cursor: "pointer" }}>{viewer.initial}</button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const items = ["Describe", "Confirm", "Scouting"];
  const nodes: React.ReactNode[] = [];
  items.forEach((label, i) => {
    const n = i + 1; const done = n < current; const cur = n === current;
    if (i > 0) nodes.push(<li key={`sep-${n}`} aria-hidden="true" style={{ width: 24, height: 1, background: done || cur ? "var(--ink)" : "var(--line-2)" }} />);
    nodes.push(
      <li key={label} aria-current={cur ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: cur ? 500 : 400, color: n > current ? "var(--muted)" : "var(--ink)" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: done || cur ? "var(--ink)" : "#fff", border: done || cur ? 0 : "1px solid var(--line-2)", color: done || cur ? "#fff" : "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>
          {done ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg> : n}
        </span>
        {done && n === 1 ? <Link href="/scoutings/new" style={{ color: "var(--muted-3)" }}>{label}</Link> : label}
      </li>,
    );
  });
  return <ol aria-label="Steps" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 13 }}>{nodes}</ol>;
}

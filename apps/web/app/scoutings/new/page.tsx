import { withViewer } from "@/lib/session";
import { Header, Steps } from "@/components/Header";
import { Describe } from "./Describe";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { quotaFor } from "@scout/core/scouting/quota";

export const dynamic = "force-dynamic";

export default async function NewScouting() {
  return withViewer(async (viewer) => {
    const quota = await quotaFor(viewer.id);
    const exhausted = !quota.unlimited && quota.remaining <= 0;
    return (
    <Shell fx={0.5} fy={0.16} intensity={1.1}>
      <Header viewer={viewer} crumbs={[{ label: "Scoutings", href: "/scoutings" }, { label: "New scouting" }]} steps={<Steps current={1} />} right={<Link href="/scoutings" className="ghost">Cancel</Link>} />
      <main style={{ flex: 1, width: "100%", maxWidth: 780, margin: "0 auto", padding: "48px 24px 64px", display: "flex", flexDirection: "column", gap: 28 }}>
        {exhausted ? (
          <section className="card" style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 10, textAlign: "center", alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>You’ve used your {quota.limit} included scoutings</h1>
            <p style={{ margin: 0, maxWidth: 480, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-3)" }}>Each account includes {quota.limit} scoutings while Scout is in early access. Contact us if you need more, or revisit the results of your existing scoutings.</p>
            <Link href="/scoutings" className="sec" style={{ marginTop: 8 }}>Back to scoutings</Link>
          </section>
        ) : <Describe />}
      </main>
    </Shell>
    );
  });
}

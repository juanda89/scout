import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { withViewer } from "@/lib/session";
import { Header, Steps } from "@/components/Header";
import { getScouting } from "@scout/core/scouting/repo";
import { ConfirmBrief } from "./ConfirmBrief";

export const dynamic = "force-dynamic";

export default async function Confirm({ params }: { params: Promise<{ draftId: string }> }) {
  return withViewer(async (viewer) => {
  const { draftId } = await params;
  const s = await getScouting(draftId);
  if (!s) notFound();
  if (s.status !== "draft") redirect(`/scoutings/${s.id}`);
  return (
    <Shell fx={0.8} fy={0.12}>
      <Header viewer={viewer} crumbs={[{ label: "Scoutings", href: "/scoutings" }, { label: "New scouting" }]} steps={<Steps current={2} />} right={<Link href="/scoutings" className="ghost">Cancel</Link>} />
      <main style={{ flex: 1, width: "100%", maxWidth: 1240, margin: "0 auto", padding: "32px 24px 64px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>Confirm your brief</h1>
          <p style={{ margin: 0, maxWidth: 620, fontSize: 14.5, lineHeight: 1.55, color: "var(--ink-3)", textWrap: "pretty" }}>Here’s what we understood from your description. Fill in what’s missing and adjust anything before you launch the scouting.</p>
        </div>
        <ConfirmBrief id={s.id} initialName={s.name} description={s.description} initialFields={s.fields} sources={s.field_sources} spans={s.spans} />
      </main>
    </Shell>
  );
  });
}

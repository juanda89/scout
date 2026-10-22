import { withViewer } from "@/lib/session";
import { Header, Steps } from "@/components/Header";
import { Describe } from "./Describe";
import Link from "next/link";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function NewScouting() {
  return withViewer(async (viewer) => (
    <Shell fx={0.5} fy={0.16} intensity={1.1}>
      <Header viewer={viewer} crumbs={[{ label: "Scoutings", href: "/scoutings" }, { label: "New scouting" }]} steps={<Steps current={1} />} right={<Link href="/scoutings" className="ghost">Cancel</Link>} />
      <main style={{ flex: 1, width: "100%", maxWidth: 780, margin: "0 auto", padding: "48px 24px 64px", display: "flex", flexDirection: "column", gap: 28 }}>
        <Describe />
      </main>
    </Shell>
  ));
}

import { withViewer } from "@/lib/session";
import { runningHint, scoutingsFor, overallPct } from "@/lib/data";
import { Header } from "@/components/Header";
import { Shell } from "@/components/Shell";
import { ScoutingsList, type ListRow } from "./ScoutingsList";
import { fmtDate, fmtTime, platformLabel } from "@/lib/format";
import { STAGES } from "@scout/core/scouting/types";
import { quotaFor } from "@scout/core/scouting/quota";

export const dynamic = "force-dynamic";

export default async function ScoutingsPage() {
  return withViewer(async (viewer) => {
  const [items, running, quota] = await Promise.all([scoutingsFor(viewer.id), runningHint(), quotaFor(viewer.id)]);
  const exhausted = !quota.unlimited && quota.remaining <= 0;
  const rows: ListRow[] = items.filter((s) => s.status !== "cancelled").map((s) => {
    const stage = STAGES.find((x) => x.n === Math.max(1, s.stage));
    const startedToday = s.started_at && new Date(s.started_at).toDateString() === new Date().toDateString();
    return {
      id: s.id, title: s.name, status: s.status === "running" || s.status === "queued" ? "running" : s.status === "done" ? "done" : "failed",
      date: s.status === "done" ? fmtDate(s.finished_at) : `Started ${startedToday ? "today, " + fmtTime(s.started_at) : fmtDate(s.started_at ?? s.created_at)}`,
      plats: (s.fields.platforms.length ? s.fields.platforms : ["instagram"]).map(platformLabel).join(", "),
      loc: s.fields.location || "—",
      count: s.creators_count, avg: s.avg_fit, best: s.best_fit, top: s.top_names,
      stage: s.stage, stageTitle: stage?.title ?? "", pct: overallPct(s.stage, s.stage_progress), stageProgress: s.stage_progress,
      error: s.error,
    };
  });
  return (
    <Shell fx={0.5} fy={0.04}>
      <Header viewer={viewer} crumbs={[{ label: "Scoutings" }]} running={running} newDisabled={exhausted ? `You’ve used your ${quota.limit} scoutings` : undefined} />
      <main style={{ flex: 1, width: "100%", maxWidth: 1120, margin: "0 auto", padding: "32px 24px 64px", display: "flex", flexDirection: "column", gap: 24 }}>
        {!quota.unlimited && (
          <p style={{ margin: "-8px 0 0", fontSize: 13, color: exhausted ? "var(--orange-ink)" : "var(--muted)" }}>{exhausted ? `You’ve used your ${quota.limit} included scoutings. Contact us to get more.` : `${quota.used} of ${quota.limit} included scoutings used · ${quota.remaining} left.`}</p>
        )}
        <ScoutingsList rows={rows} />
      </main>
    </Shell>
  );
  });
}

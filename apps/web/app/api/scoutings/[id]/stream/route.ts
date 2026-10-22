import { auth } from "@/auth";
import { progressSnapshot } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events con el estado del scouting cada 2 s (eventos nuevos, etapas, métricas). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  let after = Number(url.searchParams.get("after") ?? 0);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let alive = true;
      req.signal.addEventListener("abort", () => { alive = false; });
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      while (alive) {
        const snap = await progressSnapshot(id, after);
        if (!snap) { send("gone", {}); break; }
        if (snap.events.length) after = Math.max(after, ...snap.events.map((e) => e.id));
        send("state", snap);
        if (["done", "failed", "cancelled"].includes(snap.status)) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

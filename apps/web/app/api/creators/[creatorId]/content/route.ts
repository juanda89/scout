import { viewerOrNull } from "@/lib/session";
import { creatorContent } from "@/lib/data";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ creatorId: string }> }) {
  if (!(await viewerOrNull())) return new Response("unauthorized", { status: 401 });
  const { creatorId } = await params;
  return Response.json(await creatorContent(creatorId));
}

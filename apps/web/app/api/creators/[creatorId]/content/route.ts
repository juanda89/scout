import { auth } from "@/auth";
import { creatorContent } from "@/lib/data";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ creatorId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { creatorId } = await params;
  return Response.json(await creatorContent(creatorId));
}

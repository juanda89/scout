import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface Viewer { id: number; email: string; name: string; initial: string }

export async function requireViewer(): Promise<Viewer> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) redirect("/signin");
  const name = u.name ?? u.email;
  return { id: Number(u.id), email: u.email, name, initial: name.trim()[0]?.toUpperCase() ?? "?" };
}

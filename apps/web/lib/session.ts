import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { runAsUser } from "@scout/core/db";

export interface Viewer { id: number; email: string; name: string; initial: string }

export async function requireViewer(): Promise<Viewer> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) redirect("/signin");
  const name = u.name ?? u.email;
  return { id: Number(u.id), email: u.email, name, initial: name.trim()[0]?.toUpperCase() ?? "?" };
}

/** Ejecuta fn con el usuario autenticado fijado en la sesión SQL: las políticas RLS solo muestran sus filas. */
export async function withViewer<T>(fn: (viewer: Viewer) => Promise<T>): Promise<T> {
  const viewer = await requireViewer();
  return runAsUser(viewer.id, () => fn(viewer));
}

/** Variante para rutas API: devuelve null sin redirigir si no hay sesión. */
export async function viewerOrNull(): Promise<Viewer | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  const name = u.name ?? u.email;
  return { id: Number(u.id), email: u.email, name, initial: name.trim()[0]?.toUpperCase() ?? "?" };
}

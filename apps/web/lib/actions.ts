"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createScouting, getScouting, updateScouting, toggleShortlist, addEvent } from "@scout/core/scouting/repo";
import { extractFields } from "@scout/core/scouting/fields";
import { ScoutingFieldsSchema, type FieldSource } from "@scout/core/scouting/types";
import { enqueueScouting } from "@scout/core/scouting/queue";
import { requireViewer } from "./session";

/** Paso Describe -> Confirm: extrae campos y guarda un borrador. */
export async function createDraft(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const description = String(formData.get("description") ?? "").trim();
  if (!description) redirect("/scoutings/new");
  const ex = await extractFields(description);
  const s = await createScouting({ ownerId: viewer.id, name: ex.name, description, fields: ex.fields, fieldSources: ex.sources, spans: ex.spans });
  redirect(`/scoutings/new/${s.id}`);
}

export interface DraftPatch { name?: string; fields: Record<string, unknown>; notify_email?: boolean }

/** Guarda los campos editados en el paso Confirm. */
export async function saveDraft(id: string, patch: DraftPatch): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireViewer();
  const s = await getScouting(id);
  if (!s || s.status !== "draft") return { ok: false, error: "Draft not found" };
  const parsed = ScoutingFieldsSchema.safeParse({ ...s.fields, ...patch.fields });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const sources: Record<string, FieldSource> = { ...s.field_sources };
  for (const k of Object.keys(patch.fields)) sources[k === "followers_min" || k === "followers_max" ? "followers" : k === "age_min" || k === "age_max" ? "age" : k] = "user";
  await updateScouting(id, { fields: parsed.data, field_sources: sources, ...(patch.name ? { name: patch.name } : {}), ...(patch.notify_email !== undefined ? { notify_email: patch.notify_email } : {}) });
  return { ok: true };
}

/** "Create scouting": valida requeridos, encola y redirige a la pantalla de progreso. */
export async function launchScouting(id: string): Promise<{ ok: false; error: string } | never> {
  await requireViewer();
  const s = await getScouting(id);
  if (!s || s.status !== "draft") return { ok: false, error: "Draft not found" };
  const f = s.fields;
  const missing: string[] = [];
  if (!f.brand) missing.push("Brand");
  if (!f.creators_wanted) missing.push("Number of creators");
  if (!f.platforms.length) missing.push("Platforms");
  if (!f.location) missing.push("Location");
  if (f.budget == null) missing.push("Total budget");
  if (missing.length) return { ok: false, error: `Still needed: ${missing.join(", ")}` };
  await updateScouting(id, { status: "queued" });
  await addEvent(id, null, "Scouting queued");
  await enqueueScouting(id);
  revalidatePath("/scoutings");
  redirect(`/scoutings/${id}`);
}

export async function cancelScouting(id: string): Promise<void> {
  await requireViewer();
  await updateScouting(id, { status: "cancelled", finished_at: new Date() });
  await addEvent(id, null, "Scouting cancelled by the user", "warn");
  revalidatePath(`/scoutings/${id}`);
  redirect("/scoutings");
}

export async function setNotify(id: string, on: boolean): Promise<void> {
  await requireViewer();
  await updateScouting(id, { notify_email: on });
}

export async function toggleShortlistAction(scoutingId: string, creatorId: string): Promise<boolean> {
  const viewer = await requireViewer();
  const on = await toggleShortlist(scoutingId, creatorId, viewer.id);
  revalidatePath(`/scoutings/${scoutingId}`);
  return on;
}

/** Duplica el brief de una scouting como borrador nuevo. */
export async function duplicateScouting(id: string): Promise<void> {
  const viewer = await requireViewer();
  const s = await getScouting(id);
  if (!s) redirect("/scoutings");
  const copy = await createScouting({ ownerId: viewer.id, name: `${s.name} (copy)`, description: s.description, fields: s.fields, fieldSources: s.field_sources, spans: s.spans });
  redirect(`/scoutings/new/${copy.id}`);
}

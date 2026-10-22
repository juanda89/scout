"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createScouting, getScouting, updateScouting, toggleShortlist, addEvent } from "@scout/core/scouting/repo";
import { extractFields } from "@scout/core/scouting/fields";
import { ScoutingFieldsSchema, type FieldSource } from "@scout/core/scouting/types";
import { enqueueScouting } from "@scout/core/scouting/queue";
import { isQuotaError, quotaFor } from "@scout/core/scouting/quota";
import { withViewer } from "./session";

/** Paso Describe -> Confirm: extrae campos y guarda un borrador. */
export async function createDraft(formData: FormData): Promise<void> {
  const description = String(formData.get("description") ?? "").trim();
  if (!description) redirect("/scoutings/new");
  const ex = await extractFields(description);
  const id = await withViewer(async (viewer) => (await createScouting({ ownerId: viewer.id, name: ex.name, description, fields: ex.fields, fieldSources: ex.sources, spans: ex.spans })).id);
  redirect(`/scoutings/new/${id}`);
}

export interface DraftPatch { name?: string; fields: Record<string, unknown>; notify_email?: boolean }

/** Guarda los campos editados en el paso Confirm. */
export async function saveDraft(id: string, patch: DraftPatch): Promise<{ ok: true } | { ok: false; error: string }> {
  return withViewer(async () => {
  const s = await getScouting(id);
  if (!s || s.status !== "draft") return { ok: false, error: "Draft not found" };
  const parsed = ScoutingFieldsSchema.safeParse({ ...s.fields, ...patch.fields });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const sources: Record<string, FieldSource> = { ...s.field_sources };
  for (const k of Object.keys(patch.fields)) sources[k === "followers_min" || k === "followers_max" ? "followers" : k === "age_min" || k === "age_max" ? "age" : k] = "user";
  await updateScouting(id, { fields: parsed.data, field_sources: sources, ...(patch.name ? { name: patch.name } : {}), ...(patch.notify_email !== undefined ? { notify_email: patch.notify_email } : {}) });
  return { ok: true as const };
  });
}

/** "Create scouting": valida requeridos, encola y redirige a la pantalla de progreso. */
export async function launchScouting(id: string): Promise<{ ok: false; error: string } | never> {
  const check = await withViewer(async (): Promise<{ ok: false; error: string } | { ok: true }> => {
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
  try {
    await updateScouting(id, { status: "queued" });
  } catch (e) {
    if (isQuotaError(e)) { const q = await quotaFor(s.owner_id ?? 0).catch(() => null); return { ok: false, error: `You’ve used your ${q?.limit ?? ""} included scoutings. Contact us to get more.` }; }
    throw e;
  }
  await addEvent(id, null, "Scouting queued");
  return { ok: true };
  });
  if (!check.ok) return check;
  await enqueueScouting(id);
  revalidatePath("/scoutings");
  redirect(`/scoutings/${id}`);
}

export async function cancelScouting(id: string): Promise<void> {
  await withViewer(async () => {
    await updateScouting(id, { status: "cancelled", finished_at: new Date() });
    await addEvent(id, null, "Scouting cancelled by the user", "warn");
  });
  revalidatePath(`/scoutings/${id}`);
  redirect("/scoutings");
}

export async function setNotify(id: string, on: boolean): Promise<void> {
  await withViewer(() => updateScouting(id, { notify_email: on }));
}

export async function toggleShortlistAction(scoutingId: string, creatorId: string): Promise<boolean> {
  const on = await withViewer((viewer) => toggleShortlist(scoutingId, creatorId, viewer.id));
  revalidatePath(`/scoutings/${scoutingId}`);
  return on;
}

/** Duplica el brief de una scouting como borrador nuevo. */
export async function duplicateScouting(id: string): Promise<void> {
  const copyId = await withViewer(async (viewer) => {
    const s = await getScouting(id);
    if (!s) return null;
    const copy = await createScouting({ ownerId: viewer.id, name: `${s.name} (copy)`, description: s.description, fields: s.fields, fieldSources: s.field_sources, spans: s.spans });
    return copy.id;
  });
  redirect(copyId ? `/scoutings/new/${copyId}` : "/scoutings");
}

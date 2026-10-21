import { z } from "zod";

export const ModalitySchema = z.enum(["caption", "transcript", "vision", "bio", "comment", "external_api", "human", "metrics"]);
export const ClaimStatusSchema = z.enum(["auto", "human_confirmed", "human_rejected", "superseded"]);

export const ClaimSchema = z.object({
  id: z.string().uuid(),
  creator_id: z.string().uuid(),
  predicate_key: z.string(),
  predicate_version: z.number().int().default(1),
  value: z.any(),
  polarity: z.enum(["affirms", "denies"]).default("affirms"),
  observed_at: z.coerce.date().nullable(),
  evidence_content_id: z.string().uuid().nullable(),
  evidence_span: z.string().nullable(),
  evidence_modality: ModalitySchema,
  confidence: z.coerce.number().min(0).max(1),
  extractor: z.record(z.any()).default({}),
  status: ClaimStatusSchema.default("auto"),
  superseded_by: z.string().uuid().nullable().optional(),
  created_at: z.coerce.date().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Claim recién extraído, antes de persistir. */
export const NewClaimSchema = ClaimSchema.omit({ id: true, created_at: true, superseded_by: true, status: true });
export type NewClaim = z.infer<typeof NewClaimSchema>;

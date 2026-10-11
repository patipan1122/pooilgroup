// Document cost/expense metadata — SHARED Zod validators (Must #6, CEO
// spec locked in WORKSHOP_docuflow-org-structure-2026-10-10).
// ────────────────────────────────────────────────────────────────────
// One source of truth, imported by every route that writes these fields:
//   - app/api/docuflow/upload/route.ts        (create, presigned path)
//   - app/api/docuflow/upload-proxy/route.ts  (create, proxy path)
//   - app/api/docuflow/[id]/route.ts          (update/PATCH)
//
// A rule copy-pasted into multiple files always drifts eventually — keep
// this the only place "what counts as a valid cost amount/frequency" is
// defined (feedback_one_rule_two_copies_drifts).
// ────────────────────────────────────────────────────────────────────

import { z } from "zod";

export const COST_FREQUENCIES = ["monthly", "yearly", "one_time"] as const;
export type CostFrequencyValue = (typeof COST_FREQUENCIES)[number];

/** >= 0 and at most 2 decimal places — the DB column is NUMERIC(12,2), so
 * rejecting a 3rd decimal place server-side means what the client saw on
 * screen is exactly what gets stored, never silently rounded/truncated. */
export const CostAmountSchema = z
  .number()
  .finite("จำนวนเงินไม่ถูกต้อง")
  .min(0, "จำนวนเงินต้องไม่ติดลบ")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: "ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง",
  });

export const CostFrequencySchema = z.enum(COST_FREQUENCIES);

export const CostLabelSchema = z.string().max(255);

/** Nested shape used by the CREATE paths — the whole `cost` object is
 * optional (the section is collapsed/untouched most of the time), and
 * each field inside is independently optional too (a doc can have just
 * an amount with no label, etc). */
export const CostInputSchema = z.object({
  costAmount: CostAmountSchema.optional(),
  costLabel: CostLabelSchema.optional(),
  costFrequency: CostFrequencySchema.optional(),
});

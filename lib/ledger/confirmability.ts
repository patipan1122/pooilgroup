// Ledger · confirm-gate — SINGLE source of truth for "can this expense be confirmed?"
//
// D1 rule (CEO): นักบัญชีจะยืนยันรายจ่ายได้ก็ต่อเมื่อ "รู้ว่าเป็นของสาขาไหน + หมวดอะไร"
// แล้วเท่านั้น — ถ้าไม่รู้สาขาต้องเลือก "สำนักงาน (ส่วนกลาง)" อย่างตั้งใจ (ดู
// ensureCentralBranch ใน _actions.ts) ไม่ใช่ปล่อยว่าง.
//
// IMPORTANT — keep this DELIBERATELY SEPARATE from VAT completeness
// (completenessStatus / completenessMissing / CompletenessDot). A receipt can be
// VAT-perfect (เขียวเต็ม) yet still be missing only a branch — that case must NOT
// turn the VAT dot amber. Branch/category presence is an OPERATIONAL posting gate,
// not a tax-document-validity grade. Folding them together would make a valid
// tax invoice render as an incomplete-VAT row, confusing the accountant.
//
// Pure function · no IO · no Prisma · no session — safe to import from server
// actions, the LIFF, and (if ever needed) the client list chip-rail.

export type ConfirmabilityMissing = "branch" | "category";

export interface ConfirmabilityResult {
  /** true ⇔ BOTH branch and category are present (non-null AND non-empty). */
  ok: boolean;
  /** Which posting fields are still blank — drives the Thai blocker message. */
  missing: ConfirmabilityMissing[];
}

/** A field counts as "present" only if it is a non-null, non-whitespace string.
 *  Covers BOTH the DB-null case AND the patch-coerced '' case (toData() maps
 *  ''→null but the merged value the gate sees may still be a bare ''). */
function isPresent(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * The ONE gate every confirm path (web confirmExpense, bulkConfirm, LIFF
 * liffConfirmExpense) must call on the FINAL merged branchId/categoryId —
 * i.e. AFTER applying any patch, never on the stale DB row alone (a confirm
 * patch can blank a field in the same call). ok ⇔ both present.
 */
export function expenseConfirmability(row: {
  branchId: string | null;
  categoryId: string | null;
}): ConfirmabilityResult {
  const missing: ConfirmabilityMissing[] = [];
  if (!isPresent(row.branchId)) missing.push("branch");
  if (!isPresent(row.categoryId)) missing.push("category");
  return { ok: missing.length === 0, missing };
}

/** Thai blocker copy naming the missing posting field(s). Shared so the web list,
 *  the review pane, and the LIFF all surface the SAME wording. */
export function confirmabilityMessage(missing: ConfirmabilityMissing[]): string {
  if (missing.length === 0) return "";
  const label: Record<ConfirmabilityMissing, string> = {
    branch: "สาขา",
    category: "หมวดหมู่ค่าใช้จ่าย",
  };
  const names = missing.map((m) => label[m]).join("และ");
  return `ต้องระบุ${names}ก่อนยืนยัน`;
}

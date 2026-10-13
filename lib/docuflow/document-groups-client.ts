// DOCUMENT GROUPS — browser-side fetch helper
// ────────────────────────────────────────────────────────────────────
// Creates a FLAT DocumentGroup row (companyId/parentGroupId both null) via
// the legacy POST /api/docuflow/document-groups endpoint.
//
// CEO Pinpoint item #1 (2026-10-13): this used to be called from BOTH
// components/docuflow/upload-form.tsx AND
// components/docuflow/quick-create-document-group-button.tsx — a flat row
// has no home in the per-company nested tree (TreeBrowser/
// DocumentGroupDrillDown only render companyId-scoped folders), so every
// group created this way read as "created, then vanished." Both call
// sites now create through the company-scoped nested path instead
// (createDocumentGroupFolder in document-group-tree-actions.ts) — this
// function is kept in place (not deleted) per the Owner persona's
// "repoint rather than remove" call, in case another legacy flat-group
// surface still needs it, but has no caller in the app today.
// ────────────────────────────────────────────────────────────────────

import type { DocumentGroupRecord } from "./document-groups";

export async function createDocumentGroupViaApi(input: {
  name: string;
}): Promise<DocumentGroupRecord> {
  const res = await fetch("/api/docuflow/document-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "สร้างกลุ่มเอกสารไม่สำเร็จ");
  }
  const data = (await res.json()) as { documentGroup: DocumentGroupRecord };
  return data.documentGroup;
}

// DOCUMENT GROUPS — browser-side fetch helper
// ────────────────────────────────────────────────────────────────────
// Single reusable "create a DocumentGroup" network call, shared by every
// client surface that offers a quick-create dialog for it:
//   - components/docuflow/upload-form.tsx (inside the upload wizard)
//   - components/docuflow/quick-create-document-group-button.tsx (the
//     standalone button mounted on /docuflow/documents — CEO click-report
//     item 3, 2026-10-10: the dialog already existed in the upload form,
//     this just gives it a second entry point without a second
//     implementation of the POST/validate/success path).
//
// Keeping this in one place means both call sites hit the exact same
// endpoint with the exact same error-handling — if the API contract ever
// changes, there is only one function to update.
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

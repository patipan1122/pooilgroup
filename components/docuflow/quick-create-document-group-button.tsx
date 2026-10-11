"use client";

// QuickCreateDocumentGroupButton — "สร้างกลุ่มเอกสาร" shortcut mounted on
// /docuflow/documents (CEO click-report item 3, 2026-10-10). The dialog
// already existed inside the upload form (components/docuflow/upload-form.tsx,
// handleQuickCreateGroup) but was only reachable from there — the CEO asked
// for it on the main browse/list page too.
//
// Reuses the exact same dialog component and the exact same
// createDocumentGroupViaApi() network call the upload form uses — this is
// a second MOUNT POINT, not a second implementation. The only thing that
// differs is what happens after a successful create: the upload form
// auto-selects the new group in its <select>; here there's no form to
// select into, so we just toast + refresh the server page.
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderPlus } from "lucide-react";
import { DfButton } from "./df-ui";
import { QuickCreateDocGroupDialog } from "./quick-create-document-group-dialog";
import { createDocumentGroupViaApi } from "@/lib/docuflow/document-groups-client";

export function QuickCreateDocumentGroupButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleCreate(input: { name: string }) {
    const created = await createDocumentGroupViaApi(input);
    setOpen(false);
    toast.success(
      `สร้างกลุ่มเอกสาร "${created.name}" แล้ว — เลือกใช้ได้ตอนอัปโหลดเอกสาร`,
    );
    router.refresh();
  }

  return (
    <>
      <DfButton variant="ghost" onClick={() => setOpen(true)}>
        <FolderPlus size={15} />
        สร้างกลุ่มเอกสาร
      </DfButton>
      <QuickCreateDocGroupDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreate={handleCreate}
      />
    </>
  );
}

"use client";

/* ============================================================
   QuickCreateDocGroupDialog — "+ สร้างใหม่" dialog for a brand-new
   DocumentGroup. Extracted out of upload-form.tsx (2026-10-10, CEO
   click-report item 3) so it can be mounted from a second entry point —
   a standalone button on /docuflow/documents (see
   quick-create-document-group-button.tsx) — WITHOUT a second
   implementation of the dialog UI. The upload form still owns its own
   post-create behavior (auto-select the new group in its <select>) via
   the `onCreate` callback; this component only owns the form fields +
   client-side validation + busy state.

   Deliberately a <div>, not a <form> — when mounted inside UploadForm's
   own outer <form> (the upload form itself), a nested <form> there is
   invalid HTML: a submit click silently falls through to the OUTER
   upload form instead of this dialog's handler (confirmed via live
   end-to-end testing 2026-09-25 on the sibling DocumentType dialog — the
   button appeared to do nothing and the page reloaded to the top).
   Enter-to-submit on the name field is wired manually below for the same
   reason (an <input> inside the outer form defaults to submitting THAT
   form on Enter). When mounted standalone (no outer form), this still
   works identically — a <div> never depends on there being a form.
   ============================================================ */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import {
  DOCUMENT_GROUP_ICONS,
  type DocumentGroupIconKey,
} from "@/lib/docuflow/document-group-icons";
import { FolderIconPicker } from "./folder-icon-picker";

export function QuickCreateDocGroupDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; icon: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<DocumentGroupIconKey>(DOCUMENT_GROUP_ICONS[0]);
  const [busy, setBusy] = useState(false);

  function handleClose() {
    if (busy) return;
    setName("");
    setIcon(DOCUMENT_GROUP_ICONS[0]);
    onClose();
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("ใส่ชื่อกลุ่มเอกสารก่อน");
      return;
    }
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), icon });
      setName("");
      setIcon(DOCUMENT_GROUP_ICONS[0]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "สร้างกลุ่มเอกสารไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} title="สร้างกลุ่มเอกสารใหม่">
      <div className="space-y-4">
        <Field label="ชื่อกลุ่มเอกสาร" required htmlFor="qcg-name">
          <Input
            id="qcg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={busy}
            autoFocus
            placeholder="เช่น เอกสารต่ออายุประจำปี"
          />
        </Field>

        {/* CEO Pinpoint item #13 (2026-10-13) — folder icon picker. */}
        <Field label="ไอคอน" optional>
          <FolderIconPicker value={icon} onChange={setIcon} disabled={busy} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleSubmit} loading={busy}>
            สร้างกลุ่มเอกสาร
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

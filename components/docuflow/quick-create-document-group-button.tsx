"use client";

// QuickCreateDocumentGroupButton — "สร้างกลุ่มเอกสาร" shortcut mounted on
// /docuflow/documents (CEO click-report item 3, 2026-10-10).
//
// CEO Pinpoint item #1 (2026-10-13) — this button used to call the legacy
// FLAT createDocumentGroupViaApi(), which writes a DocumentGroup row with
// companyId=null. TreeBrowser/DocumentGroupDrillDown only ever render
// folders scoped to a real company — a flat row has no home anywhere in
// the nested tree, so it reads as "created, then vanished." Per the Owner
// persona's call ("repoint rather than remove"), this now creates the
// folder under whichever company is CURRENTLY SELECTED (the page's own
// company-switcher scope, passed down as `companyId`/`companyName`),
// through the exact same company-scoped nested-create server action the
// in-drilldown "create folder here" button already uses
// (createDocumentGroupFolder) — not a second implementation, a second
// MOUNT POINT of the same create path.
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderPlus } from "lucide-react";
import { DfButton } from "./df-ui";
import { QuickCreateDocGroupDialog } from "./quick-create-document-group-dialog";
import { createDocumentGroupFolder } from "@/lib/docuflow/document-group-tree-actions";
import { useDocumentGroupRefresh } from "./document-group-refresh-context";

interface Props {
  /** The company currently selected (lib/auth/company-context.ts
   *  resolveCompanyFilter) — always a concrete company id at Pooilgroup
   *  today (CEO decision 2026-10-10: no more "all companies" state), but
   *  guarded defensively below in case an org ever has zero companies. */
  companyId: string;
  companyName: string;
}

export function QuickCreateDocumentGroupButton({ companyId, companyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Verification follow-up (2026-10-14) — router.refresh() alone re-fetches
  // this page's own Server Component data, but DocumentGroupDrillDown (the
  // tree view in the "ตามบริษัท" view) fetches its own folder list
  // client-side and never reads from this page's props, so the already-open
  // tree didn't pick up the new folder until a manual reload. `bump()`
  // signals it directly — see document-group-refresh-context.tsx.
  const { bump } = useDocumentGroupRefresh();

  async function handleCreate(input: { name: string; icon: string | null }) {
    const res = await createDocumentGroupFolder({
      companyId,
      parentGroupId: null,
      name: input.name,
      icon: input.icon,
    });
    if (!res.ok) {
      throw new Error(res.error);
    }
    setOpen(false);
    toast.success(
      `สร้างกลุ่มเอกสาร "${res.group.name}" ในบริษัท ${companyName} แล้ว — ดูได้ที่แท็บ "ตามบริษัท"`,
    );
    router.refresh();
    bump();
  }

  if (!companyId) {
    return (
      <DfButton variant="ghost" disabled title="เลือกบริษัทก่อน">
        <FolderPlus size={15} />
        สร้างกลุ่มเอกสาร
      </DfButton>
    );
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

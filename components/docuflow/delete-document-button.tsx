"use client";

// DeleteDocumentButton — soft-delete document via DELETE /api/docuflow/[id]
// Admin tier only (gating done in parent server component).
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

interface Props {
  id: string;
  name: string;
}

export function DeleteDocumentButton({ id, name }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function confirmDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/docuflow/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "ลบไม่สำเร็จ");
      }
      toast.success("ลบเอกสารเรียบร้อย");
      setOpen(false);
      startTransition(() => {
        router.push("/docuflow/documents");
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="danger"
        size="md"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        <Trash2 className="size-4" />
        ลบ
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="ลบเอกสาร?">
        <p className="text-sm text-zinc-700 leading-relaxed">
          ยืนยันลบเอกสาร <span className="font-bold">&ldquo;{name}&rdquo;</span> ?
          <br />
          เอกสารจะไม่แสดงในระบบ แต่ไฟล์ใน R2 ยังเก็บอยู่ (ติดต่อ Admin หากต้องการกู้คืน)
        </p>
        <div className="flex items-center justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="danger" onClick={confirmDelete} loading={busy}>
            <Trash2 className="size-4" />
            ลบเอกสาร
          </Button>
        </div>
      </Dialog>
    </>
  );
}

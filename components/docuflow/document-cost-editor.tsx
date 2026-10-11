"use client";

// DocumentCostEditor — edit the ค่าใช้จ่าย metadata (CEO spec, Must #6)
// after a document has already been uploaded.
// ────────────────────────────────────────────────────────────────────
// This module's document detail page (app/(admin)/docuflow/documents/[id])
// doesn't otherwise have a name/description edit view to piggyback the
// cost fields onto — mounting them here (admin tier only, same PATCH
// /api/docuflow/[id] endpoint the rest of the detail page's data comes
// from) is the one place an admin can fix a typo'd amount or add cost
// info to a document uploaded before this feature existed, without
// re-uploading the file.
//
// Reuses the exact same <CostFieldsSection> UI (collapsed by default,
// same 3-option frequency pill row, same "not synced with Ledger/CashHub"
// note) as the upload form — only the save behavior differs (PATCH an
// existing document vs. include-in-create-payload).
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CostFieldsSection,
  hasCostFields,
  type CostFields,
  type CostFrequency,
} from "./cost-fields-section";

interface Props {
  documentId: string;
  initial: {
    costAmount: number | null;
    costLabel: string | null;
    costFrequency: string | null;
  };
}

function toInitialFields(initial: Props["initial"]): CostFields {
  const freq = initial.costFrequency;
  const validFreq: CostFrequency | "" =
    freq === "monthly" || freq === "yearly" || freq === "one_time" ? freq : "";
  return {
    costAmount: initial.costAmount !== null ? String(initial.costAmount) : "",
    costLabel: initial.costLabel ?? "",
    costFrequency: validFreq,
  };
}

export function DocumentCostEditor({ documentId, initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<CostFields>(() =>
    toInitialFields(initial),
  );
  const [saving, setSaving] = useState(false);
  const alreadyHasCost = hasCostFields(toInitialFields(initial));

  async function handleSave() {
    const amount = values.costAmount.trim() ? Number(values.costAmount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast.error("จำนวนเงินต้องไม่ติดลบ");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costAmount: amount,
          costLabel: values.costLabel.trim() || null,
          costFrequency: values.costFrequency || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกไม่สำเร็จ");
      }
      toast.success("บันทึกข้อมูลค่าใช้จ่ายแล้ว");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <CostFieldsSection
        values={values}
        onChange={setValues}
        disabled={saving}
        defaultOpen={alreadyHasCost}
      />
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          บันทึก
        </Button>
      </div>
    </div>
  );
}

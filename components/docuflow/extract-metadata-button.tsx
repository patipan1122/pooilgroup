"use client";

// ExtractMetadataButton — POSTs to /api/docuflow/[id]/renewal-history
// to trigger AI metadata extraction on the current document.
// Admin tier only (gating done in parent server component / API).
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  documentId: string;
  /** Optional kind hint — defaults to "auto" (AI guesses from filename) */
  kind?: "insurance" | "rental" | "registration" | "auto";
  /** Different label when re-running extraction */
  hasExisting?: boolean;
}

export function ExtractMetadataButton({
  documentId,
  kind = "auto",
  hasExisting = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/docuflow/${documentId}/renewal-history`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        cached?: boolean;
        tokensUsed?: number | null;
      };
      if (!res.ok) {
        throw new Error(data.error || "ดึงข้อมูลไม่สำเร็จ");
      }
      if (data.cached) {
        toast.success("อ่านข้อมูลจาก cache แล้ว");
      } else {
        toast.success(
          `ดึงข้อมูลด้วย AI สำเร็จ${data.tokensUsed ? ` · ${data.tokensUsed} tokens` : ""}`,
        );
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ดึงข้อมูลไม่สำเร็จ";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy}
      className="gap-2"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Sparkles className="size-4" />
      )}
      {busy
        ? "กำลังอ่าน…"
        : hasExisting
          ? "ดึงข้อมูลใหม่"
          : "ดึงข้อมูลด้วย AI"}
    </Button>
  );
}

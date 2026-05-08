"use client";

// RenewalCtaRow — kind-aware CTA row below the renewal comparison.
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §14 lines 599/612/630
//
//   insurance/rental → [เซ็นต่อสัญญา] [ต่อรองก่อน] [ดูสัญญาเก่า] [ขอเปรียบเทียบ]
//   registration     → [ต่อทะเบียนเลย] [ดูประวัติทั้งหมด]
//
// Hidden when chain length === 1 (no prior) — parent handles that path
// since the chain-1 layout doesn't render the comparison card at all.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { toast } from "sonner";
import { PenLine, MessageSquare, FileText, GitCompare, ListOrdered, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Kind = "insurance" | "rental" | "registration" | "unknown" | null;

interface Props {
  kind: Kind;
  /** id of the most-recent (current) document in the chain */
  newestDocumentId: string;
  /** id of the prior (n-1) document — null when chain length === 1 */
  priorDocumentId: string | null;
  /** Linked vehicle id, set only when kind === "registration" + linked */
  vehicleIdForRenew: string | null;
}

const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl";

const OUTLINE_BTN =
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-10 px-4 text-sm rounded-xl";

export function RenewalCtaRow({
  kind,
  newestDocumentId,
  priorDocumentId,
  vehicleIdForRenew,
}: Props) {
  // Hide entirely when chain length === 1
  if (!priorDocumentId && kind !== "registration") return null;

  function handleNegotiate() {
    // TODO: wire to a real "needs negotiation" notification flow.
    toast.success("แจ้งทีมต่อรองเรียบร้อย");
  }

  function handleCompareOthers() {
    // TODO: wire to AI comparison-quote workflow when shipped.
    toast.success("ส่งคำขอเปรียบเทียบเรียบร้อย");
  }

  function handleScrollToTimeline() {
    // Best-effort: timeline list lives in same Section. Caller may not have
    // it visible (chain === 2). Falls back to a friendly toast.
    if (typeof document === "undefined") return;
    const sec = document.querySelector('[data-renewal-timeline="true"]');
    if (sec) {
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      toast("ดูประวัติด้านล่างนี้");
    }
  }

  if (kind === "registration") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {vehicleIdForRenew && (
          <Link
            href={`/docuflow/vehicles/${vehicleIdForRenew}/renew?type=registration`}
            className={PRIMARY_BTN}
          >
            <RefreshCw className="size-4" />
            ต่อทะเบียนเลย
          </Link>
        )}
        <button type="button" onClick={handleScrollToTimeline} className={OUTLINE_BTN}>
          <ListOrdered className="size-4" />
          ดูประวัติทั้งหมด
        </button>
      </div>
    );
  }

  // insurance / rental / unknown — use the contract CTA cluster
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/docuflow/documents/${newestDocumentId}/signatures`}
        className={PRIMARY_BTN}
      >
        <PenLine className="size-4" />
        เซ็นต่อสัญญา
      </Link>
      <Button variant="outline" type="button" onClick={handleNegotiate}>
        <MessageSquare className="size-4" />
        ต่อรองก่อน
      </Button>
      {priorDocumentId && (
        <Link href={`/docuflow/documents/${priorDocumentId}`} className={OUTLINE_BTN}>
          <FileText className="size-4" />
          ดูสัญญาเก่า
        </Link>
      )}
      <Button variant="ghost" type="button" onClick={handleCompareOthers}>
        <GitCompare className="size-4" />
        ขอเปรียบเทียบ
      </Button>
    </div>
  );
}

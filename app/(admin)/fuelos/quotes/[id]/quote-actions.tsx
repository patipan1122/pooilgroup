"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { Trophy, X, Ban, Clock, Link2, Check, ArrowRightLeft } from "lucide-react";
import type { QuoteStatus } from "@/lib/generated/prisma/enums";
import { setQuoteResult, convertToOrder } from "../actions";

const RESULT_OPTIONS: { value: QuoteStatus; label: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
  { value: "WON", label: "ชนะ (ได้งาน)", icon: Trophy, tone: "data-[on=true]:bg-leaf-600 data-[on=true]:text-white" },
  { value: "LOST", label: "แพ้", icon: X, tone: "data-[on=true]:bg-danger data-[on=true]:text-white" },
  { value: "DECLINED", label: "ลูกค้าปฏิเสธ", icon: Ban, tone: "data-[on=true]:bg-zinc-700 data-[on=true]:text-white" },
  { value: "NO_RESPONSE", label: "ไม่ตอบกลับ", icon: Clock, tone: "data-[on=true]:bg-zinc-500 data-[on=true]:text-white" },
];

export function QuoteActions({
  quoteId,
  status,
  publicToken,
  canConvert,
  alreadyConverted,
}: {
  quoteId: string;
  status: QuoteStatus;
  publicToken: string;
  canConvert: boolean;
  alreadyConverted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<QuoteStatus | null>(null);
  const [lostTo, setLostTo] = useState("");
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [copied, setCopied] = useState(false);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/q/${publicToken}` : `/q/${publicToken}`;

  function saveResult() {
    if (!picked) {
      toast.error("เลือกผลก่อน");
      return;
    }
    start(async () => {
      const r = await setQuoteResult(
        quoteId,
        picked,
        picked === "LOST" ? lostTo : null,
        picked === "LOST" && competitorPrice ? Number(competitorPrice) : null,
      );
      if (r.ok) {
        toast.success("บันทึกผลแล้ว");
        setPicked(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function convert() {
    start(async () => {
      const r = await convertToOrder(quoteId);
      // สำเร็จ = redirect ไป /orders/[id] · โค้ดนี้รันเฉพาะตอน error
      if (r && !r.ok) toast.error(r.error ?? "แปลงเป็นออเดอร์ไม่สำเร็จ");
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      toast.success("คัดลอกลิงก์แล้ว");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-3">
      {/* ลิงก์สาธารณะ */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
          <Link2 className="size-4 text-brand-600" /> ลิงก์สำหรับลูกค้า
        </div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-sm text-zinc-600 font-[family-name:var(--font-plex-mono)] truncate"
          />
          <Button variant="outline" onClick={copyLink} className="shrink-0">
            {copied ? <Check className="size-4 text-leaf-600" /> : <Link2 className="size-4" />}
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </Button>
        </div>
        <p className="text-[11px] text-zinc-400 mt-2">ส่งลิงก์นี้ให้ลูกค้าเปิดดูใบเสนอราคาได้ทันที (ไม่ต้องล็อกอิน)</p>
      </div>

      {/* แปลงเป็นออเดอร์ */}
      {!alreadyConverted && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <ArrowRightLeft className="size-4 text-brand-600" /> แปลงเป็นออเดอร์
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                คัดลอกราคาเป็นออเดอร์ พร้อมคำนวณกำไรหักค่าขนส่ง · ตั้งสถานะใบนี้เป็น &quot;ชนะ&quot;
              </p>
            </div>
            <Button onClick={convert} loading={pending} disabled={!canConvert} className="shrink-0">
              แปลงเป็นออเดอร์
            </Button>
          </div>
          {!canConvert && (
            <p className="text-[11px] text-warning mt-2">
              * ต้องผูกลูกค้าในระบบก่อน (ใบนี้เป็นผู้สนใจรายใหม่ — เพิ่มเป็นลูกค้าก่อน)
            </p>
          )}
        </div>
      )}

      {/* บันทึกผล */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold mb-3">บันทึกผล</div>

        {status === "PENDING" && (
          <div className="mb-3 rounded-xl bg-warning/10 border border-warning/30 p-2.5 text-[11px] text-zinc-600 flex items-center gap-2">
            <Clock className="size-4 text-warning shrink-0" /> ใบนี้ยัง &quot;รอผล&quot; — อย่าลืมบันทึกผลเมื่อรู้คำตอบจากลูกค้า
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {RESULT_OPTIONS.map((o) => {
            const Icon = o.icon;
            const on = picked === o.value;
            return (
              <button
                key={o.value}
                type="button"
                data-on={on}
                onClick={() => setPicked(on ? null : o.value)}
                className={cn(
                  "h-16 rounded-xl border border-border bg-surface-2/40 grid place-content-center text-center gap-1 text-xs font-medium text-zinc-600 transition-colors",
                  o.tone,
                )}
              >
                <Icon className="size-4 mx-auto" />
                {o.label}
              </button>
            );
          })}
        </div>

        {picked === "LOST" && (
          <div className="grid sm:grid-cols-2 gap-2 mb-3 animate-fade-in">
            <input
              value={lostTo}
              onChange={(e) => setLostTo(e.target.value)}
              placeholder="แพ้ให้เจ้าไหน (ไม่บังคับ)"
              className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={competitorPrice}
              onChange={(e) => setCompetitorPrice(e.target.value)}
              placeholder="ราคาคู่แข่ง ฿/ล. (ไม่บังคับ)"
              className="h-10 rounded-xl border border-border bg-surface px-3 text-right text-sm tabular-nums"
            />
          </div>
        )}

        <Button onClick={saveResult} loading={pending} disabled={!picked} variant="secondary" className="w-full">
          บันทึกผล
        </Button>
      </div>
    </div>
  );
}

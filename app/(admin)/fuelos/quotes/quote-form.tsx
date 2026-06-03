"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { PRODUCT_LABELS, PRODUCT_ORDER, computeSellPrice, round2 } from "@/lib/fuelos/pricing";
import { formatBaht, formatNumber } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Plus, Trash2, Fuel, AlertTriangle } from "lucide-react";
import { createQuote, type QuoteLineInput } from "./actions";

type Costs = Record<string, number | null>;
type Margins = Record<string, Record<string, { base: number; min: number; transport?: number }>>;
type CustomerOption = { id: string; name: string; zone: string | null };

type Line = {
  key: string;
  productType: string;
  qtyLiters: string;
  salesMargin: string;
};

const DEFAULT_ZONE_MARGIN = 0.45; // fallback กำไรโซน กรณีลูกค้าไม่มีโซน

let lineSeq = 0;
function newLine(product?: string): Line {
  lineSeq += 1;
  return { key: `l${lineSeq}`, productType: product ?? PRODUCT_ORDER[0], qtyLiters: "", salesMargin: "0" };
}

export function QuoteForm({
  customers,
  costs,
  margins,
  prefillCustomerId,
  prefillZone,
  prospectHint,
  conversationId,
}: {
  customers: CustomerOption[];
  costs: Costs;
  margins: Margins;
  prefillCustomerId: string | null;
  prefillZone: string | null;
  prospectHint: string | null;
  conversationId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // ถ้าไม่มีลูกค้าเดิม prefill → เปิดโหมดผู้สนใจรายใหม่
  const [mode, setMode] = useState<"existing" | "prospect">(
    prefillCustomerId ? "existing" : prospectHint ? "prospect" : "existing",
  );
  const [customerId, setCustomerId] = useState<string>(prefillCustomerId ?? "");
  const [prospectName, setProspectName] = useState<string>(prospectHint ?? "");
  const [prospectPhone, setProspectPhone] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  // โซนใช้สำหรับดึงกำไรโซน: ลูกค้าที่เลือก → โซนของเขา
  const selectedZone = useMemo(() => {
    if (mode === "existing" && customerId) {
      return customers.find((c) => c.id === customerId)?.zone ?? prefillZone ?? null;
    }
    return null;
  }, [mode, customerId, customers, prefillZone]);

  // ค่าขนส่ง + กำไรโซน (แยกกัน) — ฝั่งซ้ายเป็นต้นทุนวิ่ง, ฝั่งขวาเป็นกำไรล้วน
  function zoneAddOn(product: string): { transport: number; base: number } {
    const cell = selectedZone ? margins[selectedZone]?.[product] : undefined;
    return { transport: cell?.transport ?? 0, base: cell?.base ?? DEFAULT_ZONE_MARGIN };
  }
  function zoneMinFor(product: string): number {
    if (selectedZone) return margins[selectedZone]?.[product]?.min ?? 0;
    return 0;
  }

  function computeLine(l: Line) {
    const cost = costs[l.productType];
    const qty = Number(l.qtyLiters) || 0;
    const sm = Number(l.salesMargin) || 0;
    const { transport, base } = zoneAddOn(l.productType);
    const zm = round2(transport + base); // โซน = ขนส่ง + กำไร (รวมที่บวกบนทุน)
    if (cost == null) {
      return { cost: null, zoneMargin: zm, finalPrice: null as number | null, lineTotal: 0, belowFloor: false };
    }
    const finalPrice = computeSellPrice({ costPerL: cost, transportCost: transport, zoneMargin: base, salesMargin: sm });
    const lineTotal = round2(finalPrice * qty);
    const belowFloor = finalPrice < cost + transport + zoneMinFor(l.productType);
    return { cost, zoneMargin: zm, finalPrice, lineTotal, belowFloor };
  }

  const subtotal = useMemo(
    () => round2(lines.reduce((s, l) => s + computeLine(l).lineTotal, 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, selectedZone],
  );

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function submit() {
    if (mode === "existing" && !customerId) {
      toast.error("เลือกลูกค้าก่อน");
      return;
    }
    if (mode === "prospect" && !prospectName.trim()) {
      toast.error("ใส่ชื่อผู้สนใจ");
      return;
    }
    const payload: QuoteLineInput[] = lines
      .filter((l) => Number(l.qtyLiters) > 0)
      .map((l) => ({
        productType: l.productType,
        qtyLiters: Number(l.qtyLiters),
        salesMargin: Number(l.salesMargin) || 0,
      }));
    if (payload.length === 0) {
      toast.error("ใส่จำนวนลิตรอย่างน้อย 1 รายการ");
      return;
    }

    start(async () => {
      const r = await createQuote({
        customerId: mode === "existing" ? customerId : null,
        prospectName: mode === "prospect" ? prospectName : null,
        prospectPhone: mode === "prospect" ? prospectPhone : null,
        conversationId,
        notes,
        validUntil: validUntil || null,
        lines: payload,
      });
      // createQuote redirect ถ้าสำเร็จ → โค้ดถัดไปรันเฉพาะตอน error
      if (r && !r.ok) toast.error(r.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-3 items-start">
      {/* ซ้าย: ลูกค้า + รายการสินค้า */}
      <div className="space-y-3">
        {/* เลือกลูกค้า */}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={cn(
                "h-8 px-3 rounded-lg text-sm font-medium",
                mode === "existing" ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-600",
              )}
            >
              ลูกค้าเดิม
            </button>
            <button
              type="button"
              onClick={() => setMode("prospect")}
              className={cn(
                "h-8 px-3 rounded-lg text-sm font-medium",
                mode === "prospect" ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-600",
              )}
            >
              ผู้สนใจรายใหม่
            </button>
          </div>

          {mode === "existing" ? (
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
            >
              <option value="">— เลือกลูกค้า —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.zone ? ` (โซน ${c.zone})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="ชื่อผู้สนใจ / บริษัท"
                className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
              />
              <input
                value={prospectPhone}
                onChange={(e) => setProspectPhone(e.target.value)}
                placeholder="เบอร์โทร (ถ้ามี)"
                inputMode="tel"
                className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
              />
            </div>
          )}
          <p className="text-[11px] text-zinc-400 mt-2">
            {selectedZone
              ? `ราคาดึงจากกำไรโซน ${selectedZone} อัตโนมัติ`
              : "ไม่มีโซน → ใช้กำไรมาตรฐาน คุณปรับเซลล์บวกเพิ่มต่อบรรทัดได้"}
          </p>
        </div>

        {/* รายการสินค้า */}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm">รายการสินค้า</h2>
            <button type="button" onClick={addLine} className="text-sm text-brand-600 inline-flex items-center gap-1">
              <Plus className="size-4" /> เพิ่มบรรทัด
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((l) => {
              const c = computeLine(l);
              return (
                <div key={l.key} className="rounded-xl border border-border bg-surface-2/40 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Fuel className="size-4 text-brand-600 shrink-0" />
                    <select
                      value={l.productType}
                      onChange={(e) => updateLine(l.key, { productType: e.target.value })}
                      className="h-9 flex-1 rounded-lg border border-border bg-surface px-2 text-sm"
                    >
                      {PRODUCT_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {PRODUCT_LABELS[p]}
                        </option>
                      ))}
                    </select>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="size-9 grid place-items-center rounded-lg text-zinc-400 hover:text-danger hover:bg-danger/5"
                        aria-label="ลบบรรทัด"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-zinc-500">จำนวน (ลิตร)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={l.qtyLiters}
                        onChange={(e) => updateLine(l.key, { qtyLiters: e.target.value })}
                        placeholder="0"
                        className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-zinc-500">เซลล์บวกเพิ่ม (฿/ล.)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={l.salesMargin}
                        onChange={(e) => updateLine(l.key, { salesMargin: e.target.value })}
                        className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums"
                      />
                    </label>
                  </div>

                  {/* สรุปต่อบรรทัด live */}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    {c.cost == null ? (
                      <span className="text-warning inline-flex items-center gap-1">
                        <AlertTriangle className="size-3.5" /> ยังไม่มีต้นทุนวันนี้ของสินค้านี้
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        ทุน {formatNumber(c.cost)} + โซน {formatNumber(c.zoneMargin)} ={" "}
                        <span className="font-semibold text-zinc-800 font-[family-name:var(--font-plex-mono)]">
                          {c.finalPrice != null ? formatNumber(c.finalPrice) : "—"}
                        </span>{" "}
                        ฿/ล.
                      </span>
                    )}
                    <span className="font-semibold tabular-nums">{formatBaht(c.lineTotal)}</span>
                  </div>
                  {c.belowFloor && (
                    <div className="mt-1.5 text-[11px] text-danger inline-flex items-center gap-1">
                      <AlertTriangle className="size-3.5" /> ต่ำกว่ากำไรขั้นต่ำของโซน
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* หมายเหตุ */}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <label className="block">
            <span className="text-sm font-semibold">หมายเหตุ (ไม่บังคับ)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="เงื่อนไขเพิ่มเติม / ข้อความถึงลูกค้า"
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {/* ขวา: สรุป + ยืนยัน (sticky) */}
      <div className="rounded-2xl border border-border bg-surface p-4 lg:sticky lg:top-4 space-y-3">
        <h2 className="font-semibold text-sm">สรุปใบเสนอราคา</h2>

        <label className="block">
          <span className="text-[11px] text-zinc-500">ยืนราคาถึงวันที่</span>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          />
        </label>

        <div className="border-t border-border pt-3 flex items-center justify-between">
          <span className="text-sm text-zinc-500">ยอดรวม</span>
          <span className="text-2xl font-bold tabular-nums font-[family-name:var(--font-plex-mono)]">
            {formatBaht(subtotal)}
          </span>
        </div>

        <Button onClick={submit} loading={pending} className="w-full" size="lg">
          ออกใบเสนอราคา
        </Button>
        <p className="text-[11px] text-zinc-400 text-center">
          ระบบจะสร้างเลขที่ใบ + ลิงก์สำหรับส่งให้ลูกค้าเปิดดู
        </p>
      </div>
    </div>
  );
}

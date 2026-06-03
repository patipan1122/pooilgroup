"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { PRODUCT_LABELS, PRODUCT_ORDER, computeSellPrice } from "@/lib/fuelos/pricing";
import { formatNumber } from "@/lib/fuelos/utils/format";
import { saveDepotCosts, saveZoneMargins } from "./actions";
import { Save, Fuel } from "lucide-react";
import type { ProductType } from "@/lib/generated/prisma/enums";

type Costs = Record<string, number | null>;
type Margins = Record<string, Record<string, { base: number; min: number }>>;

export function PriceEditor({
  canEdit,
  depotName,
  initialCosts,
  zones,
  initialMargins,
}: {
  canEdit: boolean;
  depotName: string;
  initialCosts: Costs;
  zones: string[];
  initialMargins: Margins;
}) {
  const [costs, setCosts] = useState<Costs>(initialCosts);
  const [zone, setZone] = useState(zones[0] ?? "");
  const [margins, setMargins] = useState<Margins>(initialMargins);
  const [pending, start] = useTransition();

  const zoneMargin = (p: string) => margins[zone]?.[p]?.base ?? 0.45;
  const zoneMin = (p: string) => margins[zone]?.[p]?.min ?? 0;

  function setCost(p: string, v: string) {
    setCosts((c) => ({ ...c, [p]: v === "" ? null : Number(v) }));
  }
  function setMargin(p: string, field: "base" | "min", v: string) {
    setMargins((m) => ({
      ...m,
      [zone]: { ...m[zone], [p]: { ...(m[zone]?.[p] ?? { base: 0, min: 0 }), [field]: Number(v) } },
    }));
  }

  function saveCosts() {
    start(async () => {
      const rows = PRODUCT_ORDER.filter((p) => costs[p] != null).map((p) => ({ product: p as ProductType, cost: costs[p] as number }));
      await saveDepotCosts(depotName, rows);
      toast.success("บันทึกต้นทุนคลังแล้ว");
    });
  }
  function saveMargins() {
    start(async () => {
      const rows = PRODUCT_ORDER.map((p) => ({ product: p as ProductType, base: zoneMargin(p), min: zoneMin(p) }));
      await saveZoneMargins(zone, rows);
      toast.success(`บันทึกกำไรโซน ${zone} แล้ว`);
    });
  }

  return (
    <div className="space-y-5">
      {/* ราคาขายวันนี้ (ทุกคนเห็น) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">ราคาขายวันนี้</h2>
          {zones.length > 0 && (
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm"
            >
              {zones.map((z) => <option key={z} value={z}>โซน {z}</option>)}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {PRODUCT_ORDER.map((p) => {
            const cost = costs[p];
            const sell = cost == null ? null : computeSellPrice({ costPerL: cost, zoneMargin: zoneMargin(p), salesMargin: 0 });
            return (
              <div key={p} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Fuel className="size-3.5" /> {PRODUCT_LABELS[p]}
                </div>
                {sell == null ? (
                  <div className="text-zinc-400 text-sm mt-2">ยังไม่กรอกราคา</div>
                ) : (
                  <>
                    <div className="text-2xl font-bold tabular-nums mt-1 font-[family-name:var(--font-plex-mono)]">
                      {formatNumber(sell)}
                    </div>
                    <div className="text-[11px] text-zinc-400">฿/ลิตร · ทุน {formatNumber(cost!)}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!canEdit && (
        <p className="text-sm text-zinc-500">* แก้ราคาได้เฉพาะหัวหน้าขายขึ้นไป</p>
      )}

      {canEdit && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* ต้นทุนคลัง */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold mb-3">ต้นทุนคลังวันนี้ ({depotName})</h3>
            <div className="space-y-2">
              {PRODUCT_ORDER.map((p) => (
                <div key={p} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{PRODUCT_LABELS[p]}</span>
                  <input
                    type="number" step="0.01" inputMode="decimal"
                    value={costs[p] ?? ""}
                    onChange={(e) => setCost(p, e.target.value)}
                    className="h-9 w-28 rounded-lg border border-border bg-surface px-3 text-right text-sm tabular-nums"
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
            <Button onClick={saveCosts} loading={pending} className="w-full mt-4">
              <Save className="size-4" /> บันทึกต้นทุน
            </Button>
          </div>

          {/* กำไรโซน */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold mb-3">กำไรโซน {zone} (฿/ลิตร)</h3>
            <div className="space-y-2">
              {PRODUCT_ORDER.map((p) => (
                <div key={p} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex-1">{PRODUCT_LABELS[p]}</span>
                  <input
                    type="number" step="0.01" inputMode="decimal"
                    value={zoneMargin(p)}
                    onChange={(e) => setMargin(p, "base", e.target.value)}
                    className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums"
                    title="กำไรโซน"
                  />
                  <input
                    type="number" step="0.01" inputMode="decimal"
                    value={zoneMin(p)}
                    onChange={(e) => setMargin(p, "min", e.target.value)}
                    className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums text-zinc-500"
                    title="กำไรขั้นต่ำ (กันขาดทุน)"
                  />
                </div>
              ))}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1.5 text-right">กำไรโซน · ขั้นต่ำ</div>
            <Button onClick={saveMargins} loading={pending} variant="secondary" className="w-full mt-3">
              <Save className="size-4" /> บันทึกกำไรโซน {zone}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/fuelos/ui/button";
import { PRODUCT_LABELS, PRODUCT_ORDER, computeSellPrice, landedCost } from "@/lib/fuelos/pricing";
import { formatNumber } from "@/lib/fuelos/utils/format";
import { saveDepotCosts, saveZoneSettings, addDepot, renameDepot, toggleDepot } from "./actions";
import { Save, Fuel, Calculator, Warehouse, MapPin, Plus, Pencil, Check } from "lucide-react";
import type { ProductType } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/fuelos/utils/cn";

type CostsByDepot = Record<string, Record<string, number | null>>;
type Cell = { base: number; min: number; transport: number };
type Margins = Record<string, Record<string, Cell>>;
type Depot = { id: string; name: string };
type DepotFull = { id: string; name: string; isActive: boolean; sort: number };

const num = (v: string) => (v === "" ? null : Number(v));

export function PriceEditor({
  canEdit, depots, allDepots, initialCostsByDepot, zones, initialMargins,
}: {
  canEdit: boolean;
  depots: Depot[];
  allDepots: DepotFull[];
  initialCostsByDepot: CostsByDepot;
  zones: string[];
  initialMargins: Margins;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"daily" | "zone" | "depots">("daily");
  const [costs, setCosts] = useState<CostsByDepot>(initialCostsByDepot);
  const [margins, setMargins] = useState<Margins>(initialMargins);
  const [costDepot, setCostDepot] = useState(depots[0]?.name ?? "PTT");
  const [zone, setZone] = useState(zones[0] ?? "");
  const [pending, start] = useTransition();

  const cellOf = (z: string, p: string): Cell => margins[z]?.[p] ?? { base: 0.45, min: 0.15, transport: 0 };
  const costOf = (depot: string, p: string) => costs[depot]?.[p] ?? null;

  function setCost(depot: string, p: string, v: string) {
    setCosts((c) => ({ ...c, [depot]: { ...(c[depot] ?? {}), [p]: num(v) } }));
  }
  function setCell(z: string, p: string, field: keyof Cell, v: string) {
    setMargins((m) => ({ ...m, [z]: { ...m[z], [p]: { ...cellOf(z, p), [field]: Number(v) } } }));
  }

  function saveCostsForDepot(depot: string) {
    start(async () => {
      const rows = PRODUCT_ORDER.filter((p) => costOf(depot, p) != null).map((p) => ({ product: p as ProductType, cost: costOf(depot, p) as number }));
      await saveDepotCosts(depot, rows);
      toast.success(`บันทึกต้นทุนคลัง ${depot} แล้ว`);
      router.refresh();
    });
  }
  function saveZone() {
    start(async () => {
      const rows = PRODUCT_ORDER.map((p) => ({ product: p as ProductType, transport: cellOf(zone, p).transport, base: cellOf(zone, p).base, min: cellOf(zone, p).min }));
      await saveZoneSettings(zone, rows);
      toast.success(`บันทึกโซน ${zone} แล้ว`);
      router.refresh();
    });
  }

  const TABS = [
    { key: "daily" as const, label: "ราคารายวัน", icon: Fuel },
    { key: "zone" as const, label: "ตั้งค่าโซน (ขนส่ง+กำไร)", icon: MapPin },
    { key: "depots" as const, label: "จัดการคลัง", icon: Warehouse },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const I = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium shrink-0",
                tab === t.key ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600")}>
              <I className="size-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* ===== TAB: ราคารายวัน (ทุกคลัง) + ราคาขายแนะนำต่อโซน ===== */}
      {tab === "daily" && (
        <div className="space-y-5">
          {/* ราคาขายแนะนำต่อโซน (auto-compute) */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h2 className="font-bold flex items-center gap-1.5"><Calculator className="size-4 text-brand-600" /> ราคาขายแนะนำ</h2>
              <div className="flex gap-2">
                <select value={costDepot} onChange={(e) => setCostDepot(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" title="คิดจากต้นทุนคลัง">
                  {depots.map((d) => <option key={d.id} value={d.name}>คลัง {d.name}</option>)}
                </select>
                {zones.length > 0 && (
                  <select value={zone} onChange={(e) => setZone(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm">
                    {zones.map((z) => <option key={z} value={z}>โซน {z}</option>)}
                  </select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {PRODUCT_ORDER.map((p) => {
                const cost = costOf(costDepot, p);
                const c = cellOf(zone, p);
                const sell = cost == null ? null : computeSellPrice({ costPerL: cost, transportCost: c.transport, zoneMargin: c.base, salesMargin: 0 });
                return (
                  <div key={p} className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="text-xs text-zinc-500">{PRODUCT_LABELS[p]}</div>
                    {sell == null ? (
                      <div className="text-zinc-400 text-sm mt-2">ยังไม่กรอกทุน</div>
                    ) : (
                      <>
                        <div className="text-2xl font-bold tabular-nums mt-1 font-[family-name:var(--font-plex-mono)]">{formatNumber(sell)}</div>
                        <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">
                          ทุน {formatNumber(cost!)} + ขนส่ง {formatNumber(c.transport)} + กำไร {formatNumber(c.base)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-400 mt-2">* ราคาแนะนำ (ส่งถึงโซน) · เซลล์ปรับเพิ่ม/ลดตอนคุยลูกค้าได้ที่ใบเสนอราคา</p>
          </div>

          {/* กรอกต้นทุนทุกคลัง (รายวัน) */}
          {canEdit ? (
            <div className="rounded-2xl border border-border bg-surface p-4 overflow-x-auto">
              <h3 className="font-semibold mb-3">ต้นทุนคลังวันนี้ (กรอกได้ทุกคลัง)</h3>
              <table className="w-full text-sm border-separate border-spacing-y-1.5 min-w-[520px]">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="text-left font-medium px-2">สินค้า</th>
                    {depots.map((d) => <th key={d.id} className="font-medium px-2 text-right">{d.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {PRODUCT_ORDER.map((p) => (
                    <tr key={p}>
                      <td className="px-2 font-medium">{PRODUCT_LABELS[p]}</td>
                      {depots.map((d) => (
                        <td key={d.id} className="px-2">
                          <input type="number" step="0.01" inputMode="decimal"
                            value={costOf(d.name, p) ?? ""} onChange={(e) => setCost(d.name, p, e.target.value)}
                            className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums" placeholder="0.00" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2 mt-3">
                {depots.map((d) => (
                  <Button key={d.id} onClick={() => saveCostsForDepot(d.name)} loading={pending} variant="secondary" size="sm">
                    <Save className="size-4" /> บันทึกคลัง {d.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">* แก้ราคาได้เฉพาะหัวหน้าขายขึ้นไป</p>
          )}
        </div>
      )}

      {/* ===== TAB: ตั้งค่าโซน (ขนส่ง + กำไร) ===== */}
      {tab === "zone" && canEdit && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="font-semibold">ตั้งค่าโซน (฿/ลิตร)</h3>
            {zones.length > 0 && (
              <select value={zone} onChange={(e) => setZone(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm">
                {zones.map((z) => <option key={z} value={z}>โซน {z}</option>)}
              </select>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-1.5 min-w-[440px]">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="text-left font-medium px-2">สินค้า</th>
                  <th className="font-medium px-2 text-right">ค่าขนส่ง</th>
                  <th className="font-medium px-2 text-right">กำไรโซน</th>
                  <th className="font-medium px-2 text-right">กำไรขั้นต่ำ</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCT_ORDER.map((p) => {
                  const c = cellOf(zone, p);
                  return (
                    <tr key={p}>
                      <td className="px-2 font-medium">{PRODUCT_LABELS[p]}</td>
                      <td className="px-2"><input type="number" step="0.01" inputMode="decimal" value={c.transport} onChange={(e) => setCell(zone, p, "transport", e.target.value)} className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums" /></td>
                      <td className="px-2"><input type="number" step="0.01" inputMode="decimal" value={c.base} onChange={(e) => setCell(zone, p, "base", e.target.value)} className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums" /></td>
                      <td className="px-2"><input type="number" step="0.01" inputMode="decimal" value={c.min} onChange={(e) => setCell(zone, p, "min", e.target.value)} className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-right text-sm tabular-nums text-zinc-500" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button onClick={saveZone} loading={pending} className="w-full mt-3"><Save className="size-4" /> บันทึกโซน {zone}</Button>
          <p className="text-[11px] text-zinc-400 mt-2">ค่าขนส่ง = ต้นทุนวิ่งคลัง→โซน · กำไรโซน = กำไรล้วน · ขั้นต่ำ = กันขายต่ำกว่าทุน+ขนส่ง</p>
        </div>
      )}

      {/* ===== TAB: จัดการคลัง ===== */}
      {tab === "depots" && canEdit && <DepotManager depots={allDepots} onChange={() => router.refresh()} />}
      {((tab === "zone") || (tab === "depots")) && !canEdit && <p className="text-sm text-zinc-500">* เฉพาะหัวหน้าขายขึ้นไป</p>}
    </div>
  );
}

function DepotManager({ depots, onChange }: { depots: DepotFull[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pending, start] = useTransition();

  function add() {
    start(async () => {
      const r = await addDepot(name);
      if (r.ok) { toast.success("เพิ่มคลังแล้ว"); setName(""); onChange(); }
      else toast.error(r.error ?? "เพิ่มไม่สำเร็จ");
    });
  }
  function saveRename(id: string) {
    start(async () => {
      const r = await renameDepot(id, editName);
      if (r.ok) { toast.success("เปลี่ยนชื่อแล้ว"); setEditId(null); onChange(); }
      else toast.error(r.error ?? "ไม่สำเร็จ");
    });
  }
  function toggle(id: string, active: boolean) {
    start(async () => { await toggleDepot(id, active); onChange(); });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-semibold mb-3">คลังน้ำมัน ({depots.filter((d) => d.isActive).length} ใช้งาน)</h3>
      <div className="space-y-1.5">
        {depots.map((d) => (
          <div key={d.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
            <Warehouse className="size-4 text-zinc-400 shrink-0" />
            {editId === d.id ? (
              <>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" />
                <button onClick={() => saveRename(d.id)} disabled={pending} className="size-8 grid place-items-center rounded-lg bg-brand-600 text-white"><Check className="size-4" /></button>
                <button onClick={() => setEditId(null)} className="text-xs text-zinc-500 px-2">ยกเลิก</button>
              </>
            ) : (
              <>
                <span className={cn("flex-1 text-sm font-medium", !d.isActive && "text-zinc-400 line-through")}>{d.name}</span>
                <button onClick={() => { setEditId(d.id); setEditName(d.name); }} className="size-8 grid place-items-center rounded-lg hover:bg-surface-2 text-zinc-400"><Pencil className="size-3.5" /></button>
                <button onClick={() => toggle(d.id, !d.isActive)} disabled={pending} className={cn("text-xs px-2.5 h-8 rounded-lg border", d.isActive ? "border-border text-zinc-500" : "border-leaf-300 bg-leaf-50 text-leaf-700")}>
                  {d.isActive ? "ปิด" : "เปิด"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อคลังใหม่ (เช่น บางจาก)" className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" />
        <Button onClick={add} loading={pending} size="sm"><Plus className="size-4" /> เพิ่มคลัง</Button>
      </div>
    </div>
  );
}

"use client";

// DC · ฟอร์มสร้างชิปเมนต์ — เลือกใบสั่งซื้อ (pre-fill รายการ) หรือใส่สินค้าเอง,
// โหมด เรือ/รถ, tracking, อัตราแลกเปลี่ยน, ETD/ETA + พรีวิว CBM รวมสด.
// บันทึก → "เตรียมส่ง" → เด้งไปหน้ารายละเอียดชิปเมนต์.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createShipment,
  type CreateShipmentInput,
  type ShipmentLineInput,
} from "@/lib/dc/shipment-actions";
import { PO_STATUS_LABEL } from "@/lib/dc/nav";
import { DcShipmentMode } from "@/lib/generated/prisma/enums";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ProductOpt = { id: string; sku: string; name: string };

export type PoOption = {
  id: string;
  poCode: string;
  title: string | null; // ชื่อเรียกใบ (โชว์ในตัวเลือก dropdown แทนเลขล้วน) · null = ยังไม่ตั้ง
  status: string;
  fxRate: number | null;
  lines: { productId: string; sku: string; name: string; qty: number; cbm: number | null }[];
};

type LineDraft = {
  key: string;
  productId: string;
  qty: string;
  cbm: string;
};

let lineCounter = 0;
function newLine(seed?: Partial<LineDraft>): LineDraft {
  lineCounter += 1;
  return {
    key: `sl-${lineCounter}`,
    productId: seed?.productId ?? "",
    qty: seed?.qty ?? "1",
    cbm: seed?.cbm ?? "",
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number, d = 4): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

export function ShipmentForm({
  poOptions,
  products,
}: {
  poOptions: PoOption[];
  products: ProductOpt[];
}) {
  const router = useRouter();
  const [poId, setPoId] = useState("");
  const [mode, setMode] = useState<DcShipmentMode>(DcShipmentMode.SEA);
  const [trackingNo, setTrackingNo] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // เลือก PO → pre-fill รายการ + fxRate จาก PO (เขียนทับรายการเดิม)
  function onPickPo(id: string) {
    setPoId(id);
    setError(null);
    const po = poOptions.find((p) => p.id === id);
    if (!po) return;
    if (po.fxRate != null) setFxRate(String(po.fxRate));
    if (po.lines.length > 0) {
      lineCounter = 0;
      setLines(
        po.lines.map((l) =>
          newLine({
            productId: l.productId,
            qty: String(l.qty),
            cbm: l.cbm != null ? String(Number(l.cbm.toFixed(6))) : "",
          }),
        ),
      );
    }
  }

  const totalCbm = useMemo(() => {
    let t = 0;
    for (const l of lines) {
      if (!l.productId) continue;
      const c = num(l.cbm);
      if (c > 0) t += c;
    }
    return t;
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const valid = lines.filter((l) => l.productId);
    if (valid.length === 0) {
      setError("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    for (const l of valid) {
      if (num(l.qty) <= 0) {
        setError("จำนวนสินค้าต้องมากกว่า 0");
        return;
      }
    }

    const payloadLines: ShipmentLineInput[] = valid.map((l) => ({
      productId: l.productId,
      qty: num(l.qty),
      cbm: num(l.cbm) > 0 ? num(l.cbm) : null,
    }));

    const payload: CreateShipmentInput = {
      poId: poId || null,
      mode,
      trackingNo: trackingNo || null,
      fxRate: num(fxRate) > 0 ? num(fxRate) : null,
      etd: etd || null,
      eta: eta || null,
      note,
      lines: payloadLines,
    };

    startTransition(async () => {
      const res = await createShipment(payload);
      if (res.ok) {
        router.push(`/dc/office/shipments/${res.id}`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      {/* หัวชิปเมนต์ */}
      <div className="dc-card">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="ใบสั่งซื้อ (ดึงรายการอัตโนมัติ)" optional htmlFor="sh-po" hint="เลือกแล้วจะดึงสินค้า + จำนวน + CBM จากใบสั่งซื้อมาให้">
            <select id="sh-po" value={poId} onChange={(e) => onPickPo(e.target.value)} style={selectStyle}>
              <option value="">— ไม่อิงใบสั่งซื้อ (ใส่เอง) —</option>
              {poOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title ? `${p.title} (${p.poCode})` : p.poCode} · {PO_STATUS_LABEL[p.status] ?? p.status}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ขนส่งโดย" required htmlFor="sh-mode">
            <select
              id="sh-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as DcShipmentMode)}
              style={selectStyle}
            >
              <option value={DcShipmentMode.SEA}>เรือ (SEA)</option>
              <option value={DcShipmentMode.TRUCK}>รถบรรทุก (TRUCK)</option>
            </select>
          </Field>

          <Field label="เลขติดตามพัสดุ (Tracking)" optional htmlFor="sh-track">
            <Input id="sh-track" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="เช่น YT123456789" autoComplete="off" />
          </Field>

          <Field label="อัตราแลกเปลี่ยน (THB ต่อ 1 CNY)" optional htmlFor="sh-fx" hint="ใช้คิดต้นทุนนำเข้าตอนรับเข้า">
            <Input id="sh-fx" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="เช่น 5.05" inputMode="decimal" autoComplete="off" />
          </Field>

          <Field label="วันออกจากต้นทาง (ETD)" optional htmlFor="sh-etd">
            <Input id="sh-etd" type="date" value={etd} onChange={(e) => setEtd(e.target.value)} />
          </Field>

          <Field label="วันถึงไทย (ETA)" optional htmlFor="sh-eta">
            <Input id="sh-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <Field label="โน้ตชิปเมนต์" optional htmlFor="sh-note">
            <Input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ เช่น ตู้คอนเทนเนอร์ / ผู้ขนส่ง" autoComplete="off" />
          </Field>
        </div>
      </div>

      {/* รายการสินค้าในชิปเมนต์ */}
      <div style={{ display: "grid", gap: 12 }}>
        {lines.map((l, idx) => (
          <div key={l.key} className="dc-card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, color: "#52525b" }}>รายการที่ {idx + 1}</div>
              {lines.length > 1 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(l.key)}>
                  <Trash2 size={14} /> ลบ
                </Button>
              )}
            </div>

            <Field label="สินค้า" required htmlFor={`p-${l.key}`}>
              <select id={`p-${l.key}`} value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })} style={selectStyle}>
                <option value="">— เลือกสินค้า —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <Field label="จำนวน" required htmlFor={`q-${l.key}`}>
                <Input id={`q-${l.key}`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="numeric" placeholder="1" />
              </Field>
              <Field label="CBM (m³ ทั้งรายการ)" optional htmlFor={`c-${l.key}`} hint="ปริมาตรรวมของรายการนี้">
                <Input id={`c-${l.key}`} value={l.cbm} onChange={(e) => setLine(l.key, { cbm: e.target.value })} inputMode="decimal" placeholder="0.0000" />
              </Field>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" size="lg" onClick={addLine}>
          <Plus size={18} /> เพิ่มรายการสินค้า
        </Button>
      </div>

      {/* สรุป CBM รวม */}
      <div className="dc-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, color: "#71717a" }}>ปริมาตรรวมทั้งชิปเมนต์</div>
          <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt(totalCbm)} m³</div>
        </div>
      </div>

      {error && <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" size="lg" loading={pending} className="flex-1">
          บันทึกชิปเมนต์
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.push("/dc/office/shipments")} disabled={pending}>
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}

const selectStyle: React.CSSProperties = {
  height: 48,
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--dc-line, #e4e4e7)",
  padding: "0 12px",
  fontSize: 15,
  background: "#fff",
  color: "#18181b",
};

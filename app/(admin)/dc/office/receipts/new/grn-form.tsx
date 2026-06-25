"use client";

// DC · ฟอร์มรับสินค้าเข้าคลัง (GRN) — 2 จังหวะ:
//   จังหวะ 1: บันทึกใบ (createGrn) — เลือกคลัง + อิงชิปเมนต์/PO (pre-fill ปริมาณคาดหวัง)
//             + ใส่จำนวนรับจริง/เสียหายต่อบรรทัด (รับครบ/ขาด/เกิน/เสียได้)
//   จังหวะ 2: หลังบันทึก → ปุ่ม "ลงรับเข้า + คิดต้นทุน" (postGrn) คิดต้นทุนนำเข้า +
//             ตัดสต๊อก + ดัน TRCloud แล้วเด้งไปหน้ารายละเอียดใบ.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { createGrn, postGrn, retryTrcloud, type CreateGrnInput, type GrnLineInput } from "@/lib/dc/grn-actions";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type WarehouseOpt = { id: string; name: string };
type ProductOpt = { id: string; sku: string; name: string };
type SourceLine = { productId: string; sku: string; name: string; qty: number };

export type ShipmentOption = {
  id: string;
  shipmentCode: string;
  statusLabel: string;
  poId: string | null;
  lines: SourceLine[];
};
export type GrnPoOption = {
  id: string;
  poCode: string;
  lines: SourceLine[];
};

type LineDraft = {
  key: string;
  productId: string;
  qtyExpected: string;
  qtyReceived: string;
  qtyDamaged: string;
  note: string;
};

let lineCounter = 0;
function newLine(seed?: Partial<LineDraft>): LineDraft {
  lineCounter += 1;
  return {
    key: `gl-${lineCounter}`,
    productId: seed?.productId ?? "",
    qtyExpected: seed?.qtyExpected ?? "",
    qtyReceived: seed?.qtyReceived ?? "",
    qtyDamaged: seed?.qtyDamaged ?? "",
    note: seed?.note ?? "",
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** สร้างบรรทัดจาก source (ชิปเมนต์/PO): qtyExpected + qtyReceived = ค่าคาดหวัง (แก้ได้). */
function linesFromSource(src: SourceLine[]): LineDraft[] {
  lineCounter = 0;
  if (src.length === 0) return [newLine()];
  return src.map((l) =>
    newLine({
      productId: l.productId,
      qtyExpected: String(l.qty),
      qtyReceived: String(l.qty),
      qtyDamaged: "",
    }),
  );
}

export function GrnForm({
  warehouses,
  shipmentOptions,
  poOptions,
  products,
  initialShipmentId,
  activeWarehouseId,
}: {
  warehouses: WarehouseOpt[];
  shipmentOptions: ShipmentOption[];
  poOptions: GrnPoOption[];
  products: ProductOpt[];
  initialShipmentId: string | null;
  activeWarehouseId: string | null;
}) {
  const router = useRouter();

  const initialShipment = initialShipmentId
    ? shipmentOptions.find((s) => s.id === initialShipmentId) ?? null
    : null;

  const [warehouseId, setWarehouseId] = useState(
    activeWarehouseId ?? (warehouses.length === 1 ? warehouses[0].id : ""),
  );
  const [shipmentId, setShipmentId] = useState(initialShipment?.id ?? "");
  const [poId, setPoId] = useState(initialShipment?.poId ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(
    initialShipment ? linesFromSource(initialShipment.lines) : [newLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // หลังบันทึกใบสำเร็จ → เก็บ grnId ไว้ให้กดลงรับเข้า
  const [createdGrnId, setCreatedGrnId] = useState<string | null>(null);
  const [postMsg, setPostMsg] = useState<string | null>(null);
  // ลงรับเข้าสำเร็จแต่ TRCloud (บัญชี) ยังไม่เข้า → โชว์แถบเหลือง + ปุ่มส่งซ้ำ (ไม่เด้งหน้าเป็นเขียวลอย ๆ)
  const [trcloudPending, setTrcloudPending] = useState<{ reason?: string } | null>(null);

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // เลือกชิปเมนต์ → pre-fill รายการ + auto-เลือก PO ของชิปเมนต์
  function onPickShipment(id: string) {
    setShipmentId(id);
    setError(null);
    const s = shipmentOptions.find((x) => x.id === id);
    if (!s) return;
    if (s.poId) setPoId(s.poId);
    setLines(linesFromSource(s.lines));
  }

  // เลือก PO (กรณีไม่อิงชิปเมนต์) → pre-fill รายการ
  function onPickPo(id: string) {
    setPoId(id);
    setError(null);
    if (shipmentId) return; // อิงชิปเมนต์อยู่แล้ว ไม่เขียนทับ
    const p = poOptions.find((x) => x.id === id);
    if (!p) return;
    setLines(linesFromSource(p.lines));
  }

  const summary = useMemo(() => {
    let recv = 0;
    let dmg = 0;
    for (const l of lines) {
      if (!l.productId) continue;
      recv += num(l.qtyReceived);
      dmg += num(l.qtyDamaged);
    }
    return { recv, dmg };
  }, [lines]);

  const locked = createdGrnId != null; // หลังบันทึกใบแล้ว ล็อกฟอร์ม

  function saveGrn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!warehouseId) {
      setError("กรุณาเลือกคลังปลายทาง");
      return;
    }
    const valid = lines.filter((l) => l.productId);
    if (valid.length === 0) {
      setError("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    for (const l of valid) {
      if (num(l.qtyReceived) < 0 || num(l.qtyDamaged) < 0 || num(l.qtyExpected) < 0) {
        setError("จำนวนต้องไม่ติดลบ");
        return;
      }
    }
    if (valid.every((l) => num(l.qtyReceived) <= 0)) {
      setError("ต้องมีสินค้าที่รับเข้าจริงอย่างน้อย 1 ชิ้น");
      return;
    }

    const payloadLines: GrnLineInput[] = valid.map((l) => ({
      productId: l.productId,
      qtyExpected: num(l.qtyExpected),
      qtyReceived: num(l.qtyReceived),
      qtyDamaged: num(l.qtyDamaged),
      note: l.note,
    }));

    const payload: CreateGrnInput = {
      warehouseId,
      shipmentId: shipmentId || null,
      poId: poId || null,
      note,
      lines: payloadLines,
    };

    startTransition(async () => {
      const res = await createGrn(payload);
      if (res.ok) {
        setCreatedGrnId(res.grnId);
        setPostMsg("บันทึกใบรับสินค้าแล้ว — กด \"ลงรับเข้า + คิดต้นทุน\" เพื่อคิดต้นทุนนำเข้า + ตัดสต๊อก + ส่ง TRCloud");
      } else {
        setError(res.error);
      }
    });
  }

  function doPost() {
    if (!createdGrnId) return;
    setError(null);
    setTrcloudPending(null);
    startTransition(async () => {
      const res = await postGrn(createdGrnId);
      if (res.ok) {
        // ลงคลัง/คิดต้นทุนสำเร็จ — แต่ TRCloud อาจยังไม่เข้า (env ยังไม่ตั้ง / push fail)
        if (!res.trcloud.posted) {
          setPostMsg(null);
          setTrcloudPending({ reason: res.trcloud.reason ?? res.trcloud.error });
          return; // อย่าเด้งหน้า + อย่าโชว์เขียว — ให้ผู้ใช้กดส่งซ้ำก่อน
        }
        router.push(`/dc/office/receipts/${createdGrnId}`);
        router.refresh();
      } else {
        setError(res.error);
        // ยังเด้งไปหน้ารายละเอียดได้ (ใบถูกสร้างแล้ว) — ปล่อยให้ผู้ใช้กดดูเอง
      }
    });
  }

  function retryPush() {
    if (!createdGrnId) return;
    setError(null);
    startTransition(async () => {
      const res = await retryTrcloud(createdGrnId);
      if ("posted" in res && res.ok && res.posted) {
        setTrcloudPending(null);
        router.push(`/dc/office/receipts/${createdGrnId}`);
        router.refresh();
      } else {
        const reason = "reason" in res ? res.reason : res.error;
        setTrcloudPending({ reason });
      }
    });
  }

  return (
    <form onSubmit={saveGrn} style={{ display: "grid", gap: 16 }}>
      {/* หัวใบ */}
      <div className="dc-card">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="คลังปลายทาง" required htmlFor="g-wh">
            <select id="g-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={selectStyle} disabled={locked}>
              <option value="">— เลือกคลัง —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </Field>

          <Field label="ชิปเมนต์ (ดึงปริมาณคาดหวัง)" optional htmlFor="g-ship">
            <select id="g-ship" value={shipmentId} onChange={(e) => onPickShipment(e.target.value)} style={selectStyle} disabled={locked}>
              <option value="">— ไม่อิงชิปเมนต์ —</option>
              {shipmentOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.shipmentCode} · {s.statusLabel}</option>
              ))}
            </select>
          </Field>

          <Field label="ใบสั่งซื้อ (สำหรับคิดต้นทุน)" optional htmlFor="g-po" hint="ใช้ราคา CNY จากใบสั่งซื้อมาคิดต้นทุนนำเข้า">
            <select id="g-po" value={poId} onChange={(e) => onPickPo(e.target.value)} style={selectStyle} disabled={locked}>
              <option value="">— ไม่อิงใบสั่งซื้อ —</option>
              {poOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.poCode}</option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <Field label="โน้ตใบรับสินค้า" optional htmlFor="g-note">
            <Input id="g-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ เช่น สภาพของ / ผู้ส่งมอบ" autoComplete="off" disabled={locked} />
          </Field>
        </div>
      </div>

      {/* รายการสินค้า */}
      <div style={{ display: "grid", gap: 12 }}>
        {lines.map((l, idx) => {
          const expected = num(l.qtyExpected);
          const received = num(l.qtyReceived);
          const diff = received - expected;
          return (
            <div key={l.key} className="dc-card" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, color: "#52525b" }}>รายการที่ {idx + 1}</div>
                {lines.length > 1 && !locked && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(l.key)}>
                    <Trash2 size={14} /> ลบ
                  </Button>
                )}
              </div>

              <Field label="สินค้า" required htmlFor={`p-${l.key}`}>
                <select id={`p-${l.key}`} value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })} style={selectStyle} disabled={locked}>
                  <option value="">— เลือกสินค้า —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                  ))}
                </select>
              </Field>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                <Field label="คาดว่าจะรับ" optional htmlFor={`e-${l.key}`}>
                  <Input id={`e-${l.key}`} value={l.qtyExpected} onChange={(e) => setLine(l.key, { qtyExpected: e.target.value })} inputMode="numeric" placeholder="0" disabled={locked} />
                </Field>
                <Field label="รับจริง" required htmlFor={`r-${l.key}`}>
                  <Input id={`r-${l.key}`} value={l.qtyReceived} onChange={(e) => setLine(l.key, { qtyReceived: e.target.value })} inputMode="numeric" placeholder="0" disabled={locked} />
                </Field>
                <Field label="เสียหาย" optional htmlFor={`d-${l.key}`}>
                  <Input id={`d-${l.key}`} value={l.qtyDamaged} onChange={(e) => setLine(l.key, { qtyDamaged: e.target.value })} inputMode="numeric" placeholder="0" disabled={locked} />
                </Field>
              </div>

              {/* ป้ายเตือน ขาด/เกิน */}
              {l.productId && expected > 0 && diff !== 0 && (
                <div style={{ fontSize: 13, fontWeight: 600, color: diff < 0 ? "var(--color-danger, #dc2626)" : "var(--color-brand-700, #1d4ed8)" }}>
                  {diff < 0 ? `รับขาด ${Math.abs(diff)} ชิ้น` : `รับเกิน ${diff} ชิ้น`}
                </div>
              )}

              <Field label="โน้ตรายการ" optional htmlFor={`n-${l.key}`}>
                <Input id={`n-${l.key}`} value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} placeholder="เช่น กล่องบุบ" autoComplete="off" disabled={locked} />
              </Field>
            </div>
          );
        })}

        {!locked && (
          <Button type="button" variant="outline" size="lg" onClick={addLine}>
            <Plus size={18} /> เพิ่มรายการสินค้า
          </Button>
        )}
      </div>

      {/* สรุป */}
      <div className="dc-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, color: "#71717a" }}>รวมรับเข้าจริง</div>
          <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{summary.recv} ชิ้น</div>
          {summary.dmg > 0 && (
            <div style={{ fontSize: 13, color: "var(--color-danger, #dc2626)", fontVariantNumeric: "tabular-nums" }}>
              เสียหาย {summary.dmg} ชิ้น
            </div>
          )}
        </div>
      </div>

      {error && <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>}
      {postMsg && !trcloudPending && (
        <p style={{ color: "var(--color-success, #16a34a)", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={16} /> {postMsg}
        </p>
      )}
      {trcloudPending && (
        <div
          className="dc-card"
          style={{
            background: "#fef9e7",
            border: "1px solid #f4d77e",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 14, color: "#92660a", fontWeight: 600 }}>
            ลงคลังแล้ว · บัญชี (TRCloud) ยังไม่เข้า — กดส่งซ้ำ
            {trcloudPending.reason && (
              <div style={{ fontSize: 12.5, fontWeight: 500, color: "#a9810f", marginTop: 2 }}>
                เหตุผล: {trcloudPending.reason}
              </div>
            )}
          </div>
          <Button type="button" size="lg" loading={pending} onClick={retryPush}>
            ส่งซ้ำเข้า TRCloud
          </Button>
        </div>
      )}

      {/* ปุ่ม: ก่อนบันทึก = บันทึกใบ · หลังบันทึก = ลงรับเข้า + คิดต้นทุน */}
      {!locked ? (
        <div style={{ display: "flex", gap: 10 }}>
          <Button type="submit" size="lg" loading={pending} className="flex-1">
            บันทึกใบรับสินค้า
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => router.push("/dc/office/receipts")} disabled={pending}>
            ยกเลิก
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            type="button"
            size="lg"
            loading={pending}
            className="flex-1"
            onClick={() => {
              if (window.confirm("ยืนยันลงรับเข้า + คิดต้นทุนนำเข้า + ตัดสต๊อก + ส่ง TRCloud?")) doPost();
            }}
          >
            ลงรับเข้า + คิดต้นทุน
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => createdGrnId && router.push(`/dc/office/receipts/${createdGrnId}`)}
            disabled={pending}
          >
            ดูใบรับสินค้า
          </Button>
        </div>
      )}
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

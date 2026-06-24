"use client";

// DC · ฟอร์มสร้างใบสั่งซื้อจีน — เลือกผู้ขาย/คลัง/อัตราแลกเปลี่ยน + เพิ่มหลายบรรทัด
// (เลือกสินค้า · จำนวน · ราคา CNY · ขนาด L/W/H → พรีวิว CBM สด · อัปรูป) +
// ยอดรวม CNY/THB สด. บันทึก → DRAFT → เด้งไปหน้ารายละเอียดใบ.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, ImageIcon, Loader2 } from "lucide-react";
import { createPo, type CreatePoInput, type PoLineInput } from "@/lib/dc/po-actions";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SupplierOpt = { id: string; name: string };
type WarehouseOpt = { id: string; name: string };
type ProductOpt = { id: string; sku: string; name: string; barcode: string | null; unit: string };

type LineDraft = {
  key: string;
  productId: string;
  qty: string;
  unitPriceCny: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  photoR2Key: string | null;
  photoUrl: string | null;
  uploading: boolean;
  note: string;
};

let lineCounter = 0;
function newLine(): LineDraft {
  lineCounter += 1;
  return {
    key: `ln-${lineCounter}`,
    productId: "",
    qty: "1",
    unitPriceCny: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    photoR2Key: null,
    photoUrl: null,
    uploading: false,
    note: "",
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** ปริมาตร m³/ชิ้น จากขนาด ซม. (เหมือนฝั่ง server) */
function cbm(l: string, w: string, h: string): number | null {
  const L = num(l), W = num(w), H = num(h);
  if (L <= 0 || W <= 0 || H <= 0) return null;
  return (L * W * H) / 1_000_000;
}

function fmt(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

export function PoForm({
  suppliers,
  warehouses,
  products,
}: {
  suppliers: SupplierOpt[];
  warehouses: WarehouseOpt[];
  products: ProductOpt[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [fxRate, setFxRate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fx = useMemo(() => {
    const n = Number(fxRate);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [fxRate]);

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function uploadPhoto(key: string, file: File) {
    setError(null);
    setLine(key, { uploading: true });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dc/upload", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; key: string; url: string }
        | { ok: false; error: string };
      if (data.ok) {
        setLine(key, { photoR2Key: data.key, photoUrl: data.url, uploading: false });
      } else {
        setError(data.error);
        setLine(key, { uploading: false });
      }
    } catch {
      setError("อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง");
      setLine(key, { uploading: false });
    }
  }

  // ── ยอดรวมสด ──
  const totals = useMemo(() => {
    let cny = 0;
    let totalCbm = 0;
    for (const l of lines) {
      if (!l.productId) continue;
      const q = num(l.qty);
      cny += q * num(l.unitPriceCny);
      const c = cbm(l.lengthCm, l.widthCm, l.heightCm);
      if (c != null) totalCbm += q * c;
    }
    return { cny, thb: fx != null ? cny * fx : null, totalCbm };
  }, [lines, fx]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const valid = lines.filter((l) => l.productId);
    if (valid.length === 0) {
      setError("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    if (valid.some((l) => l.uploading)) {
      setError("รอรูปอัปโหลดเสร็จก่อนบันทึก");
      return;
    }
    for (const l of valid) {
      if (num(l.qty) <= 0) {
        setError("จำนวนสินค้าต้องมากกว่า 0");
        return;
      }
      if (num(l.unitPriceCny) <= 0) {
        setError("ราคาต่อหน่วย (CNY) ต้องมากกว่า 0");
        return;
      }
    }

    const payloadLines: PoLineInput[] = valid.map((l) => ({
      productId: l.productId,
      qty: num(l.qty),
      unitPriceCny: num(l.unitPriceCny),
      lengthCm: num(l.lengthCm) > 0 ? num(l.lengthCm) : null,
      widthCm: num(l.widthCm) > 0 ? num(l.widthCm) : null,
      heightCm: num(l.heightCm) > 0 ? num(l.heightCm) : null,
      photoR2Key: l.photoR2Key,
      note: l.note,
    }));

    const payload: CreatePoInput = {
      supplierId: supplierId || null,
      warehouseId: warehouseId || null,
      fxRate: fx,
      note,
      lines: payloadLines,
    };

    startTransition(async () => {
      const res = await createPo(payload);
      if (res.ok) {
        router.push(`/dc/office/purchasing/${res.id}`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      {/* หัวใบ */}
      <div className="dc-card">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="ผู้ขาย" optional htmlFor="po-supplier">
            <select
              id="po-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— ไม่ระบุ —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>

          <Field label="คลังปลายทาง" optional htmlFor="po-wh">
            <select
              id="po-wh"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— ไม่ระบุ —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </Field>

          <Field label="อัตราแลกเปลี่ยน (THB ต่อ 1 CNY)" optional htmlFor="po-fx" hint="ใส่เพื่อคำนวณราคาไทยอัตโนมัติ">
            <Input
              id="po-fx"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              placeholder="เช่น 5.05"
              inputMode="decimal"
              autoComplete="off"
            />
          </Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <Field label="โน้ตใบสั่งซื้อ" optional htmlFor="po-note">
            <Input
              id="po-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="หมายเหตุ เช่น เงื่อนไขส่ง / มัดจำ"
              autoComplete="off"
            />
          </Field>
        </div>
      </div>

      {/* รายการสินค้า */}
      <div style={{ display: "grid", gap: 12 }}>
        {lines.map((l, idx) => {
          const c = cbm(l.lengthCm, l.widthCm, l.heightCm);
          const lineCny = num(l.qty) * num(l.unitPriceCny);
          return (
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
                <select
                  id={`p-${l.key}`}
                  value={l.productId}
                  onChange={(e) => setLine(l.key, { productId: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">— เลือกสินค้า —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                <Field label="จำนวน" required htmlFor={`q-${l.key}`}>
                  <Input
                    id={`q-${l.key}`}
                    value={l.qty}
                    onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    inputMode="numeric"
                    placeholder="1"
                  />
                </Field>
                <Field label="ราคา/หน่วย (CNY)" required htmlFor={`c-${l.key}`}>
                  <Input
                    id={`c-${l.key}`}
                    value={l.unitPriceCny}
                    onChange={(e) => setLine(l.key, { unitPriceCny: e.target.value })}
                    inputMode="decimal"
                    placeholder="¥0.00"
                  />
                </Field>
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, 1fr)" }}>
                <Field label="ยาว (ซม.)" optional htmlFor={`l-${l.key}`}>
                  <Input id={`l-${l.key}`} value={l.lengthCm} onChange={(e) => setLine(l.key, { lengthCm: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
                <Field label="กว้าง (ซม.)" optional htmlFor={`w-${l.key}`}>
                  <Input id={`w-${l.key}`} value={l.widthCm} onChange={(e) => setLine(l.key, { widthCm: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
                <Field label="สูง (ซม.)" optional htmlFor={`h-${l.key}`}>
                  <Input id={`h-${l.key}`} value={l.heightCm} onChange={(e) => setLine(l.key, { heightCm: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
              </div>

              {/* พรีวิวสด: CBM + ยอดบรรทัด */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                <span>CBM/ชิ้น: <b style={{ color: "#18181b" }}>{c != null ? fmt(c, 6) : "—"}</b> m³</span>
                {c != null && num(l.qty) > 0 && (
                  <span>รวม: <b style={{ color: "#18181b" }}>{fmt(c * num(l.qty), 4)}</b> m³</span>
                )}
                <span>ยอด: <b style={{ color: "#18181b" }}>¥{fmt(lineCny)}</b>{fx != null && <> ≈ ฿{fmt(lineCny * fx)}</>}</span>
              </div>

              {/* รูปสินค้า */}
              <PhotoUpload
                line={l}
                onUpload={(file) => uploadPhoto(l.key, file)}
                onClear={() => setLine(l.key, { photoR2Key: null, photoUrl: null })}
              />

              <Field label="โน้ตรายการ" optional htmlFor={`n-${l.key}`}>
                <Input id={`n-${l.key}`} value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} placeholder="เช่น สี/รุ่น" autoComplete="off" />
              </Field>
            </div>
          );
        })}

        <Button type="button" variant="outline" size="lg" onClick={addLine}>
          <Plus size={18} /> เพิ่มรายการสินค้า
        </Button>
      </div>

      {/* สรุปยอดรวม */}
      <div className="dc-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, color: "#71717a" }}>ยอดรวมทั้งใบ</div>
          <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            ¥{fmt(totals.cny)}
          </div>
          {totals.thb != null && (
            <div style={{ fontSize: 14, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
              ≈ ฿{fmt(totals.thb)} (อัตรา {fx})
            </div>
          )}
          <div style={{ fontSize: 13, color: "#71717a", fontVariantNumeric: "tabular-nums" }}>
            ปริมาตรรวม ~{fmt(totals.totalCbm, 4)} m³
          </div>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <Button type="submit" size="lg" loading={pending} className="flex-1">
          บันทึกเป็นร่าง
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.push("/dc/office/purchasing")} disabled={pending}>
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}

function PhotoUpload({
  line,
  onUpload,
  onClear,
}: {
  line: LineDraft;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      {line.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={line.photoUrl}
          alt="รูปสินค้า"
          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "1px solid var(--dc-line, #e4e4e7)" }}
        />
      ) : (
        <div style={{ width: 64, height: 64, borderRadius: 12, border: "1px dashed var(--dc-line, #d4d4d8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a1a1aa" }}>
          <ImageIcon size={22} />
        </div>
      )}
      <Button type="button" variant="outline" size="sm" disabled={line.uploading} onClick={() => inputRef.current?.click()}>
        {line.uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {line.photoUrl ? "เปลี่ยนรูป" : "อัปรูปสินค้า"}
      </Button>
      {line.photoUrl && (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>ลบรูป</Button>
      )}
    </div>
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

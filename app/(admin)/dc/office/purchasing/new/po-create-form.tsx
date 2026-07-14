"use client";

// DC · ฟอร์มสร้างใบสั่งซื้อแบบกะทัดรัด (จีน CNY / ไทย THB) — REUSABLE
// ใช้ได้ 2 ที่:
//   • <PoCreateForm variant="page"> ในหน้า /dc/office/purchasing/new (fallback เต็มจอ)
//   • <PoCreateForm variant="drawer"> ในรางสไลด์ขวาเหนือลิสต์ (CEO #6 — ไม่เด้งออกจากหน้า)
//
// หัวใจ (CEO #7 lean): แต่ละรายการ = "แถวเดียวเตี้ย" — สินค้าเป็น "ปุ่มเล็กกดดู/เลือก"
//   (ไม่ใช่ combobox ก้อนใหญ่) · จำนวน + ราคา inline · รูป/โน้ตเป็นชิปเล็กข้าง ๆ.
//   ฝั่งขวาในจอกว้าง = พรีวิวรูป + รายละเอียดรายการที่เลือก (left-right split).
//
// บันทึก (CEO #8/#10 — ไม่มีด่านอนุมัติ):
//   • ปุ่มหลัก "บันทึก & สั่งเลย"  → createPo({ placeOrder:true })  → ORDERED ทันที
//   • ปุ่มรอง "เก็บร่างไว้ก่อน"     → createPo({ placeOrder:false }) → DRAFT

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ImageIcon,
  Loader2,
  Search,
  Check,
  X,
  StickyNote,
  RefreshCw,
  Send,
  FileText,
} from "lucide-react";
import {
  createPo,
  quickCreateProduct,
  quickCreateSupplier,
  searchProductsForPo,
  type CreatePoInput,
  type PoLineInput,
  type PoProductOption,
  type PoSupplierOption,
} from "@/lib/dc/po-actions";
import { Input } from "@/components/ui/input";
import { PoImageIngest, type OcrAddedLine } from "./po-image-ingest";

type Origin = "CHINA" | "THAI";
type WarehouseOpt = { id: string; name: string };
type Variant = "page" | "drawer";

type LineDraft = {
  key: string;
  productId: string;
  productLabel: string; // ชื่อสินค้าที่เลือก (โชว์ในช่อง)
  qty: string;
  unitPrice: string; // ราคาในสกุลของใบ (CNY จีน / THB ไทย)
  photoR2Key: string | null;
  photoUrl: string | null;
  uploading: boolean;
  note: string;
  showNote: boolean;
};

let lineCounter = 0;
function newLine(): LineDraft {
  lineCounter += 1;
  return {
    key: `ln-${lineCounter}`,
    productId: "",
    productLabel: "",
    qty: "1",
    unitPrice: "",
    photoR2Key: null,
    photoUrl: null,
    uploading: false,
    note: "",
    showNote: false,
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number, d = 2): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

async function uploadFile(
  file: File,
): Promise<{ ok: true; key: string; url: string } | { ok: false; error: string }> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/dc/upload", { method: "POST", body: fd });
    return (await res.json()) as
      | { ok: true; key: string; url: string }
      | { ok: false; error: string };
  } catch {
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง" };
  }
}

export function PoCreateForm({
  origin: originProp,
  warehouses,
  suppliers: initialSuppliers,
  initialFxRate,
  fxDate,
  variant = "page",
  onSaved,
  onCancel,
  onOriginChange,
}: {
  origin: Origin;
  warehouses: WarehouseOpt[];
  suppliers: PoSupplierOption[];
  initialFxRate: number | null;
  fxDate: string | null;
  /** "page" = หน้า /new (เด้งไปรายละเอียดเมื่อบันทึก) · "drawer" = รางสไลด์ในหน้า list */
  variant?: Variant;
  /** เรียกหลังบันทึกสำเร็จ — drawer ใช้ปิดราง + refresh list. ถ้าไม่ส่ง → page เด้งไป /[id] */
  onSaved?: (poId: string) => void;
  /** ปุ่มยกเลิก — drawer ใช้ปิดราง · page ใช้กลับรายการ */
  onCancel?: () => void;
  /** drawer: สลับจีน/ไทยแบบ state (ไม่เปลี่ยน URL) → ขอเรตใหม่จาก parent */
  onOriginChange?: (o: Origin) => void;
}) {
  const router = useRouter();
  const origin = originProp;
  const isChina = origin === "CHINA";
  const sym = isChina ? "¥" : "฿";

  const [suppliers, setSuppliers] = useState<PoSupplierOption[]>(initialSuppliers);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    warehouses.length === 1 ? warehouses[0].id : "",
  );
  const [fxRate, setFxRate] = useState(
    initialFxRate != null ? String(initialFxRate) : "",
  );
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  // R2 key ของรูปต้นฉบับที่ AI สแกน (สะสมข้ามการสแกนหลายรอบ) → ส่งไปเก็บเป็นลิงก์ Drive ตอนบันทึก
  const [sourceImageKeys, setSourceImageKeys] = useState<string[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [activeKey, setActiveKey] = useState<string>(lines[0].key); // รายการที่เลือกดู (right pane)
  const [error, setError] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<"order" | "draft" | null>(null);
  const [pending, startTransition] = useTransition();

  // sync suppliers list ถ้า parent ส่งมาใหม่ (drawer โหลดสด)
  useEffect(() => {
    setSuppliers(initialSuppliers);
  }, [initialSuppliers]);

  // อัปเดต fxRate เมื่อ initialFxRate เปลี่ยน (สลับ origin → เรตใหม่)
  useEffect(() => {
    setFxRate(initialFxRate != null ? String(initialFxRate) : "");
  }, [initialFxRate]);

  const fx = useMemo(() => {
    const n = Number(fxRate);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [fxRate]);

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    const l = newLine();
    setLines((prev) => [...prev, l]);
    setActiveKey(l.key);
  }
  function removeLine(key: string) {
    setLines((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((l) => l.key !== key);
      if (key === activeKey) setActiveKey(next[next.length - 1].key);
      return next;
    });
  }

  // "แนบรูป → อ่านอัตโนมัติ": เติมแถวจากรายการที่ AI อ่าน+คนตรวจแล้ว
  function addOcrLines(added: OcrAddedLine[]) {
    if (added.length === 0) return;
    const drafts: LineDraft[] = added.map((a) => ({
      ...newLine(),
      productId: a.productId,
      productLabel: a.productLabel,
      qty: a.qty,
      unitPrice: a.unitPrice,
      photoR2Key: a.photoR2Key,
      photoUrl: a.photoUrl,
    }));
    setLines((prev) => {
      // ถ้ามีแค่แถวเปล่าแถวเดียว → แทนที่เลย (ไม่ทิ้งแถวว่างไว้บนสุด)
      const blankOnly = prev.length === 1 && !prev[0].productId && !prev[0].unitPrice;
      return blankOnly ? drafts : [...prev, ...drafts];
    });
    setActiveKey(drafts[drafts.length - 1].key);
    setError(null);
  }

  // ── สลับชนิดใบ จีน/ไทย ──
  // page: เปลี่ยน ?origin (server re-fetch เรต) · drawer: ให้ parent จัดการ (state)
  function switchOrigin(next: Origin) {
    if (next === origin) return;
    if (onOriginChange) {
      onOriginChange(next);
    } else {
      router.push(`/dc/office/purchasing/new?origin=${next === "THAI" ? "thai" : "china"}`);
    }
  }

  async function uploadLinePhoto(key: string, file: File) {
    setError(null);
    setLine(key, { uploading: true });
    const data = await uploadFile(file);
    if (data.ok) {
      setLine(key, { photoR2Key: data.key, photoUrl: data.url, uploading: false });
    } else {
      setError(data.error);
      setLine(key, { uploading: false });
    }
  }

  // ── ยอดรวมสด ──
  const totals = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      if (!l.productId) continue;
      sum += num(l.qty) * num(l.unitPrice);
    }
    return { sum, thb: isChina && fx != null ? sum * fx : null };
  }, [lines, fx, isChina]);

  const activeLine = lines.find((l) => l.key === activeKey) ?? lines[0];

  // ── บันทึก: placeOrder=true (สั่งเลย) / false (ร่าง) ──
  function save(placeOrder: boolean) {
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
      if (num(l.unitPrice) <= 0) {
        setError(`ราคาต่อหน่วย (${sym}) ต้องมากกว่า 0`);
        return;
      }
    }

    const payloadLines: PoLineInput[] = valid.map((l) => ({
      productId: l.productId,
      qty: num(l.qty),
      unitPriceCny: num(l.unitPrice), // field = ราคาในสกุลของใบ (CNY จีน / THB ไทย)
      photoR2Key: l.photoR2Key,
      note: l.note.trim() || null,
    }));

    const payload: CreatePoInput = {
      origin,
      supplierId: supplierId || null,
      warehouseId: warehouseId || null,
      fxRate: isChina ? fx : null, // ไทยไม่มีเรต
      note: note.trim() || null,
      title: title.trim() || null,
      lines: payloadLines,
      placeOrder,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
    };

    setPendingMode(placeOrder ? "order" : "draft");
    startTransition(async () => {
      const res = await createPo(payload);
      setPendingMode(null);
      if (res.ok) {
        if (onSaved) {
          onSaved(res.id);
        } else {
          router.push(`/dc/office/purchasing/${res.id}`);
          router.refresh();
        }
      } else {
        setError(res.error);
      }
    });
  }

  const cardStyle: React.CSSProperties =
    variant === "drawer"
      ? { background: "#fff", border: "1px solid var(--dc-line, #e7ebf2)", borderRadius: 14, padding: 14, display: "grid", gap: 12 }
      : {};
  const cardClass = variant === "drawer" ? "" : "dc-card";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ── หัวใบ: ชนิด + ผู้ขาย + คลัง + เรต ── */}
      <div className={cardClass} style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <OriginToggle origin={origin} onSwitch={switchOrigin} disabled={pending} />

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
          }}
        >
          <SupplierField
            suppliers={suppliers}
            value={supplierId}
            onChange={setSupplierId}
            onCreated={(s) => {
              setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name, "th")));
              setSupplierId(s.id);
            }}
            onError={setError}
          />

          <label style={fieldWrap}>
            <span style={labelStyle}>คลังปลายทาง <span style={optStyle}>(ไม่บังคับ)</span></span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={selectStyle}>
              <option value="">— ไม่ระบุ —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>

          {isChina && (
            <label style={fieldWrap}>
              <span style={labelStyle}>
                เรต (฿ ต่อ 1 ¥)
                {fxDate && <span style={optStyle}>วันนี้ {fxDate}</span>}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Input
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder="เช่น 4.95"
                  inputMode="decimal"
                  autoComplete="off"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  title="ใช้เรตวันนี้"
                  onClick={() => initialFxRate != null && setFxRate(String(initialFxRate))}
                  disabled={initialFxRate == null}
                  style={iconBtnStyle}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </label>
          )}
        </div>
      </div>

      {/* ── รายการสินค้า (ซ้าย: แถวเตี้ย | ขวา: พรีวิวรายการที่เลือก) ── */}
      <div
        className={cardClass}
        style={{
          ...cardStyle,
          display: "grid",
          gap: 0,
          // left-right split เฉพาะจอกว้าง (>720px) — มือถือ stack
          gridTemplateColumns: "1fr",
        }}
      >
        {/* แนบรูปออเดอร์ 1688 → AI อ่าน → คนตรวจ → เติมแถวอัตโนมัติ */}
        <div style={{ marginBottom: 12 }}>
          <PoImageIngest
            origin={origin}
            sym={sym}
            onAddLines={addOcrLines}
            onSourceImages={(keys) =>
              setSourceImageKeys((prev) => [...new Set([...prev, ...keys])])
            }
          />
        </div>

        <div className="dc-poline2-grid">
          {/* ซ้าย: ลิสต์แถวเตี้ย */}
          <div style={{ display: "grid", gap: 2, alignContent: "start" }}>
            {/* หัวคอลัมน์ */}
            <div style={{ ...lineRow, paddingBottom: 6, borderBottom: "1.5px solid var(--dc-line-strong, #d4dae4)" }}>
              <span style={colHead}>สินค้า</span>
              <span style={{ ...colHead, textAlign: "center", width: 56 }}>จำนวน</span>
              <span style={{ ...colHead, textAlign: "right", width: 92 }}>ราคา ({sym})</span>
              <span style={{ width: 28 }} />
            </div>

            {lines.map((l) => (
              <CompactLineRow
                key={l.key}
                line={l}
                sym={sym}
                active={l.key === activeKey}
                canRemove={lines.length > 1}
                onSelect={() => setActiveKey(l.key)}
                onPatch={(patch) => setLine(l.key, patch)}
                onRemove={() => removeLine(l.key)}
                onError={setError}
              />
            ))}

            <button type="button" onClick={addLine} style={addRowBtn}>
              <Plus size={16} /> เพิ่มรายการ
            </button>
          </div>

          {/* ขวา: พรีวิว/รายละเอียดรายการที่เลือก (รูป + โน้ต) */}
          <LineDetailPane
            line={activeLine}
            sym={sym}
            onPatch={(patch) => activeLine && setLine(activeLine.key, patch)}
            onUploadPhoto={(file) => activeLine && uploadLinePhoto(activeLine.key, file)}
          />
        </div>
      </div>

      {/* ── ชื่อเรียกใบ + โน้ตใบ + ยอดรวม ── */}
      <div className={cardClass} style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <label style={fieldWrap}>
          <span style={labelStyle}>ชื่อเรียกใบนี้ <span style={optStyle}>(ไม่บังคับ · ช่วยให้หาใบง่ายกว่าเลข PO)</span></span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="เช่น ตุ๊กตาหมีล็อตสงกรานต์ / อะไหล่ตู้คีบรอบ 2"
            autoComplete="off"
          />
        </label>
        <label style={fieldWrap}>
          <span style={labelStyle}>โน้ตใบสั่งซื้อ <span style={optStyle}>(ไม่บังคับ)</span></span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น เงื่อนไขส่ง / มัดจำ"
            autoComplete="off"
          />
        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 8,
            borderTop: "1px solid var(--dc-line, #e7ebf2)",
            paddingTop: 10,
          }}
        >
          <span style={{ fontSize: 14, color: "var(--dc-muted, #5b6676)" }}>ยอดรวมทั้งใบ</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 820, fontVariantNumeric: "tabular-nums", color: "var(--dc-ink, #1c2533)" }}>
              {sym}{fmt(totals.sum)}
            </div>
            {totals.thb != null && (
              <div style={{ fontSize: 13.5, color: "var(--dc-muted, #5b6676)", fontVariantNumeric: "tabular-nums" }}>
                ≈ ฿{fmt(totals.thb)} (เรต {fmt(fx ?? 0, 4)})
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600, margin: 0 }}>{error}</p>
      )}

      {/* ── ปุ่มบันทึก (CEO #8): หลัก = "บันทึก & สั่งเลย" · รอง = "เก็บร่างไว้ก่อน" ── */}
      <div style={{ display: "grid", gap: 8 }}>
        <button
          type="button"
          className="dc-btn-xl"
          disabled={pending}
          onClick={() => save(true)}
          style={{ width: "100%", fontSize: 16 }}
        >
          {pending && pendingMode === "order" ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={17} />
          )}
          บันทึก &amp; สั่งเลย
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="dc-btn-xl dc-btn-xl--ghost"
            disabled={pending}
            onClick={() => save(false)}
            style={{ flex: 1 }}
          >
            {pending && pendingMode === "draft" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileText size={15} />
            )}
            เก็บร่างไว้ก่อน
          </button>
          <button
            type="button"
            className="dc-btn-xl dc-btn-xl--ghost"
            onClick={() => (onCancel ? onCancel() : router.push("/dc/office/purchasing"))}
            disabled={pending}
            style={{ flex: "0 0 auto", color: "var(--dc-muted, #5b6676)" }}
          >
            ยกเลิก
          </button>
        </div>
      </div>

      {/* left-right split เฉพาะจอกว้าง */}
      <style jsx>{`
        .dc-poline2-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 760px) {
          .dc-poline2-grid {
            grid-template-columns: minmax(0, 1.5fr) minmax(220px, 0.9fr);
            gap: 18px;
          }
        }
      `}</style>
    </div>
  );
}

/* ───────────────────────── Origin toggle ───────────────────────── */
function OriginToggle({
  origin,
  onSwitch,
  disabled,
}: {
  origin: Origin;
  onSwitch: (o: Origin) => void;
  disabled: boolean;
}) {
  const opts: { value: Origin; label: string; sub: string }[] = [
    { value: "CHINA", label: "จีน", sub: "หยวน ¥" },
    { value: "THAI", label: "ไทย", sub: "บาท ฿" },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 6, background: "var(--color-brand-50, #eef3fb)", padding: 4, borderRadius: 12, border: "1px solid var(--dc-line, #e7ebf2)", width: "fit-content" }}>
      {opts.map((o) => {
        const active = o.value === origin;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onSwitch(o.value)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 84,
              padding: "6px 14px",
              borderRadius: 9,
              border: "none",
              cursor: disabled ? "default" : "pointer",
              background: active ? "#fff" : "transparent",
              color: active ? "var(--dc-blue-strong, #1d4ed8)" : "var(--dc-muted, #5b6676)",
              fontWeight: active ? 800 : 600,
              boxShadow: active ? "var(--dc-shadow-sm, 0 1px 3px rgba(28,48,90,.1))" : "none",
              lineHeight: 1.2,
            }}
          >
            <span style={{ fontSize: 14.5 }}>{o.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Supplier field (+ inline create) ───────────────────────── */
function SupplierField({
  suppliers,
  value,
  onChange,
  onCreated,
  onError,
}: {
  suppliers: PoSupplierOption[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (s: PoSupplierOption) => void;
  onError: (e: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [wechat, setWechat] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    onError(null);
    const res = await quickCreateSupplier({
      name: name.trim(),
      contact: contact.trim() || null,
      wechat: wechat.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      onCreated(res.supplier);
      setName(""); setContact(""); setWechat("");
      setAdding(false);
    } else {
      onError(res.error);
    }
  }

  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>ผู้ขาย <span style={optStyle}>(ไม่บังคับ)</span></span>
      {!adding ? (
        <div style={{ display: "flex", gap: 6 }}>
          <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
            <option value="">— ไม่ระบุ —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setAdding(true)} style={iconBtnStyle} title="เพิ่มผู้ขายใหม่">
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <div style={inlinePanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dc-ink, #1c2533)" }}>เพิ่มผู้ขายใหม่</span>
            <button type="button" onClick={() => setAdding(false)} style={ghostIconBtn}><X size={15} /></button>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อผู้ขาย *" autoFocus autoComplete="off" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="ติดต่อ (เบอร์/อีเมล)" autoComplete="off" />
              <Input value={wechat} onChange={(e) => setWechat(e.target.value)} placeholder="WeChat" autoComplete="off" />
            </div>
            <button type="button" onClick={save} disabled={!name.trim() || saving} style={savePanelBtn}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} บันทึกผู้ขาย
            </button>
          </div>
        </div>
      )}
    </label>
  );
}

/* ───────────────────────── Compact line row (CEO #7 — แถวเดียวเตี้ย) ─────────────────────────
   สินค้า = ปุ่มเล็กกดเปิด picker · จำนวน + ราคา inline · ✕
   มี indicator เล็ก ๆ (รูป 📷 / โน้ต) ถ้ามี — แต่ไม่ดันความสูง */
function CompactLineRow({
  line,
  sym,
  active,
  canRemove,
  onSelect,
  onPatch,
  onRemove,
  onError,
}: {
  line: LineDraft;
  sym: string;
  active: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  onError: (e: string | null) => void;
}) {
  return (
    <div
      style={{
        ...lineRow,
        padding: "5px 4px",
        borderRadius: 9,
        background: active ? "var(--color-brand-50, #eef3fb)" : "transparent",
        boxShadow: active ? "inset 0 0 0 1px var(--color-brand-200, #c9d8f0)" : "none",
      }}
      onClick={onSelect}
    >
      {/* ช่องสินค้า = ปุ่มเล็ก (กดดู/เลือก) */}
      <ProductPickerButton
        value={line.productId}
        label={line.productLabel}
        hasPhoto={!!line.photoUrl}
        hasNote={!!line.note}
        onSelect={(p) => onPatch({ productId: p.id, productLabel: `${p.name} · ${p.sku}` })}
        onError={onError}
      />

      {/* จำนวน */}
      <input
        value={line.qty}
        onChange={(e) => onPatch({ qty: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        inputMode="numeric"
        placeholder="1"
        style={{ ...cellInputSm, width: 56, textAlign: "center" }}
        aria-label="จำนวน"
      />

      {/* ราคา/หน่วย */}
      <input
        value={line.unitPrice}
        onChange={(e) => onPatch({ unitPrice: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        inputMode="decimal"
        placeholder={`${sym}0`}
        style={{ ...cellInputSm, width: 92, textAlign: "right" }}
        aria-label={`ราคาต่อหน่วย ${sym}`}
      />

      {/* ลบแถว */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        disabled={!canRemove}
        style={{ ...ghostIconBtn, height: 30, width: 28, opacity: canRemove ? 1 : 0.3, justifySelf: "center" }}
        title="ลบรายการ"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/* ขวา: พรีวิวรายการที่เลือก (รูปที่ผู้ขายส่งมา + โน้ต) — left-right split ของ #7 */
function LineDetailPane({
  line,
  sym,
  onPatch,
  onUploadPhoto,
}: {
  line: LineDraft | undefined;
  sym: string;
  onPatch: (patch: Partial<LineDraft>) => void;
  onUploadPhoto: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!line) return null;

  const priceN = num(line.unitPrice);
  const qtyN = num(line.qty);

  return (
    <div
      style={{
        background: "var(--color-brand-50, #f7faff)",
        border: "1px solid var(--dc-line, #e7ebf2)",
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 10,
        alignContent: "start",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--dc-muted, #5b6676)" }}>
        รายการที่เลือก
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1c2533)", minHeight: 20 }}>
        {line.productId ? line.productLabel : "— ยังไม่เลือกสินค้า —"}
      </div>

      {/* รูปที่ผู้ขายจีนส่งมา */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadPhoto(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={line.uploading}
        style={{
          width: "100%",
          aspectRatio: "4 / 3",
          maxHeight: 150,
          borderRadius: 10,
          border: "1px dashed var(--color-brand-200, #c9d8f0)",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor: "pointer",
          color: "var(--dc-subtle, #8a94a3)",
          gap: 6,
          fontSize: 13,
        }}
        title="แนบรูปที่ผู้ขายส่งมา"
      >
        {line.uploading ? (
          <Loader2 size={18} className="animate-spin" />
        ) : line.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.photoUrl} alt="รูปสินค้า" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <>
            <ImageIcon size={16} /> แนบรูป
          </>
        )}
      </button>
      {line.photoUrl && (
        <button
          type="button"
          onClick={() => onPatch({ photoR2Key: null, photoUrl: null })}
          style={{ ...ghostMiniBtn, justifySelf: "start" }}
        >
          <X size={12} /> ลบรูป
        </button>
      )}

      {/* โน้ตต่อรายการ */}
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dc-muted, #5b6676)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <StickyNote size={13} /> โน้ต (เช่น สี/รุ่น)
        </span>
        <input
          value={line.note}
          onChange={(e) => onPatch({ note: e.target.value })}
          placeholder="ไม่บังคับ"
          style={cellInput}
          autoComplete="off"
        />
      </label>

      {line.productId && priceN > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--dc-muted, #5b6676)", borderTop: "1px solid var(--dc-line, #e7ebf2)", paddingTop: 8, fontVariantNumeric: "tabular-nums" }}>
          รวมรายการนี้: <b style={{ color: "var(--dc-ink, #1c2533)" }}>{sym}{fmt(qtyN * priceN)}</b>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Product picker button (เล็ก) + popover (search + inline create) ───────────────────────── */
function ProductPickerButton({
  value,
  label,
  hasPhoto,
  hasNote,
  onSelect,
  onError,
}: {
  value: string;
  label: string;
  hasPhoto: boolean;
  hasNote: boolean;
  onSelect: (p: PoProductOption) => void;
  onError: (e: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PoProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const runSearch = useCallback((term: string) => {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await searchProductsForPo({ q: term });
        setResults(rows);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, []);

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true);
    setCreating(false);
    if (results.length === 0) runSearch("");
  }

  function pick(p: PoProductOption) {
    onSelect(p);
    setOpen(false);
    setQ("");
  }

  const shortName = value ? label.split(" · ")[0] : "";

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0, flex: 1 }}>
      <button
        type="button"
        onClick={openPicker}
        style={{
          ...cellInputSm,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: value ? "var(--dc-ink, #1c2533)" : "var(--dc-blue-strong, #1d4ed8)",
          fontWeight: value ? 600 : 600,
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflow: "hidden",
          background: value ? "#fff" : "var(--color-brand-50, #eef3fb)",
          border: value ? "1px solid var(--dc-line, #e7ebf2)" : "1px dashed var(--color-brand-200, #c9d8f0)",
        }}
        title={value ? label : "เลือกสินค้า"}
      >
        <Search size={14} style={{ flex: "0 0 auto", opacity: 0.65 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? shortName : "เลือกสินค้า"}
        </span>
        {hasPhoto && <ImageIcon size={12} style={{ flex: "0 0 auto", opacity: 0.6 }} />}
        {hasNote && <StickyNote size={12} style={{ flex: "0 0 auto", opacity: 0.6 }} />}
      </button>

      {open && (
        <div style={popover} onClick={(e) => e.stopPropagation()}>
          {!creating ? (
            <>
              <div style={{ padding: 8, borderBottom: "1px solid var(--dc-line, #e7ebf2)" }}>
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    runSearch(e.target.value);
                  }}
                  placeholder="พิมพ์ชื่อ / SKU / บาร์โค้ด…"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {searching && (
                  <div style={popMsg}><Loader2 size={14} className="animate-spin" /> กำลังค้น…</div>
                )}
                {!searching && results.length === 0 && (
                  <div style={popMsg}>ไม่พบสินค้า — สร้างใหม่ด้านล่าง</div>
                )}
                {!searching &&
                  results.map((p) => (
                    <button key={p.id} type="button" onClick={() => pick(p)} style={popRow}>
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.name} style={popThumbImg} />
                      ) : (
                        <span style={popThumbPlaceholder}>
                          <ImageIcon size={14} color="var(--dc-subtle, #8a94a3)" />
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "var(--dc-ink, #1c2533)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <span style={{ fontSize: 12, color: "var(--dc-subtle, #8a94a3)", flex: "0 0 auto" }}>{p.sku}</span>
                    </button>
                  ))}
              </div>
              <button type="button" onClick={() => setCreating(true)} style={createNewBtn}>
                <Plus size={15} /> สร้างสินค้าใหม่
              </button>
            </>
          ) : (
            <InlineCreateProduct
              onCancel={() => setCreating(false)}
              onCreated={(p) => {
                pick(p);
                setCreating(false);
              }}
              onError={onError}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Inline create product (CEO #1 — มินิมอล) ─────────────────────────
   ถามแค่ "ชื่อสินค้า" + toggle เพื่อขาย/ไม่เพื่อขาย (SALE/SPARE) เท่านั้น
   ส่ง quickCreateProduct({ name, type }) — ไม่มีหมวด/รูป (อยู่ในฟอร์มสินค้าเต็ม)
   ถ้าชื่อซ้ำ → server คืน {ok:false,error} → โชว์ข้อความแดงใต้ช่องชื่อ ให้ผู้ใช้ไปเลือกจากลิสต์แทน */
function InlineCreateProduct({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: (p: PoProductOption) => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"SALE" | "SPARE">("SALE");
  const [saving, setSaving] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setDupError(null);
    onError(null);
    const res = await quickCreateProduct({
      name: name.trim(),
      type,
    });
    setSaving(false);
    if (res.ok) {
      // สินค้าที่เพิ่งสร้างยังไม่มีรูป → imageUrl: null
      onCreated({ id: res.product.id, name: res.product.name, sku: res.product.sku, imageUrl: null });
    } else {
      // โชว์ inline ใต้ช่องชื่อ (เช่น ชื่อซ้ำ) — ไม่ดันขึ้น error ก้อนใหญ่ของฟอร์ม
      setDupError(res.error);
    }
  }

  return (
    <div style={{ padding: 10, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dc-ink, #1c2533)" }}>สร้างสินค้าใหม่</span>
        <button type="button" onClick={onCancel} style={ghostIconBtn}><X size={15} /></button>
      </div>

      <div style={{ display: "grid", gap: 5 }}>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (dupError) setDupError(null);
          }}
          placeholder="ชื่อสินค้า *"
          autoFocus
          autoComplete="off"
        />
        {dupError && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-danger, #dc2626)", lineHeight: 1.35 }}>
            {dupError}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {(["SALE", "SPARE"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: type === t ? 700 : 600,
              cursor: "pointer",
              border: `1.5px solid ${type === t ? "var(--color-brand-600, #2563eb)" : "var(--dc-line, #e7ebf2)"}`,
              background: type === t ? "var(--color-brand-50, #eef3fb)" : "#fff",
              color: type === t ? "var(--dc-blue-strong, #1d4ed8)" : "var(--dc-muted, #5b6676)",
            }}
          >
            {t === "SALE" ? "เพื่อขาย" : "ไม่เพื่อขาย"}
          </button>
        ))}
      </div>

      <button type="button" onClick={save} disabled={!name.trim() || saving} style={savePanelBtn}>
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} สร้าง &amp; เลือกเข้าแถว
      </button>
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const lineRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
};

const fieldWrap: React.CSSProperties = { display: "grid", gap: 5 };
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--dc-ink, #1c2533)",
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const optStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--dc-subtle, #8a94a3)" };
const colHead: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--dc-muted, #5b6676)", flex: 1 };

const selectStyle: React.CSSProperties = {
  height: 44,
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  padding: "0 10px",
  fontSize: 16, // ≥16 กัน iOS Safari zoom ตอนโฟกัส
  background: "#fff",
  color: "var(--dc-ink, #1c2533)",
};

const cellInput: React.CSSProperties = {
  height: 44,
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  padding: "0 10px",
  fontSize: 16, // ≥16 กัน iOS zoom
  background: "#fff",
  color: "var(--dc-ink, #1c2533)",
  fontVariantNumeric: "tabular-nums",
  outline: "none",
};

// แถวรายการ = เตี้ยกว่าให้ดู lean · แต่ font ≥16 กัน iOS zoom + สูงพอนิ้วกด
const cellInputSm: React.CSSProperties = {
  height: 40,
  borderRadius: 8,
  border: "1px solid var(--dc-line, #e7ebf2)",
  padding: "0 8px",
  fontSize: 16,
  background: "#fff",
  color: "var(--dc-ink, #1c2533)",
  fontVariantNumeric: "tabular-nums",
  outline: "none",
};

const iconBtnStyle: React.CSSProperties = {
  flex: "0 0 auto",
  height: 42,
  width: 42,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--color-brand-200, #c9d8f0)",
  background: "var(--color-brand-50, #eef3fb)",
  color: "var(--dc-blue-strong, #1d4ed8)",
  cursor: "pointer",
};

const ghostIconBtn: React.CSSProperties = {
  height: 32,
  width: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--dc-muted, #5b6676)",
  cursor: "pointer",
};

const addRowBtn: React.CSSProperties = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 38,
  borderRadius: 9,
  border: "1.5px dashed var(--color-brand-200, #c9d8f0)",
  background: "var(--color-brand-50, #eef3fb)",
  color: "var(--dc-blue-strong, #1d4ed8)",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostMiniBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 26,
  padding: "0 8px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--dc-subtle, #8a94a3)",
  fontSize: 12,
  cursor: "pointer",
};

const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  zIndex: 60,
  width: 320,
  maxWidth: "min(320px, 86vw)",
  background: "#fff",
  borderRadius: 12,
  border: "1px solid var(--dc-line-strong, #d4dae4)",
  boxShadow: "var(--dc-shadow-lg, 0 12px 34px rgba(30,60,120,.13))",
  overflow: "hidden",
};

const popRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  padding: "9px 12px",
  border: "none",
  borderBottom: "1px solid var(--dc-line, #f0f3f8)",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
};

// รูปย่อในแถวผลค้นหา (#2) — ~32px มุมมน · objectFit cover
const popThumbImg: React.CSSProperties = {
  flex: "0 0 auto",
  width: 32,
  height: 32,
  borderRadius: 7,
  objectFit: "cover",
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
};
const popThumbPlaceholder: React.CSSProperties = {
  flex: "0 0 auto",
  width: 32,
  height: 32,
  borderRadius: 7,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "var(--color-brand-50, #f7faff)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const popMsg: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px",
  fontSize: 13,
  color: "var(--dc-subtle, #8a94a3)",
};

const createNewBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  padding: "10px",
  border: "none",
  borderTop: "1px solid var(--dc-line, #e7ebf2)",
  background: "var(--color-brand-50, #eef3fb)",
  color: "var(--dc-blue-strong, #1d4ed8)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const inlinePanel: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--color-brand-200, #c9d8f0)",
  background: "var(--color-brand-50, #f7faff)",
};

const savePanelBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 40,
  borderRadius: 10,
  border: "none",
  background: "var(--color-brand-600, #2563eb)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

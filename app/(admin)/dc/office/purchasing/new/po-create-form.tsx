"use client";

// DC · ฟอร์มสร้างใบสั่งซื้อแบบกะทัดรัด (จีน CNY / ไทย THB)
// หัวใจ: แต่ละรายการสินค้า = "แถวเดียว" (dc-poline: สินค้า | จำนวน | ราคา | ✕)
//   - ช่องสินค้า = combobox ค้นหา (searchProductsForPo debounce) หรือ "สร้างสินค้าใหม่" ตรงนี้เลย
//   - ผู้ขาย/สินค้า สร้างใหม่ inline ได้ทันที (quickCreateSupplier / quickCreateProduct)
//   - รูปต่อรายการ (รูปที่ผู้ขายจีนส่งมา) + โน้ต (พับเก็บได้)
//   - ไม่มี กว้าง/ยาว/สูง ที่นี่ — ขนาดอยู่ที่ "กล่อง" หน้ารายละเอียดทีหลัง
// ยอดรวมสด: ¥ (จีน) หรือ ฿ (ไทย) · จีน+เรต โชว์ ≈฿. บันทึก → DRAFT → เด้งหน้ารายละเอียด.

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
  Upload,
  ImageIcon,
  Loader2,
  Search,
  Check,
  X,
  StickyNote,
  RefreshCw,
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

type Origin = "CHINA" | "THAI";
type WarehouseOpt = { id: string; name: string };

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
  origin,
  warehouses,
  suppliers: initialSuppliers,
  initialFxRate,
  fxDate,
}: {
  origin: Origin;
  warehouses: WarehouseOpt[];
  suppliers: PoSupplierOption[];
  initialFxRate: number | null;
  fxDate: string | null;
}) {
  const router = useRouter();
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
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // อัปเดต fxRate เมื่อสลับ origin (server เปลี่ยน initialFxRate)
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
    setLines((prev) => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // ── สลับชนิดใบ จีน/ไทย → เปลี่ยน ?origin (server re-fetch เรต) ──
  function switchOrigin(next: Origin) {
    if (next === origin) return;
    router.push(`/dc/office/purchasing/new?origin=${next === "THAI" ? "thai" : "china"}`);
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
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      {/* ── หัวใบ: ชนิด + ผู้ขาย + คลัง + เรต ── */}
      <div className="dc-card" style={{ display: "grid", gap: 14 }}>
        {/* toggle จีน/ไทย */}
        <OriginToggle origin={origin} onSwitch={switchOrigin} disabled={pending} />

        <div
          style={{
            display: "grid",
            gap: 12,
            // มือถือ (≤400px): ทุกช่องเรียงลงเป็นคอลัมน์เดียว (min() กันล้นจอ) ·
            // จอกว้างค่อยกระจายเป็นหลายคอลัมน์อัตโนมัติ
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          }}
        >
          {/* ผู้ขาย + สร้างใหม่ inline */}
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

          {/* คลังปลายทาง */}
          <label style={fieldWrap}>
            <span style={labelStyle}>คลังปลายทาง <span style={optStyle}>(ไม่บังคับ)</span></span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={selectStyle}>
              <option value="">— ไม่ระบุ —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>

          {/* เรต — เฉพาะจีน */}
          {isChina && (
            <label style={fieldWrap}>
              <span style={labelStyle}>
                อัตราแลกเปลี่ยน (฿ ต่อ 1 ¥)
                {fxDate && <span style={optStyle}>เรตวันนี้ {fxDate}</span>}
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

      {/* ── รายการสินค้า: แต่ละแถวกะทัดรัด ── */}
      <div className="dc-card" style={{ display: "grid", gap: 4 }}>
        {/* หัวคอลัมน์ */}
        <div className="dc-poline" style={{ borderBottom: "1.5px solid var(--dc-line-strong, #d4dae4)", paddingBottom: 8 }}>
          <span style={colHead}>สินค้า</span>
          <span style={{ ...colHead, textAlign: "center" }}>จำนวน</span>
          <span style={{ ...colHead, textAlign: "right" }}>ราคา/หน่วย ({sym})</span>
          <span />
        </div>

        {lines.map((l) => (
          <LineRow
            key={l.key}
            line={l}
            sym={sym}
            canRemove={lines.length > 1}
            onPatch={(patch) => setLine(l.key, patch)}
            onRemove={() => removeLine(l.key)}
            onUploadPhoto={(file) => uploadLinePhoto(l.key, file)}
            onError={setError}
          />
        ))}

        <button type="button" onClick={addLine} style={addRowBtn}>
          <Plus size={17} /> เพิ่มรายการ
        </button>
      </div>

      {/* ── โน้ตใบ + ยอดรวม ── */}
      <div className="dc-card" style={{ display: "grid", gap: 14 }}>
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
            paddingTop: 12,
          }}
        >
          <span style={{ fontSize: 14, color: "var(--dc-muted, #5b6676)" }}>ยอดรวมทั้งใบ</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26, fontWeight: 820, fontVariantNumeric: "tabular-nums", color: "var(--dc-ink, #1c2533)" }}>
              {sym}{fmt(totals.sum)}
            </div>
            {totals.thb != null && (
              <div style={{ fontSize: 14, color: "var(--dc-muted, #5b6676)", fontVariantNumeric: "tabular-nums" }}>
                ≈ ฿{fmt(totals.thb)} (เรต {fmt(fx ?? 0, 4)})
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600, margin: 0 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="dc-btn-xl" disabled={pending} style={{ flex: 1 }}>
          {pending ? <Loader2 size={18} className="animate-spin" /> : null}
          บันทึกใบสั่งซื้อ (ร่าง)
        </button>
        <button
          type="button"
          className="dc-btn-xl dc-btn-xl--ghost"
          onClick={() => router.push("/dc/office/purchasing")}
          disabled={pending}
          style={{ flex: "0 0 auto" }}
        >
          ยกเลิก
        </button>
      </div>
    </form>
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
              minWidth: 96,
              padding: "7px 16px",
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
            <span style={{ fontSize: 15 }}>{o.label}</span>
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

/* ───────────────────────── Line row (compact) ───────────────────────── */
function LineRow({
  line,
  sym,
  canRemove,
  onPatch,
  onRemove,
  onUploadPhoto,
  onError,
}: {
  line: LineDraft;
  sym: string;
  canRemove: boolean;
  onPatch: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  onUploadPhoto: (file: File) => void;
  onError: (e: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ borderBottom: "1px solid var(--dc-line, #e7ebf2)", paddingBottom: 6 }}>
      <div className="dc-poline" style={{ borderBottom: "none", padding: "8px 0 4px" }}>
        {/* ช่องสินค้า = combobox ค้น/สร้าง */}
        <ProductCombobox
          value={line.productId}
          label={line.productLabel}
          onSelect={(p) => onPatch({ productId: p.id, productLabel: `${p.name} · ${p.sku}` })}
          onError={onError}
        />

        {/* จำนวน */}
        <input
          value={line.qty}
          onChange={(e) => onPatch({ qty: e.target.value })}
          inputMode="numeric"
          placeholder="1"
          style={cellInput}
          aria-label="จำนวน"
        />

        {/* ราคา/หน่วย */}
        <input
          value={line.unitPrice}
          onChange={(e) => onPatch({ unitPrice: e.target.value })}
          inputMode="decimal"
          placeholder={`${sym}0`}
          style={{ ...cellInput, textAlign: "right" }}
          aria-label={`ราคาต่อหน่วย ${sym}`}
        />

        {/* ลบแถว */}
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          style={{ ...ghostIconBtn, opacity: canRemove ? 1 : 0.3, justifySelf: "center" }}
          title="ลบรายการ"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* แถวเสริม: รูป + โน้ต (เล็ก ไม่ดันแถวให้สูง) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4, flexWrap: "wrap" }}>
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
        {line.photoUrl ? (
          <button type="button" onClick={() => fileRef.current?.click()} style={{ ...thumbBox, padding: 0, overflow: "hidden" }} title="เปลี่ยนรูป">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={line.photoUrl} alt="รูปสินค้า" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={line.uploading}
            style={{ ...miniChip }}
            title="แนบรูปที่ผู้ขายส่งมา"
          >
            {line.uploading ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
            {line.uploading ? "กำลังอัป…" : "แนบรูป"}
          </button>
        )}
        {line.photoUrl && (
          <button type="button" onClick={() => onPatch({ photoR2Key: null, photoUrl: null })} style={ghostMiniBtn}>
            <Upload size={12} /> ลบรูป
          </button>
        )}

        <button
          type="button"
          onClick={() => onPatch({ showNote: !line.showNote })}
          style={{ ...miniChip, ...(line.showNote || line.note ? { color: "var(--dc-blue-strong, #1d4ed8)", borderColor: "var(--color-brand-200, #c9d8f0)" } : {}) }}
        >
          <StickyNote size={13} /> โน้ต
        </button>

        {line.showNote && (
          <input
            value={line.note}
            onChange={(e) => onPatch({ note: e.target.value })}
            placeholder="เช่น สี/รุ่น"
            style={{ ...cellInput, flex: "1 1 160px", minWidth: 140 }}
            autoComplete="off"
          />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Product combobox (search + inline create) ───────────────────────── */
function ProductCombobox({
  value,
  label,
  onSelect,
  onError,
}: {
  value: string;
  label: string;
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

  // ปิดเมื่อคลิกนอกกล่อง
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

  function openPicker() {
    setOpen(true);
    setCreating(false);
    if (results.length === 0) runSearch("");
  }

  function pick(p: PoProductOption) {
    onSelect(p);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        type="button"
        onClick={openPicker}
        style={{
          ...cellInput,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: value ? "var(--dc-ink, #1c2533)" : "var(--dc-subtle, #8a94a3)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        <Search size={14} style={{ flex: "0 0 auto", opacity: 0.6 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? label : "ค้นหา / เลือกสินค้า"}
        </span>
      </button>

      {open && (
        <div style={popover}>
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
                      <span style={{ fontWeight: 600, color: "var(--dc-ink, #1c2533)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
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

/* ───────────────────────── Inline create product (name, category, type, photo) ───────────────────────── */
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
  const [category, setCategory] = useState("");
  const [type, setType] = useState<"SALE" | "SPARE">("SALE");
  const [imageR2Path, setImageR2Path] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickPhoto(file: File) {
    setUploading(true);
    onError(null);
    const data = await uploadFile(file);
    setUploading(false);
    if (data.ok) {
      setImageR2Path(data.key);
      setImageUrl(data.url);
    } else {
      onError(data.error);
    }
  }

  async function save() {
    if (!name.trim() || saving || uploading) return;
    setSaving(true);
    onError(null);
    const res = await quickCreateProduct({
      name: name.trim(),
      category: category.trim() || null,
      type,
      imageR2Path,
    });
    setSaving(false);
    if (res.ok) {
      onCreated({ id: res.product.id, name: res.product.name, sku: res.product.sku });
    } else {
      onError(res.error);
    }
  }

  return (
    <div style={{ padding: 10, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dc-ink, #1c2533)" }}>สร้างสินค้าใหม่</span>
        <button type="button" onClick={onCancel} style={ghostIconBtn}><X size={15} /></button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {/* รูป */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickPhoto(f);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...thumbBox, flex: "0 0 auto", padding: 0, overflow: "hidden" }}>
          {uploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="รูปสินค้า" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <ImageIcon size={20} color="var(--dc-subtle, #8a94a3)" />
          )}
        </button>
        <div style={{ flex: 1, display: "grid", gap: 8 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อสินค้า *" autoFocus autoComplete="off" />
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="หมวด (เช่น ตุ๊กตา)" autoComplete="off" />
        </div>
      </div>

      {/* ชนิด SALE/SPARE */}
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
            {t === "SALE" ? "สินค้าขาย" : "อะไหล่"}
          </button>
        ))}
      </div>

      <button type="button" onClick={save} disabled={!name.trim() || saving || uploading} style={savePanelBtn}>
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} สร้าง & เลือกเข้าแถว
      </button>
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */
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
const colHead: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--dc-muted, #5b6676)" };

const selectStyle: React.CSSProperties = {
  height: 42,
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  padding: "0 10px",
  fontSize: 14,
  background: "#fff",
  color: "var(--dc-ink, #1c2533)",
};

const cellInput: React.CSSProperties = {
  height: 40,
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  padding: "0 10px",
  fontSize: 14,
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
  height: 42,
  borderRadius: 10,
  border: "1.5px dashed var(--color-brand-200, #c9d8f0)",
  background: "var(--color-brand-50, #eef3fb)",
  color: "var(--dc-blue-strong, #1d4ed8)",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const miniChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 28,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  color: "var(--dc-muted, #5b6676)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostMiniBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 28,
  padding: "0 8px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--dc-subtle, #8a94a3)",
  fontSize: 12,
  cursor: "pointer",
};

const thumbBox: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 9,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  zIndex: 30,
  width: 320,
  maxWidth: "min(320px, 88vw)",
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

"use client";

// DC · หน้าคลัง · รายการ PO ที่รอรับเข้า (client) — แตะใบ → ฟอร์มรับสินค้า.
//   • หัวใบโชว์ "ผู้ขาย (คนขาย)" เด่น · แตะเพื่อกาง/พับ
//   • แต่ละบรรทัด = การ์ดซ้าย-ขวา:
//       ซ้าย  = รูปสินค้า (จาก imageR2Path) + "สั่ง N [หน่วย]" + ชื่อ + SKU
//       ขวา   = กรอกจำนวนรับจริง (stepper ใหญ่) + เสียหาย (เล็ก)
//               + ปุ่ม "ถ่ายรูป/แนบรูปของที่รับ" (อัปผ่าน /api/dc/upload → คืน R2 key)
//               + thumbnail รูปที่อัปแล้ว
//   • รูปที่ถ่ายใหม่: เก็บ R2 key แล้ว "ต่อท้าย note" ตอนส่ง (ไม่แตะ signature ของ receivePo)
//   • หมายเหตุการรับ (note) — แนะนำให้กรอก
//   • ปุ่ม "รับเข้าคลัง" busy-lock กันกดซ้ำ · สำเร็จ → toast เขียว + เอาใบออกจากรายการ
//   • มือถือ/iPad: ซ้าย-ขวา ยุบเป็นบน-ล่างบนจอแคบ (flexWrap + minWidth)

import { useCallback, useState } from "react";
import { PackageCheck, ChevronDown, ChevronRight, Camera, Trash2 } from "lucide-react";
import { receivePo } from "@/lib/dc/po-actions";
import { DcThumb } from "@/components/dc/product-image";

export type ReceivablePoLine = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  imageR2Path: string | null;
  qtyOrdered: number;
};

export type ReceivablePo = {
  id: string;
  poCode: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  supplierName: string;
  lineCount: number;
  lines: ReceivablePoLine[];
};

// state ฟอร์มต่อบรรทัด (string ในฟอร์ม → แปลงเป็น int ตอนส่ง)
type LineDraft = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  imageR2Path: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  qtyDamaged: number;
  /** ผู้ใช้แก้ช่อง "เสียหาย" เองแล้วหรือยัง → ถ้าแก้เองแล้วห้าม auto-fill ทับ */
  damagedTouched: boolean;
  /** R2 key ของรูปที่ "ถ่ายใหม่ตอนรับ" (อัปผ่าน /api/dc/upload) */
  photoKeys: string[];
  /** public URL ของรูปที่ถ่ายใหม่ (ไว้โชว์ thumbnail) — เรียงตรงกับ photoKeys */
  photoUrls: string[];
  uploading: boolean;
};

function toInt(n: number): number {
  return Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));
}

// อัปไฟล์ผ่านเซิร์ฟเวอร์ (เหมือนฟอร์มสร้าง PO) → คืน R2 key + public url
async function uploadReceivePhoto(
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

export function ReceivePoList({
  pos,
  warehouseId,
  r2PublicUrl,
}: {
  pos: ReceivablePo[];
  warehouseId: string;
  r2PublicUrl: string;
}) {
  const [items, setItems] = useState<ReceivablePo[]>(pos);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const removePo = useCallback((poId: string) => {
    setItems((prev) => prev.filter((p) => p.id !== poId));
    setOpenId((cur) => (cur === poId ? null : cur));
  }, []);

  if (items.length === 0) {
    return (
      <div
        className="dc-card"
        style={{ textAlign: "center", padding: 28, color: "var(--dc-muted, #6b7785)" }}
      >
        ไม่มีใบสั่งซื้อที่รอรับเข้า — ของมาถึงแล้วค่อยกลับมาที่หน้านี้
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((po) => (
        <PoCard
          key={po.id}
          po={po}
          warehouseId={warehouseId}
          r2PublicUrl={r2PublicUrl}
          open={openId === po.id}
          onToggle={() => setOpenId((cur) => (cur === po.id ? null : po.id))}
          onReceived={(grnId) => {
            removePo(po.id);
            showToast(`รับเข้าคลังแล้ว · ${po.poCode}`);
            void grnId;
          }}
        />
      ))}

      {/* toast สำเร็จ */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "#1e8e4e",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 20px",
            fontSize: 16,
            fontWeight: 700,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            zIndex: 9999,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <PackageCheck size={18} /> {toast}
        </div>
      )}
    </div>
  );
}

function PoCard({
  po,
  warehouseId,
  r2PublicUrl,
  open,
  onToggle,
  onReceived,
}: {
  po: ReceivablePo;
  warehouseId: string;
  r2PublicUrl: string;
  open: boolean;
  onToggle: () => void;
  onReceived: (grnId: string) => void;
}) {
  // draft ของบรรทัด — เริ่มต้น: รับ = จำนวนที่สั่ง, เสียหาย = 0
  const [drafts, setDrafts] = useState<LineDraft[]>(() =>
    po.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      unit: l.unit,
      imageR2Path: l.imageR2Path,
      qtyOrdered: l.qtyOrdered,
      qtyReceived: l.qtyOrdered,
      qtyDamaged: 0,
      damagedTouched: false,
      photoKeys: [],
      photoUrls: [],
      uploading: false,
    })),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // สร้าง URL รูปสินค้า (imageR2Path) — http เต็มใช้ตรง ๆ · key → ต่อ base
  const productImg = useCallback(
    (path: string | null): string | null => {
      if (!path) return null;
      if (/^https?:\/\//.test(path)) return path;
      return r2PublicUrl ? `${r2PublicUrl}/${path}` : null;
    },
    [r2PublicUrl],
  );

  const setReceived = useCallback((productId: string, qty: number) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.productId !== productId) return d;
        const rec = toInt(qty);
        // รับน้อยกว่าสั่ง → เติม "เสียหาย" อัตโนมัติ = สั่ง − รับ (เว้นบรรทัดที่ผู้ใช้แก้เสียหายเอง)
        const nextDamaged = d.damagedTouched ? d.qtyDamaged : Math.max(0, d.qtyOrdered - rec);
        return { ...d, qtyReceived: rec, qtyDamaged: nextDamaged };
      }),
    );
  }, []);
  const setDamaged = useCallback((productId: string, qty: number) => {
    setDrafts((prev) =>
      prev.map((d) => (d.productId === productId ? { ...d, qtyDamaged: toInt(qty), damagedTouched: true } : d)),
    );
  }, []);

  // ถ่าย/เลือกรูปของที่รับ → อัป → เก็บ key+url ลง draft
  const addPhoto = useCallback(async (productId: string, file: File) => {
    setError(null);
    setDrafts((prev) =>
      prev.map((d) => (d.productId === productId ? { ...d, uploading: true } : d)),
    );
    const res = await uploadReceivePhoto(file);
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.productId !== productId) return d;
        if (!res.ok) return { ...d, uploading: false };
        return {
          ...d,
          uploading: false,
          photoKeys: [...d.photoKeys, res.key],
          photoUrls: [...d.photoUrls, res.url],
        };
      }),
    );
    if (!res.ok) setError(res.error);
  }, []);

  const removePhoto = useCallback((productId: string, idx: number) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.productId !== productId) return d;
        return {
          ...d,
          photoKeys: d.photoKeys.filter((_, i) => i !== idx),
          photoUrls: d.photoUrls.filter((_, i) => i !== idx),
        };
      }),
    );
  }, []);

  const confirm = useCallback(async () => {
    if (busy) return;
    if (!note.trim()) {
      setError("กรุณากรอกหมายเหตุการรับ (เช่น สภาพของ / ผู้รับ / กล่องที่ขาด)");
      return;
    }
    const active = drafts.filter((d) => d.qtyReceived > 0 || d.qtyDamaged > 0);
    const lines = active.map((d) => ({
      productId: d.productId,
      qtyReceived: d.qtyReceived,
      qtyDamaged: d.qtyDamaged,
    }));
    if (lines.length === 0) {
      setError("กรุณาระบุจำนวนที่รับเข้าอย่างน้อย 1 รายการ");
      return;
    }
    // ต่อท้ายรูปที่ถ่ายใหม่ลง note (ไม่แตะ signature ของ receivePo)
    const photoRefs = active
      .filter((d) => d.photoKeys.length > 0)
      .map((d) => `${d.name}: ${d.photoKeys.join(", ")}`);
    const noteOut =
      photoRefs.length > 0
        ? `${note.trim()}\n[รูปของที่รับ]\n${photoRefs.join("\n")}`
        : note.trim();

    setBusy(true);
    setError(null);
    try {
      const res = await receivePo({ poId: po.id, warehouseId, note: noteOut, lines });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onReceived(res.grnId);
    } catch {
      setError("บันทึกรับเข้าไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }, [busy, note, drafts, po.id, warehouseId, onReceived]);

  const totalReceived = drafts.reduce((s, d) => s + d.qtyReceived, 0);

  return (
    <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* หัวใบ — โชว์ "ผู้ขาย" เด่น · แตะเพื่อกาง/พับ */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--dc-muted, #6b7785)", flexShrink: 0 }}>
          {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* ผู้ขายเด่นสุด */}
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: "var(--dc-ink, #1f2733)",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {po.supplierName}
          </div>
          <div style={{ fontSize: 13, color: "var(--dc-muted, #6b7785)", marginTop: 2 }}>
            {po.poCode} · {po.lineCount} รายการ
          </div>
        </div>
        <span className={`dc-st dc-st--${po.statusTone}`} style={{ flexShrink: 0 }}>
          {po.statusLabel}
        </span>
      </button>

      {/* ฟอร์มรับสินค้า */}
      {open && (
        <div
          style={{
            padding: 16,
            borderTop: "1px solid var(--dc-line, #e6eaf0)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {drafts.map((d) => {
            const img = productImg(d.imageR2Path);
            return (
              <div
                key={d.productId}
                style={{
                  border: "1px solid var(--dc-line, #e6eaf0)",
                  borderRadius: 12,
                  padding: 10,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                {/* ========== ซ้าย: รูป + จำนวนสั่ง + ชื่อ ========== */}
                <div
                  style={{
                    flex: "1 1 180px",
                    minWidth: 160,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  {/* รูปสินค้า (คลิกซูมได้) */}
                  <DcThumb url={img} alt={d.name} size={50} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--dc-ink, #1f2733)",
                        lineHeight: 1.2,
                      }}
                    >
                      {d.name}
                    </div>
                    <div
                      style={{ fontSize: 12.5, color: "var(--dc-muted, #6b7785)", marginTop: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}
                    >
                      <span>{d.sku}</span>
                      <span
                        style={{
                          padding: "1px 8px",
                          borderRadius: 999,
                          background: "var(--dc-surf2, #f4efe8)",
                          color: "var(--dc-ink, #1f2733)",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        สั่ง {d.qtyOrdered} {d.unit}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ========== ขวา: รับจริง + เสียหาย + รูปที่ถ่ายใหม่ ========== */}
                <div
                  style={{
                    flex: "1 1 200px",
                    minWidth: 180,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {/* รับจริง (compact stepper — Pinpoint #1) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "var(--dc-ink, #1f2733)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      รับจริง
                    </div>
                    <div className="dc-qty dc-qty--sm">
                      <button
                        type="button"
                        onClick={() => setReceived(d.productId, d.qtyReceived - 1)}
                        aria-label="ลดจำนวนรับ"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={d.qtyReceived}
                        onChange={(e) => setReceived(d.productId, Number(e.target.value))}
                        aria-label="จำนวนที่รับจริง"
                      />
                      <button
                        type="button"
                        onClick={() => setReceived(d.productId, d.qtyReceived + 1)}
                        aria-label="เพิ่มจำนวนรับ"
                      >
                        ＋
                      </button>
                    </div>
                  </div>

                  {/* เสียหาย (เล็ก) */}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--dc-muted, #6b7785)",
                    }}
                  >
                    <span style={{ whiteSpace: "nowrap" }}>เสียหาย</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={d.qtyDamaged}
                      onChange={(e) => setDamaged(d.productId, Number(e.target.value))}
                      aria-label="จำนวนที่เสียหาย"
                      style={{
                        width: 60,
                        border: "1.5px solid var(--dc-line, #e6eaf0)",
                        borderRadius: 9,
                        padding: "6px 8px",
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--dc-ink, #1f2733)",
                        background: "#fff",
                      }}
                    />
                  </label>

                  {/* ปุ่มถ่ายรูป/แนบรูปของที่รับ + thumbnail */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 11px",
                        borderRadius: 9,
                        border: "1.5px solid var(--dc-line, #e6eaf0)",
                        background: "#fff",
                        color: "var(--dc-ink, #1f2733)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: d.uploading ? "wait" : "pointer",
                        opacity: d.uploading ? 0.6 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Camera size={16} />
                      {d.uploading ? "กำลังอัป…" : "ถ่ายรูป"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={d.uploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void addPhoto(d.productId, f);
                          e.target.value = "";
                        }}
                        style={{ display: "none" }}
                      />
                    </label>

                    {d.photoUrls.map((u, i) => (
                      <div
                        key={u}
                        style={{
                          position: "relative",
                          width: 52,
                          height: 52,
                          borderRadius: 10,
                          overflow: "hidden",
                          border: "1px solid var(--dc-line, #e6eaf0)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={u}
                          alt="รูปของที่รับ"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(d.productId, i)}
                          aria-label="ลบรูป"
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            border: "none",
                            background: "rgba(0,0,0,0.6)",
                            color: "#fff",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* หมายเหตุการรับ — เหมือนการนำเข้า */}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dc-ink, #1f2733)" }}>
              หมายเหตุการรับ
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="เช่น ของครบ สภาพดี / กล่องที่ 3 บุบ / รับโดยช่างเอก…"
              style={{
                width: "100%",
                border: "1.5px solid var(--dc-line, #e6eaf0)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 15,
                lineHeight: 1.5,
                color: "var(--dc-ink, #1f2733)",
                background: "#fff",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </label>

          {error && (
            <div
              role="alert"
              style={{
                background: "#fdecea",
                color: "#c0392b",
                border: "1px solid #f5c6c0",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          <button type="button" className="dc-btn-xl" onClick={confirm} disabled={busy}>
            <PackageCheck size={20} />
            {busy ? "กำลังบันทึก…" : `รับเข้าคลัง (${totalReceived} ชิ้น)`}
          </button>
        </div>
      )}
    </div>
  );
}

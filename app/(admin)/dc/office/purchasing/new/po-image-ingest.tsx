"use client";

// DC · ใบสั่งซื้อจีน — ปุ่ม "แนบรูป → อ่านอัตโนมัติ" + จอ review.
//   1) เลือกรูปออเดอร์ 1688 ได้ทีละหลายใบ → อัปเข้า R2 → ส่งให้ Gemini อ่าน (ingestPoImages)
//   2) โชว์รายการที่อ่านได้ให้ "คนตรวจ/แก้" — ชื่อไทย(AI ตั้งให้) · จำนวน · ราคา · รูปครอป · จับคู่ของเดิม
//   3) กด "เพิ่มเข้าใบ" → สร้างสินค้าใหม่ (ชื่อไทย+รูปครอป) หรือใช้ของเดิม → เติมแถวในฟอร์ม PO
//
// 💰 ไม่บันทึกเงิน/สั่งของตรงนี้ — แค่ช่วยคีย์. ผู้ใช้ยังกดบันทึก PO เองในฟอร์มหลัก.

import { useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  X,
  Check,
  ImageIcon,
  Trash2,
  AlertTriangle,
  Link2,
  PlusCircle,
} from "lucide-react";
import {
  ingestPoImages,
  type OcrLineItem,
} from "@/lib/dc/po-image-ocr";
import {
  quickCreateProduct,
  searchProductsForPo,
} from "@/lib/dc/po-actions";

export type OcrAddedLine = {
  productId: string;
  productLabel: string;
  qty: string;
  unitPrice: string;
  photoR2Key: string | null;
  photoUrl: string | null;
};

type ReviewRow = OcrLineItem & {
  qtyStr: string;
  priceStr: string;
  useExisting: boolean; // true = ใช้สินค้าเดิมที่จับคู่ได้ · false = สร้างใหม่
  include: boolean;
  rowError: string | null;
};

type Phase = "idle" | "uploading" | "reading" | "review" | "committing";

async function uploadOne(
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
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ" };
  }
}

export function PoImageIngest({
  origin,
  sym,
  onAddLines,
}: {
  origin: "CHINA" | "THAI";
  sym: string;
  onAddLines: (lines: OcrAddedLine[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string>("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setRows([]);
    setWarnings([]);
    setError(null);
    setProgress("");
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 12);
    setError(null);
    setWarnings([]);

    // 1) อัปรูปเข้า R2
    setPhase("uploading");
    const keys: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setProgress(`กำลังอัปรูป ${i + 1}/${list.length}…`);
      const up = await uploadOne(list[i]);
      if (up.ok) keys.push(up.key);
    }
    if (keys.length === 0) {
      setError("อัปโหลดรูปไม่สำเร็จ ลองใหม่");
      setPhase("idle");
      return;
    }

    // 2) ส่งให้ AI อ่าน
    setPhase("reading");
    setProgress(`AI กำลังอ่าน ${keys.length} รูป… (สักครู่)`);
    const res = await ingestPoImages({ imageKeys: keys, origin });
    if (!res.ok) {
      setError(res.error);
      setPhase("idle");
      return;
    }

    setRows(
      res.items.map((it) => ({
        ...it,
        qtyStr: String(it.qty || ""),
        priceStr: it.unitPrice ? String(it.unitPrice) : "",
        useExisting: !!it.matchProductId,
        include: true,
        rowError: null,
      })),
    );
    setWarnings(res.warnings);
    setPhase("review");
  }

  function patchRow(key: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const includedRows = rows.filter((r) => r.include);
  const reviewSum = includedRows.reduce(
    (s, r) => s + (Number(r.qtyStr) || 0) * (Number(r.priceStr) || 0),
    0,
  );

  async function commit() {
    setError(null);
    const toAdd = rows.filter((r) => r.include);
    if (toAdd.length === 0) {
      setError("ยังไม่ได้เลือกรายการ");
      return;
    }
    setPhase("committing");

    const out: OcrAddedLine[] = [];
    for (const r of toAdd) {
      const name = r.nameTh.trim();
      const qty = Math.max(0, Math.round(Number(r.qtyStr) || 0));
      const price = Math.max(0, Number(r.priceStr) || 0);
      if (!name || qty <= 0 || price <= 0) {
        patchRow(r.key, { rowError: "กรอกชื่อ/จำนวน/ราคาให้ครบ" });
        setPhase("review");
        setError("มีรายการที่ยังกรอกไม่ครบ (ดูช่องแดง)");
        return;
      }

      let productId = "";
      let productLabel = "";

      if (r.useExisting && r.matchProductId) {
        productId = r.matchProductId;
        productLabel = r.matchLabel ?? name;
      } else {
        const created = await quickCreateProduct({
          name,
          type: "SALE",
          imageR2Path: r.croppedUrl ?? null,
        });
        if (created.ok) {
          productId = created.product.id;
          productLabel = `${created.product.name} · ${created.product.sku}`;
        } else {
          // ชื่อซ้ำ → หาตัวเดิมมาใช้แทน (กันสร้างซ้ำ · ไม่ให้ commit ล้ม)
          const found = await searchProductsForPo({ q: name });
          const exact = found.find(
            (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
          );
          if (exact) {
            productId = exact.id;
            productLabel = `${exact.name} · ${exact.sku}`;
          } else {
            patchRow(r.key, { rowError: created.error });
            setPhase("review");
            setError("มีรายการสร้างไม่สำเร็จ (ดูช่องแดง)");
            return;
          }
        }
      }

      out.push({
        productId,
        productLabel,
        qty: String(qty),
        unitPrice: String(price),
        photoR2Key: r.croppedKey,
        photoUrl: r.croppedUrl,
      });
    }

    onAddLines(out);
    reset();
  }

  const busy = phase === "uploading" || phase === "reading" || phase === "committing";

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = "";
        }}
      />

      {/* ปุ่มเรียก */}
      <button type="button" onClick={() => fileRef.current?.click()} style={ingestBtn} disabled={busy}>
        {phase === "uploading" || phase === "reading" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}
        แนบรูปออเดอร์ → อ่านอัตโนมัติ
      </button>

      {/* สถานะระหว่างทำงาน (นอก modal) */}
      {(phase === "uploading" || phase === "reading") && (
        <div style={statusLine}>
          <Loader2 size={13} className="animate-spin" /> {progress}
        </div>
      )}
      {error && phase === "idle" && (
        <div style={errLine}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* จอ review */}
      {phase === "review" || phase === "committing" ? (
        <div style={overlay} onClick={() => !busy && reset()}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={17} color="#2563eb" />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#1c2533" }}>
                    ตรวจก่อนเพิ่มเข้าใบ ({includedRows.length} รายการ)
                  </div>
                  <div style={{ fontSize: 12, color: "#5b6676" }}>
                    AI อ่านให้แล้ว — แก้ชื่อ/จำนวน/ราคาได้ · เอาออกได้ · เงินต้องคุณตรวจเอง
                  </div>
                </div>
              </div>
              <button type="button" onClick={reset} disabled={busy} style={ghostIcon}>
                <X size={18} />
              </button>
            </div>

            {warnings.length > 0 && (
              <div style={warnBox}>
                {warnings.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <AlertTriangle size={13} style={{ flex: "0 0 auto", marginTop: 2 }} /> <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ overflowY: "auto", flex: 1, display: "grid", gap: 8, padding: "4px 2px" }}>
              {rows.map((r) => (
                <div
                  key={r.key}
                  style={{
                    ...rowCard,
                    opacity: r.include ? 1 : 0.5,
                    borderColor: r.rowError ? "#dc2626" : "#e7ebf2",
                  }}
                >
                  {/* รูปครอป */}
                  <div style={thumbWrap}>
                    {r.croppedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.croppedUrl} alt={r.nameTh} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <ImageIcon size={20} color="#8a94a3" />
                    )}
                    <span style={imgTag}>รูป {r.sourceImage}</span>
                  </div>

                  {/* ฟิลด์ */}
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                    <input
                      value={r.nameTh}
                      onChange={(e) => patchRow(r.key, { nameTh: e.target.value, rowError: null })}
                      placeholder="ชื่อสินค้า (ไทย)"
                      style={nameInput}
                    />
                    {r.nameZh && (
                      <div style={{ fontSize: 11, color: "#8a94a3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        จีน: {r.nameZh}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={miniField}>
                        <span style={miniLabel}>จำนวน</span>
                        <input
                          value={r.qtyStr}
                          onChange={(e) => patchRow(r.key, { qtyStr: e.target.value, rowError: null })}
                          inputMode="numeric"
                          style={{ ...miniInput, width: 62, textAlign: "center" }}
                        />
                      </label>
                      <label style={miniField}>
                        <span style={miniLabel}>ราคา ({sym})</span>
                        <input
                          value={r.priceStr}
                          onChange={(e) => patchRow(r.key, { priceStr: e.target.value, rowError: null })}
                          inputMode="decimal"
                          style={{ ...miniInput, width: 84, textAlign: "right" }}
                        />
                      </label>
                      {/* จับคู่ของเดิม / สร้างใหม่ */}
                      {r.matchProductId ? (
                        <button
                          type="button"
                          onClick={() => patchRow(r.key, { useExisting: !r.useExisting })}
                          style={{
                            ...matchToggle,
                            background: r.useExisting ? "#eaf3ec" : "#eef3fb",
                            color: r.useExisting ? "#1f8a55" : "#1d4ed8",
                          }}
                          title={r.matchLabel ?? ""}
                        >
                          {r.useExisting ? <Link2 size={12} /> : <PlusCircle size={12} />}
                          {r.useExisting ? "ใช้ของเดิม" : "สร้างใหม่"}
                        </button>
                      ) : (
                        <span style={{ ...matchToggle, background: "#eef3fb", color: "#1d4ed8", cursor: "default" }}>
                          <PlusCircle size={12} /> สร้างใหม่
                        </span>
                      )}
                    </div>
                    {r.useExisting && r.matchLabel && (
                      <div style={{ fontSize: 11, color: "#1f8a55" }}>→ {r.matchLabel}</div>
                    )}
                    {r.rowError && (
                      <div style={{ fontSize: 11.5, color: "#dc2626", fontWeight: 600 }}>{r.rowError}</div>
                    )}
                  </div>

                  {/* เอาออก */}
                  <button
                    type="button"
                    onClick={() => patchRow(r.key, { include: !r.include })}
                    style={ghostIcon}
                    title={r.include ? "เอาออก" : "เอากลับ"}
                  >
                    {r.include ? <Trash2 size={16} /> : <PlusCircle size={16} />}
                  </button>
                </div>
              ))}
            </div>

            {/* ยอดรวม + ปุ่ม */}
            <div style={modalFoot}>
              <div style={{ fontSize: 13, color: "#5b6676" }}>
                ยอดรวม (ตามที่แก้):{" "}
                <b style={{ color: "#1c2533", fontVariantNumeric: "tabular-nums" }}>
                  {sym}
                  {reviewSum.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </b>
              </div>
              {error && phase !== "committing" && (
                <div style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{error}</div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={reset} disabled={busy} style={cancelBtn}>
                  ยกเลิก
                </button>
                <button type="button" onClick={commit} disabled={busy || includedRows.length === 0} style={confirmBtn}>
                  {phase === "committing" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  เพิ่ม {includedRows.length} รายการเข้าใบ
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ── styles ── */
const ingestBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  width: "100%",
  height: 40,
  borderRadius: 10,
  border: "1.5px solid #c9d8f0",
  background: "linear-gradient(180deg,#f5f9ff,#eef3fb)",
  color: "#1d4ed8",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
const statusLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12.5,
  color: "#1d4ed8",
  marginTop: 6,
};
const errLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12.5,
  color: "#dc2626",
  fontWeight: 600,
  marginTop: 6,
};
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(20,28,44,.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
};
const modal: React.CSSProperties = {
  width: "min(640px, 96vw)",
  maxHeight: "90vh",
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 20px 60px rgba(20,40,90,.28)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 16,
};
const modalHead: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
};
const modalFoot: React.CSSProperties = {
  display: "grid",
  gap: 8,
  borderTop: "1px solid #e7ebf2",
  paddingTop: 10,
};
const warnBox: React.CSSProperties = {
  display: "grid",
  gap: 4,
  background: "#fff7ec",
  border: "1px solid #f3d9b8",
  color: "#9a6a1f",
  borderRadius: 10,
  padding: "8px 11px",
  fontSize: 12,
  lineHeight: 1.4,
};
const rowCard: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  border: "1px solid #e7ebf2",
  borderRadius: 12,
  padding: 10,
  background: "#fff",
};
const thumbWrap: React.CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
  width: 58,
  height: 58,
  borderRadius: 9,
  overflow: "hidden",
  background: "#f4f7fb",
  border: "1px solid #e7ebf2",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const imgTag: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  fontSize: 9,
  textAlign: "center",
  background: "rgba(28,37,51,.6)",
  color: "#fff",
  padding: "1px 0",
};
const nameInput: React.CSSProperties = {
  width: "100%",
  height: 34,
  borderRadius: 8,
  border: "1px solid #e7ebf2",
  padding: "0 9px",
  fontSize: 13.5,
  fontWeight: 600,
  color: "#1c2533",
  outline: "none",
};
const miniField: React.CSSProperties = { display: "grid", gap: 2 };
const miniLabel: React.CSSProperties = { fontSize: 10.5, color: "#8a94a3", fontWeight: 600 };
const miniInput: React.CSSProperties = {
  height: 32,
  borderRadius: 8,
  border: "1px solid #e7ebf2",
  padding: "0 8px",
  fontSize: 13.5,
  fontVariantNumeric: "tabular-nums",
  outline: "none",
  color: "#1c2533",
};
const matchToggle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 32,
  padding: "0 11px",
  borderRadius: 8,
  border: "none",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  alignSelf: "flex-end",
};
const ghostIcon: React.CSSProperties = {
  flex: "0 0 auto",
  height: 32,
  width: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "#5b6676",
  cursor: "pointer",
};
const cancelBtn: React.CSSProperties = {
  flex: "0 0 auto",
  height: 44,
  padding: "0 18px",
  borderRadius: 11,
  border: "1px solid #e7ebf2",
  background: "#fff",
  color: "#5b6676",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: 44,
  borderRadius: 11,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontSize: 15,
  fontWeight: 800,
  cursor: "pointer",
};

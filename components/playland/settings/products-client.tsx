"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/playland/actions";
import { cloneProductToBranches } from "@/lib/playland/branch-actions";
import { thb } from "@/lib/playland/format";
import { ShoppingBasket, PlusCircle, ImageOff, Copy } from "lucide-react";

interface Branch { id: string; name: string; }
interface Product {
  id: string; branchId: string; kind: string; name: string; barcode: string | null; sku: string | null;
  category: string | null; supplier: string | null; priceCents: number; costCents: number | null; stock: number; reorderLevel: number; active: boolean;
  imageR2Path: string | null;
}

// Locked "Play a lot" tokens (matches office)
const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const th: React.CSSProperties = { fontSize: 11.5, color: MUTED, fontWeight: 600, textAlign: "left", padding: "11px 14px", borderBottom: `1px solid ${LINE}` };
const td: React.CSSProperties = { fontSize: 13.5, padding: "11px 14px", borderBottom: `1px solid #f2ebdd` };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: "2px 10px", background: bg, color: fg });
const lbl: React.CSSProperties = { fontSize: 12, color: MUTED, display: "block", marginBottom: 4 };
const inputS: React.CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 9, padding: "9px 11px", fontSize: 14, fontFamily: MITR, color: INK, background: "#fff", boxSizing: "border-box" };
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: MITR,
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
const btnSm: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", borderRadius: 8, padding: "4px 9px", fontSize: 11, fontWeight: 600, fontFamily: MITR, background: "#fff", color: MUTED, border: `1px solid ${LINE}` };

export function ProductsClient({ branches, products, r2PublicUrl, activeBranchId }: { branches: Branch[]; products: Product[]; r2PublicUrl: string; activeBranchId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cloningId, setCloningId] = useState<string | null>(null);
  const otherBranches = branches.filter((b) => b.id !== activeBranchId);
  const activeBranchName = branches.find((b) => b.id === activeBranchId)?.name ?? "";
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"SALE_ITEM" | "SPARE_PART">("SALE_ITEM");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [price, setPrice] = useState("0");
  const [cost, setCost] = useState("0");
  const [stock, setStock] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [active, setActive] = useState(true);
  // imageR2Path เก็บได้ 2 แบบ: URL เต็ม (วางจาก google) หรือ R2 key (อัปไฟล์)
  const [imageR2Path, setImageR2Path] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false); // ผู้ขาย/รูป ซ่อนไว้ก่อน → เพิ่มของด่วนกรอกน้อยลง

  // แปลงค่าที่เก็บ → URL สำหรับแสดง preview/รูปในตาราง
  function resolveImg(v: string | null): string | null {
    if (!v) return null;
    return v.startsWith("http") ? v : `${r2PublicUrl}/${v}`;
  }

  function startEdit(p: Product) {
    setEditing(p);
    setName(p.name); setKind(p.kind === "SPARE_PART" ? "SPARE_PART" : "SALE_ITEM");
    setBarcode(p.barcode ?? ""); setCategory(p.category ?? ""); setSupplier(p.supplier ?? "");
    setPrice(((p.priceCents) / 100).toString()); setCost(((p.costCents ?? 0) / 100).toString());
    setStock(String(p.stock)); setReorder(String(p.reorderLevel));
    setBranchId(p.branchId); setActive(p.active);
    setImageR2Path(p.imageR2Path ?? ""); setImgError(null); setSaveErr(null); setShowAdvanced(true);
    setShowForm(true);
  }
  function startNew() {
    setEditing(null);
    setName(""); setKind("SALE_ITEM"); setBarcode(""); setCategory(""); setSupplier("");
    setPrice("0"); setCost("0"); setStock("0"); setReorder("0");
    setBranchId(activeBranchId ?? branches[0]?.id ?? ""); setActive(true); // เพิ่มเข้าสาขาที่กำลังทำงาน
    setImageR2Path(""); setImgError(null); setSaveErr(null); setShowAdvanced(false);
    setShowForm(true);
  }
  // ก๊อปสินค้าไปสาขาอื่น (เปิดสาขาใหม่ไม่ต้องตั้งซ้ำ)
  function cloneToBranches(p: Product) {
    if (otherBranches.length === 0) return;
    const names = otherBranches.map((b) => b.name).join(", ");
    if (!confirm(`ก๊อป "${p.name}" ไปสาขา: ${names}? (สต๊อกเริ่มที่ 0 · ราคา/ต้นทุนตามต้นฉบับ)`)) return;
    setCloningId(p.id);
    start(async () => {
      const res = await cloneProductToBranches({ productId: p.id, targetBranchIds: otherBranches.map((b) => b.id) });
      setCloningId(null);
      if (res.ok) { setSaveErr(null); router.refresh(); }
      else alert(res.error);
    });
  }
  // ทำซ้ำ: คัดลอกค่าเดิมทั้งหมด ยกเว้นรหัส+บาร์โค้ด (บาร์โค้ดต้องไม่ซ้ำ) → กรอกใหม่แค่ชื่อ/บาร์โค้ด
  function startClone(p: Product) {
    setEditing(null);
    setName(p.name + " (สำเนา)"); setKind(p.kind === "SPARE_PART" ? "SPARE_PART" : "SALE_ITEM");
    setBarcode(""); setCategory(p.category ?? ""); setSupplier(p.supplier ?? "");
    setPrice(((p.priceCents) / 100).toString()); setCost(((p.costCents ?? 0) / 100).toString());
    setStock("0"); setReorder(String(p.reorderLevel));
    setBranchId(p.branchId); setActive(true);
    setImageR2Path(p.imageR2Path ?? ""); setImgError(null); setSaveErr(null); setShowAdvanced(false);
    setShowForm(true);
  }
  async function handleFile(file: File) {
    setImgError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/playland/product-image", { method: "POST", body: fd });
      const json = (await res.json()) as { key?: string; error?: string };
      if (!res.ok || !json.key) {
        setImgError(json.error ?? "อัปโหลดรูปไม่สำเร็จ");
        return;
      }
      setImageR2Path(json.key);
    } catch {
      setImgError("อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(null);
    start(async () => {
      const priceCents = Math.round(parseFloat(price || "0") * 100);
      const costCents = Math.round(parseFloat(cost || "0") * 100);
      const res = await upsertProduct({
        id: editing?.id, branchId, kind, name, barcode: barcode || undefined, category: category || undefined,
        supplier: supplier || undefined, priceCents, costCents, stock: parseInt(stock || "0"),
        reorderLevel: parseInt(reorder || "0"), active,
        imageR2Path: imageR2Path.trim() === "" ? "" : imageR2Path.trim(),
      });
      if (res.ok) { setShowForm(false); router.refresh(); }
      else setSaveErr(res.error || "บันทึกไม่สำเร็จ · ลองใหม่");
    });
  }

  const lowStock = products.filter((p) => p.stock <= p.reorderLevel);

  return (
    <div style={{ fontFamily: MITR, color: INK, padding: "22px 28px 44px", maxWidth: 1480, margin: "0 auto" }}>
      {/* sub-header: title + count + low-stock + primary action */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 600, fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}>
            <ShoppingBasket size={19} color={AMBER} /> สินค้า POS · {products.length}
            {lowStock.length > 0 && <span style={chip("#fdeceb", RED)}>เหลือน้อย {lowStock.length}</span>}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            ขนม · เครื่องดื่ม{activeBranchName && <> · <span style={{ color: BLUE }}>{activeBranchName}</span></>} · แตะแถวเพื่อแก้ไข
          </div>
        </div>
        <button onClick={startNew} style={{ ...btn(true), marginLeft: "auto" }}><PlusCircle size={15} /> เพิ่มสินค้า</button>
      </div>

      <div className={showForm ? "pl-grid-2" : undefined} style={showForm ? { alignItems: "start" } : undefined}>
        <div style={{ ...card, overflow: "hidden" }}>
          {products.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: MUTED }}>
              <ShoppingBasket size={30} opacity={0.4} />ยังไม่มีสินค้า
            </div>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>รูป</th><th style={th}>ชื่อ</th><th style={th}>Barcode</th><th style={th}>หมวด</th>
                <th style={{ ...th, textAlign: "right" }}>ราคา</th><th style={{ ...th, textAlign: "right" }}>คงเหลือ</th>
                <th style={th}>สาขา</th><th style={th}>Active</th>
              </tr></thead>
              <tbody>
                {products.map((p) => {
                  const low = p.stock <= p.reorderLevel;
                  const img = resolveImg(p.imageR2Path);
                  const isSel = editing?.id === p.id;
                  return (
                    <tr key={p.id} onClick={() => startEdit(p)} style={{ cursor: "pointer", background: isSel ? "#f5f9fe" : "transparent" }}>
                      <td style={td}>
                        {img
                          ? <img src={img} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: "cover", display: "block" }} />
                          : <span style={{ display: "inline-flex", width: 34, height: 34, borderRadius: 7, alignItems: "center", justifyContent: "center", background: "#f7f2ea", color: MUTED }}><ImageOff size={15} /></span>}
                      </td>
                      <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                      <td style={td}><span style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}>{p.barcode ?? "—"}</span></td>
                      <td style={{ ...td, color: MUTED }}>{p.category ?? "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{thb(p.priceCents)}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO, color: low ? RED : INK, fontWeight: low ? 700 : 400 }}>{p.stock}</td>
                      <td style={td}><span style={chip("#f2ebdd", MUTED)}>{branches.find((b) => b.id === p.branchId)?.name ?? "—"}</span></td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {p.active ? <span style={chip("#eaf3eb", GREEN)}>ใช้</span> : <span style={chip("#f2ebdd", MUTED)}>ปิด</span>}
                          <button type="button" style={btnSm} onClick={(e) => { e.stopPropagation(); startClone(p); }}>ทำซ้ำ</button>
                          {otherBranches.length > 0 && (
                            <button type="button" style={btnSm} disabled={cloningId === p.id} onClick={(e) => { e.stopPropagation(); cloneToBranches(p); }} title="ก๊อปไปสาขาอื่น">
                              <Copy size={11} /> {cloningId === p.id ? "..." : "→สาขา"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {showForm && (
          <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gap: 11 }}>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FREDOKA }}>{editing ? "แก้สินค้า" : "สินค้าใหม่"}</div>
            <div style={{ display: "flex", gap: 7 }}>
              <button type="button" onClick={() => setKind("SALE_ITEM")} style={{ ...btn(kind === "SALE_ITEM"), flex: 1, justifyContent: "center" }}>🍬 สินค้าขาย</button>
              <button type="button" onClick={() => setKind("SPARE_PART")} style={{ ...btn(false), flex: 1, justifyContent: "center", ...(kind === "SPARE_PART" ? { background: AMBER, color: "#fff", border: "none" } : {}) }}>🔧 อะไหล่ซ่อม</button>
            </div>
            <div>
              <label style={lbl}>ชื่อ *</label>
              <input style={inputS} required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>Barcode</label>
                <input style={inputS} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="ยิง/พิมพ์บาร์โค้ด" />
              </div>
              <div>
                <label style={lbl}>{kind === "SPARE_PART" ? "ประเภทอะไหล่" : "หมวด"}</label>
                <input style={inputS} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={kind === "SPARE_PART" ? "มอเตอร์ / สายพาน" : "ขนม / เครื่องดื่ม"} />
              </div>
            </div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ ...btnSm, justifySelf: "start" }}>
              {showAdvanced ? "− ซ่อนตัวเลือกเพิ่มเติม" : "+ ตัวเลือกเพิ่มเติม (ผู้ขาย · รูป)"}
            </button>
            {showAdvanced && (<>
            <div>
              <label style={lbl}>ผู้ขาย/ร้านค้า</label>
              <input style={inputS} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ไม่บังคับ" />
            </div>
            <div>
              <label style={lbl}>รูปสินค้า</label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {resolveImg(imageR2Path)
                  ? <img src={resolveImg(imageR2Path)!} alt="" style={{ width: 56, height: 56, borderRadius: 9, objectFit: "cover", flex: "0 0 auto" }} />
                  : <span style={{ display: "inline-flex", width: 56, height: 56, borderRadius: 9, alignItems: "center", justifyContent: "center", background: "#f7f2ea", color: MUTED, flex: "0 0 auto" }}><ImageOff size={18} /></span>}
                <div style={{ flex: 1, display: "grid", gap: 6 }}>
                  <input
                    style={inputS}
                    value={imageR2Path}
                    onChange={(e) => { setImageR2Path(e.target.value); setImgError(null); }}
                    placeholder="วางลิงก์รูปจาก google ได้เลย"
                  />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ ...btnSm, cursor: uploading ? "wait" : "pointer" }}>
                      {uploading ? "กำลังอัป..." : "อัปโหลดไฟล์"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        style={{ display: "none" }}
                        disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
                      />
                    </label>
                    {imageR2Path && (
                      <button type="button" style={btnSm} onClick={() => { setImageR2Path(""); setImgError(null); }}>ลบรูป</button>
                    )}
                  </div>
                  {imgError && <span style={{ fontSize: 12, color: RED }}>{imgError}</span>}
                </div>
              </div>
            </div>
            </>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>{kind === "SPARE_PART" ? "ราคาขาย (อะไหล่ไม่ต้องใส่)" : "ราคาขาย (บาท)"}</label>
                <input style={{ ...inputS, ...(kind === "SPARE_PART" ? { background: "#f7f2ea", color: MUTED } : {}) }} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required={kind === "SALE_ITEM"} disabled={kind === "SPARE_PART"} />
              </div>
              <div>
                <label style={lbl}>ต้นทุน/ชิ้น (บาท)</label>
                <input style={inputS} type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>สต๊อกคงเหลือ</label>
                <input style={inputS} type="number" value={stock} onChange={(e) => setStock(e.target.value)} required />
              </div>
              <div>
                <label style={lbl}>จุดสั่งซื้อ (เตือนใกล้หมด)</label>
                <input style={inputS} type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="0 = ไม่เตือน" />
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, background: "#f9f4ea", borderRadius: 9, padding: "8px 12px" }}>
              สาขา: <strong style={{ color: BLUE }}>{editing ? (branches.find((b) => b.id === branchId)?.name ?? "—") : (activeBranchName || "—")}</strong>
              {!editing && branches.length > 1 && <span> · สลับสาขาที่หัวจอเพื่อเพิ่มเข้าสาขาอื่น</span>}
            </div>
            <label style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
            {saveErr && <div style={{ fontSize: 13, color: "#fff", background: RED, borderRadius: 9, padding: "8px 12px" }}>{saveErr}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn(false)} onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" style={btn(true)} disabled={pending}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

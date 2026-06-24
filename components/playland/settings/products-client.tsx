"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { ShoppingBasket, PlusCircle, ArrowLeft, ImageOff } from "lucide-react";

interface Branch { id: string; name: string; }
interface Product {
  id: string; branchId: string; kind: string; name: string; barcode: string | null; sku: string | null;
  category: string | null; supplier: string | null; priceCents: number; costCents: number | null; stock: number; reorderLevel: number; active: boolean;
  imageR2Path: string | null;
}

export function ProductsClient({ branches, products, r2PublicUrl }: { branches: Branch[]; products: Product[]; r2PublicUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
    setBranchId(branches[0]?.id ?? ""); setActive(true);
    setImageR2Path(""); setImgError(null); setSaveErr(null); setShowAdvanced(false);
    setShowForm(true);
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
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland/settings" className="pl-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}><ArrowLeft size={12} /> Settings</Link>
          <h1>สินค้า POS · {products.length} {lowStock.length > 0 && <span className="pl-chip pl-chip-danger" style={{ marginLeft: 6, fontSize: 11 }}>เหลือน้อย {lowStock.length}</span>}</h1>
        </div>
        <button className="pl-btn pl-btn-primary" onClick={startNew}><PlusCircle size={14} /> เพิ่มสินค้า</button>
      </header>

      <div style={{ padding: 16, display: "grid", gridTemplateColumns: showForm ? "1fr 380px" : "1fr", gap: 16 }}>
        <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="pl-table">
            <thead><tr><th>รูป</th><th>ชื่อ</th><th>Barcode</th><th>หมวด</th><th>ราคา</th><th>คงเหลือ</th><th>สาขา</th><th>Active</th></tr></thead>
            <tbody>
              {products.length === 0 && <tr><td colSpan={8}><div className="pl-empty"><ShoppingBasket size={28} opacity={0.4} />ยังไม่มีสินค้า</div></td></tr>}
              {products.map((p) => {
                const low = p.stock <= p.reorderLevel;
                const img = resolveImg(p.imageR2Path);
                return (
                  <tr key={p.id} onClick={() => startEdit(p)}>
                    <td>
                      {img
                        ? <img src={img} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", display: "block" }} />
                        : <span style={{ display: "inline-flex", width: 32, height: 32, borderRadius: 6, alignItems: "center", justifyContent: "center", background: "var(--pl-surface-2, rgba(0,0,0,0.04))", color: "var(--pl-text-muted)" }}><ImageOff size={14} /></span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><code style={{ fontSize: 12 }}>{p.barcode ?? "—"}</code></td>
                    <td>{p.category ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>{thb(p.priceCents)}</td>
                    <td style={{ color: low ? "var(--pl-danger)" : "inherit", fontWeight: low ? 600 : 400 }}>{p.stock}</td>
                    <td>{branches.find((b) => b.id === p.branchId)?.name ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {p.active ? <span className="pl-chip pl-chip-ok">ใช้</span> : <span className="pl-chip pl-chip-muted">ปิด</span>}
                        <button type="button" className="pl-btn pl-btn-sm" onClick={(e) => { e.stopPropagation(); startClone(p); }} style={{ fontSize: 11 }}>ทำซ้ำ</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {showForm && (
          <form className="pl-card" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <div className="pl-eyebrow">{editing ? "แก้สินค้า" : "สินค้าใหม่"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="pl-btn" onClick={() => setKind("SALE_ITEM")} style={{ flex: 1, ...(kind === "SALE_ITEM" ? { background: "#2D6CB1", color: "#fff", borderColor: "#2D6CB1" } : {}) }}>🍬 สินค้าขาย (POS)</button>
              <button type="button" className="pl-btn" onClick={() => setKind("SPARE_PART")} style={{ flex: 1, ...(kind === "SPARE_PART" ? { background: "#a9791a", color: "#fff", borderColor: "#a9791a" } : {}) }}>🔧 อะไหล่ซ่อม</button>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อ *</label>
              <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>Barcode</label>
                <input className="pl-input" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="ยิง/พิมพ์บาร์โค้ด" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{kind === "SPARE_PART" ? "ประเภทอะไหล่" : "หมวด"}</label>
                <input className="pl-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={kind === "SPARE_PART" ? "มอเตอร์ / สายพาน" : "ขนม / เครื่องดื่ม"} />
              </div>
            </div>
            <button type="button" className="pl-btn pl-btn-sm" onClick={() => setShowAdvanced((v) => !v)} style={{ justifySelf: "start", fontSize: 12 }}>
              {showAdvanced ? "− ซ่อนตัวเลือกเพิ่มเติม" : "+ ตัวเลือกเพิ่มเติม (ผู้ขาย · รูป)"}
            </button>
            {showAdvanced && (<>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ผู้ขาย/ร้านค้า</label>
              <input className="pl-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ไม่บังคับ" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>รูปสินค้า</label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {resolveImg(imageR2Path)
                  ? <img src={resolveImg(imageR2Path)!} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flex: "0 0 auto" }} />
                  : <span style={{ display: "inline-flex", width: 56, height: 56, borderRadius: 8, alignItems: "center", justifyContent: "center", background: "var(--pl-surface-2, rgba(0,0,0,0.04))", color: "var(--pl-text-muted)", flex: "0 0 auto" }}><ImageOff size={18} /></span>}
                <div style={{ flex: 1, display: "grid", gap: 6 }}>
                  <input
                    className="pl-input"
                    value={imageR2Path}
                    onChange={(e) => { setImageR2Path(e.target.value); setImgError(null); }}
                    placeholder="วางลิงก์รูปจาก google ได้เลย"
                  />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label className="pl-btn" style={{ cursor: uploading ? "wait" : "pointer", fontSize: 12 }}>
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
                      <button type="button" className="pl-btn" style={{ fontSize: 12 }} onClick={() => { setImageR2Path(""); setImgError(null); }}>ลบรูป</button>
                    )}
                  </div>
                  {imgError && <span style={{ fontSize: 12, color: "var(--pl-danger)" }}>{imgError}</span>}
                </div>
              </div>
            </div>
            </>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{kind === "SPARE_PART" ? "ราคาขาย (อะไหล่ไม่ต้องใส่)" : "ราคาขาย (บาท)"}</label>
                <input className="pl-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required={kind === "SALE_ITEM"} disabled={kind === "SPARE_PART"} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ต้นทุน/ชิ้น (บาท)</label>
                <input className="pl-input" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สต๊อกคงเหลือ</label>
                <input className="pl-input" type="number" value={stock} onChange={(e) => setStock(e.target.value)} required />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>จุดสั่งซื้อ (เตือนใกล้หมด)</label>
                <input className="pl-input" type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="0 = ไม่เตือน" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>สาขา</label>
              <select className="pl-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ marginRight: 6 }} /> Active</label>
            {saveErr && <div style={{ fontSize: 13, color: "#fff", background: "var(--pl-danger)", borderRadius: 8, padding: "8px 12px" }}>{saveErr}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="pl-btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={pending}>{pending ? "บันทึก..." : "บันทึก"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

// DC · ฟอร์มสินค้า (ใช้ทั้งสร้างใหม่ + แก้ไข) — เรียก server action ผ่าน
// useTransition. สำเร็จ → เด้งกลับหน้ารายการสินค้า. โชว์ error เป็นภาษาไทย.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createProduct,
  updateProduct,
  type CreateProductInput,
} from "@/lib/dc/product-actions";
import { lookupBarcodeInfo } from "@/lib/dc/barcode-lookup";
import { DcProductType } from "@/lib/generated/prisma/enums";
import { PRODUCT_TYPE_LABEL } from "@/lib/dc/nav";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DcProductPhotoButton } from "@/components/dc/product-photo-button";

export type ProductFormValues = {
  id?: string;
  sku: string;
  name: string;
  barcode: string;
  type: DcProductType;
  unit: string;
  category: string;
  reorderPoint: string; // เก็บเป็นสตริงในฟอร์ม → แปลงตอน submit
  imageR2Path: string;
};

const EMPTY: ProductFormValues = {
  sku: "",
  name: "",
  barcode: "",
  type: DcProductType.SALE,
  unit: "ชิ้น",
  category: "",
  reorderPoint: "",
  imageR2Path: "",
};

const TYPE_OPTIONS: DcProductType[] = [DcProductType.SALE, DcProductType.SPARE];

export function ProductForm({ initial }: { initial?: ProductFormValues }) {
  const router = useRouter();
  const isEdit = !!initial?.id;
  const [values, setValues] = useState<ProductFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // "🔍 ดึงข้อมูล" จากบาร์โค้ด (Open Food Facts · ฟรี) — เติมชื่อ+รูปให้ตอนลงของใหม่
  const [looking, setLooking] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<{ tone: "ok" | "warn" | "info"; text: string } | null>(null);
  const lastLookupRef = useRef<string>(""); // กันค้นซ้ำรหัสเดิม (ทั้งปุ่มและ auto-fire)

  function set<K extends keyof ProductFormValues>(key: K, v: ProductFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleLookup() {
    const code = values.barcode.trim();
    if (!code) {
      setLookupMsg({ tone: "warn", text: "ใส่เลขบาร์โค้ดก่อน แล้วกดดึงข้อมูล" });
      return;
    }
    lastLookupRef.current = code;
    setLooking(true);
    setLookupMsg({ tone: "info", text: "กำลังค้นหาจากฐานข้อมูลสินค้าโลก…" });
    const r = await lookupBarcodeInfo(code);
    setLooking(false);
    if (!r.found) {
      setLookupMsg({
        tone: "warn",
        text:
          r.reason === "invalid"
            ? "เลขนี้ไม่ใช่บาร์โค้ดสากล (ต้องเป็นตัวเลข 8/12/13 หลัก) — กรอกชื่อเอง"
            : "ไม่พบในฐานสาธารณะ — กรอกเอง (ปกติสำหรับของนำเข้าจีน/อะไหล่)",
      });
      return;
    }
    // เติมเฉพาะช่องที่ยังว่าง → ไม่ทับข้อมูลที่ผู้ใช้กรอกไว้เอง
    setValues((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : r.name,
      imageR2Path: prev.imageR2Path.trim() ? prev.imageR2Path : r.imageUrl ?? prev.imageR2Path,
    }));
    setLookupMsg({
      tone: "ok",
      text: `พบ: ${r.name || "(ไม่มีชื่อในฐาน)"}${r.brand ? ` · ${r.brand}` : ""} — เติมให้แล้ว ตรวจ/แก้ได้`,
    });
  }

  // ยิงปุ๊บเด้งเอง: พอบาร์โค้ดเป็น EAN ครบหลัก + ยังไม่มีชื่อ → ค้นให้อัตโนมัติ (debounce กันยิงถี่)
  useEffect(() => {
    const code = values.barcode.trim();
    if (isEdit) return; // แก้ไขของเดิม ไม่ต้อง auto ค้น
    if (values.name.trim()) return; // มีชื่อแล้ว ไม่ทับ (กดปุ่ม 🔍 เองได้ถ้าอยากค้นซ้ำ)
    if (!/^(\d{8}|\d{12,14})$/.test(code)) return;
    if (code === lastLookupRef.current) return;
    const t = setTimeout(() => { void handleLookup(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.barcode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const reorderRaw = values.reorderPoint.trim();
    const payload: CreateProductInput = {
      sku: values.sku,
      name: values.name,
      barcode: values.barcode,
      type: values.type,
      unit: values.unit,
      category: values.category,
      reorderPoint: reorderRaw === "" ? null : Number(reorderRaw),
      imageR2Path: values.imageR2Path,
    };

    if (reorderRaw !== "" && Number.isNaN(Number(reorderRaw))) {
      setError("จุดสั่งซื้อซ้ำ ต้องเป็นตัวเลข");
      return;
    }

    startTransition(async () => {
      const res =
        isEdit && initial?.id
          ? await updateProduct(initial.id, payload)
          : await createProduct(payload);
      if (res.ok) {
        router.push("/dc/office/products");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="dc-card" style={{ maxWidth: 640 }}>
      <div style={{ display: "grid", gap: 16 }}>
        <Field label="รหัสสินค้า (SKU)" required htmlFor="sku">
          <Input
            id="sku"
            value={values.sku}
            onChange={(e) => set("sku", e.target.value)}
            placeholder="เช่น SNK-001"
            autoComplete="off"
          />
        </Field>

        <Field label="ชื่อสินค้า" required htmlFor="name">
          <Input
            id="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="เช่น เลย์ รสออริจินอล"
            autoComplete="off"
          />
        </Field>

        <Field label="ประเภท" required>
          <div style={{ display: "flex", gap: 8 }}>
            {TYPE_OPTIONS.map((t) => {
              const active = values.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("type", t)}
                  aria-pressed={active}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    borderRadius: 12,
                    border: active
                      ? "2px solid var(--color-brand-600)"
                      : "1px solid var(--dc-line, #e4e4e7)",
                    background: active ? "var(--color-brand-50, #eef4ff)" : "#fff",
                    color: active ? "var(--color-brand-700)" : "#3f3f46",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: "pointer",
                  }}
                >
                  {PRODUCT_TYPE_LABEL[t] ?? t}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="บาร์โค้ด" optional htmlFor="barcode" hint="ยิงบาร์โค้ดโรงงานแล้วกด 🔍 ให้ระบบลองเดาชื่อ+รูปให้">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <Input
                id="barcode"
                value={values.barcode}
                onChange={(e) => { set("barcode", e.target.value); setLookupMsg(null); }}
                onKeyDown={(e) => {
                  // ปืนยิงเสร็จส่ง Enter → กันฟอร์ม submit ก่อนเวลา + สั่งค้นข้อมูลแทน
                  if (e.key === "Enter") { e.preventDefault(); void handleLookup(); }
                }}
                placeholder="เช่น 8851234567890"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleLookup} loading={looking} disabled={looking}>
              🔍 ดึงข้อมูล
            </Button>
          </div>
          {lookupMsg && (
            <p
              style={{
                marginTop: 6,
                fontSize: 13,
                fontWeight: 600,
                color: lookupMsg.tone === "ok" ? "#16a34a" : lookupMsg.tone === "warn" ? "#b45309" : "#6b7280",
              }}
            >
              {lookupMsg.text}
            </p>
          )}
        </Field>

        <Field label="หน่วยนับ" htmlFor="unit">
          <Input
            id="unit"
            value={values.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="ชิ้น"
            autoComplete="off"
          />
        </Field>

        <Field label="หมวดหมู่" optional htmlFor="category">
          <Input
            id="category"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="เช่น ขนม / เครื่องดื่ม / อะไหล่"
            autoComplete="off"
          />
        </Field>

        <Field
          label="จุดสั่งซื้อซ้ำ (Reorder point)"
          optional
          hint="เหลือต่ำกว่านี้ → ควรสั่งเพิ่ม"
          htmlFor="reorderPoint"
        >
          <Input
            id="reorderPoint"
            value={values.reorderPoint}
            onChange={(e) => set("reorderPoint", e.target.value)}
            placeholder="เช่น 24"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <Field
          label="รูปสินค้า"
          optional
          hint="ถ่ายรูป หรือวางลิงก์"
          htmlFor="imageR2Path"
        >
          <div style={{ marginBottom: 8 }}>
            <DcProductPhotoButton onUploaded={(url) => set("imageR2Path", url)} />
          </div>
          <Input
            id="imageR2Path"
            value={values.imageR2Path}
            onChange={(e) => set("imageR2Path", e.target.value)}
            placeholder="https://… หรือ path ใน R2"
            autoComplete="off"
          />
          {values.imageR2Path.trim().startsWith("http") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={values.imageR2Path}
              alt="ตัวอย่างรูปสินค้า"
              style={{ marginTop: 8, width: 96, height: 96, objectFit: "cover", borderRadius: 10, border: "1px solid var(--dc-line, #e4e4e7)" }}
            />
          )}
        </Field>

        {error && (
          <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <Button type="submit" size="lg" loading={pending} className="flex-1">
            {isEdit ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => router.push("/dc/office/products")}
            disabled={pending}
          >
            ยกเลิก
          </Button>
        </div>
      </div>
    </form>
  );
}

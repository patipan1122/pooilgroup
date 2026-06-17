"use client";

// ClawHub admin — create / edit a reward (ตุ๊กตา). Image can be uploaded directly to
// R2 (presigned PUT from getRewardImageUploadUrlAction) OR pasted as a URL. blank
// stock = unlimited. Also offers a "เลือกจากสินค้า ClawFleet" picker (read-only
// CfProduct list) that prefills name/sku/image.

import { useState, useTransition } from "react";
import {
  createRewardAction,
  updateRewardAction,
  getRewardImageUploadUrlAction,
} from "../_actions";

export type RewardFormValue = {
  id?: string;
  name: string;
  imageUrl: string;
  pointsPrice: number;
  stock: number | null;
  isActive: boolean;
  sortOrder: number;
  sku: string;
  productId: string;
};

export type CfProductOption = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
};

const EMPTY: RewardFormValue = {
  name: "",
  imageUrl: "",
  pointsPrice: 1,
  stock: null,
  isActive: true,
  sortOrder: 0,
  sku: "",
  productId: "",
};

export function RewardEditorButton({
  initial,
  cfProducts,
  label,
  ghost,
}: {
  initial?: RewardFormValue;
  cfProducts: CfProductOption[];
  label: string;
  ghost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`cw-btn ${ghost ? "cw-btn-ghost" : ""}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <RewardEditorModal
          initial={initial}
          cfProducts={cfProducts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RewardEditorModal({
  initial,
  cfProducts,
  onClose,
}: {
  initial?: RewardFormValue;
  cfProducts: CfProductOption[];
  onClose: () => void;
}) {
  const [v, setV] = useState<RewardFormValue>(initial ?? EMPTY);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!initial?.id;

  function set<K extends keyof RewardFormValue>(k: K, val: RewardFormValue[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }

  async function onPickFile(file: File) {
    setErr(null);
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const res = await getRewardImageUploadUrlAction({ contentType: file.type, ext });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const put = await fetch(res.url, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) {
        setErr("อัปโหลดรูปไม่สำเร็จ");
        return;
      }
      set("imageUrl", res.publicUrl);
    } catch {
      setErr("อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setErr(null);
    start(async () => {
      const payload = {
        ...(isEdit ? { id: initial!.id } : {}),
        name: v.name,
        imageUrl: v.imageUrl,
        pointsPrice: v.pointsPrice,
        stock: v.stock === null ? "" : v.stock,
        isActive: v.isActive,
        sortOrder: v.sortOrder,
        sku: v.sku,
        productId: v.productId,
      };
      const res = isEdit
        ? await updateRewardAction(payload)
        : await createRewardAction(payload);
      if (res.ok) onClose();
      else setErr(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        className="cw-card max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-[var(--cw-radius)]"
        style={{ background: "var(--cw-bg-2)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="cw-title text-lg">{isEdit ? "แก้ไขตุ๊กตา" : "เพิ่มตุ๊กตา"}</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--cw-text-3)" }}>
            ปิด
          </button>
        </div>

        {/* ClawFleet picker */}
        {cfProducts.length > 0 ? (
          <label className="mb-3 block">
            <span className="text-xs font-semibold" style={{ color: "var(--cw-text-2)" }}>
              เลือกจากสินค้า ClawFleet (เติมชื่อ/SKU/รูปให้)
            </span>
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--cw-border)" }}
              value={v.productId}
              onChange={(e) => {
                const p = cfProducts.find((x) => x.id === e.target.value);
                if (p) {
                  setV((prev) => ({
                    ...prev,
                    productId: p.id,
                    sku: p.sku,
                    name: prev.name || p.name,
                    imageUrl: prev.imageUrl || (p.imageUrl ?? ""),
                  }));
                } else {
                  set("productId", "");
                }
              }}
            >
              <option value="">— ไม่เลือก —</option>
              {cfProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Field label="ชื่อตุ๊กตา *">
          <input
            className="cw-input"
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="เช่น หมีบราวน์ตัวใหญ่"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ราคาแต้ม *">
            <input
              type="number"
              min={1}
              className="cw-input cw-tnum"
              value={v.pointsPrice}
              onChange={(e) => set("pointsPrice", Number(e.target.value))}
            />
          </Field>
          <Field label="สต็อก (เว้นว่าง = ไม่จำกัด)">
            <input
              type="number"
              min={0}
              className="cw-input cw-tnum"
              value={v.stock ?? ""}
              onChange={(e) =>
                set("stock", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="ไม่จำกัด"
            />
          </Field>
        </div>

        <Field label="รูปภาพ">
          <div className="flex items-center gap-3">
            {v.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.imageUrl}
                alt="ตัวอย่าง"
                className="h-16 w-16 rounded-lg border object-cover"
                style={{ borderColor: "var(--cw-border)" }}
              />
            ) : null}
            <label className="cw-btn cw-btn-ghost cursor-pointer">
              {uploading ? "กำลังอัป…" : "อัปโหลดรูป"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                }}
              />
            </label>
          </div>
          <input
            className="cw-input mt-2"
            value={v.imageUrl}
            onChange={(e) => set("imageUrl", e.target.value)}
            placeholder="หรือวาง URL รูปภาพ"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ลำดับการแสดง">
            <input
              type="number"
              className="cw-input cw-tnum"
              value={v.sortOrder}
              onChange={(e) => set("sortOrder", Number(e.target.value))}
            />
          </Field>
          <Field label="SKU (ไม่บังคับ)">
            <input className="cw-input" value={v.sku} onChange={(e) => set("sku", e.target.value)} />
          </Field>
        </div>

        <label className="mb-3 mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          เปิดให้แลก (active)
        </label>

        {err ? (
          <p className="mb-2 text-sm font-semibold" style={{ color: "var(--cw-danger)" }}>
            {err}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="cw-btn cw-btn-ghost" onClick={onClose} disabled={pending}>
            ยกเลิก
          </button>
          <button type="button" className="cw-btn" onClick={save} disabled={pending || uploading}>
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>

      <style jsx>{`
        :global(.clawhub-scope .cw-input) {
          width: 100%;
          border: 1px solid var(--cw-border);
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 14px;
          background: var(--cw-surface);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="text-xs font-semibold" style={{ color: "var(--cw-text-2)" }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

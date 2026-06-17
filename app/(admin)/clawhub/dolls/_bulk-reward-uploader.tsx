"use client";

// ClawHub admin — bulk add rewards (ตุ๊กตา) by picking MANY images at once. Each
// image is compressed client-side and uploaded THROUGH the server individually
// (uploadRewardImageAction — small per-call payload, no CORS), giving each row an
// editable name / points / stock. "บันทึกทั้งหมด" then creates them all in one
// round-trip (createRewardsBulkAction). Default points = 25, stock = unlimited.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/components/clawhub/customer/image-compress";
import { uploadRewardImageAction, createRewardsBulkAction } from "../_actions";

const DEFAULT_POINTS = 25;

type RowStatus = "uploading" | "done" | "error";

type Row = {
  id: string;
  name: string;
  pointsPrice: number;
  stock: number | null;
  imageUrl: string;
  previewUrl: string;
  status: RowStatus;
  error?: string;
};

export function BulkRewardUploaderButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="cw-btn cw-btn-ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <BulkRewardUploaderModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BulkRewardUploaderModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const counter = useRef(0);

  function patch(id: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function uploadOne(file: File, id: string) {
    try {
      const { base64, mimeType, previewUrl } = await compressImage(file);
      patch(id, { previewUrl });
      const res = await uploadRewardImageAction({ base64, mimeType, ext: "jpg" });
      if (!res.ok) {
        patch(id, { status: "error", error: res.error });
        return;
      }
      patch(id, { imageUrl: res.publicUrl, status: "done" });
    } catch {
      patch(id, { status: "error", error: "อัปโหลดรูปไม่สำเร็จ" });
    }
  }

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    const start = rows.length;
    const picked = Array.from(files);
    const incoming: Row[] = picked.map((_file, i) => ({
      id: `r${counter.current++}`,
      name: `ตุ๊กตา ${start + i + 1}`,
      pointsPrice: DEFAULT_POINTS,
      stock: null,
      imageUrl: "",
      previewUrl: "",
      status: "uploading",
    }));
    setRows((prev) => [...prev, ...incoming]);
    picked.forEach((file, i) => void uploadOne(file, incoming[i].id));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function saveAll() {
    setErr(null);
    if (rows.some((r) => r.status === "uploading")) {
      setErr("รอรูปอัปให้เสร็จก่อนครับ");
      return;
    }
    const ready = rows.filter((r) => r.status === "done" && r.imageUrl);
    if (ready.length === 0) {
      setErr("ยังไม่มีรูปที่อัปสำเร็จ");
      return;
    }
    if (ready.some((r) => !r.name.trim())) {
      setErr("ทุกตัวต้องมีชื่อ");
      return;
    }
    startSave(async () => {
      const res = await createRewardsBulkAction({
        items: ready.map((r) => ({
          name: r.name.trim(),
          imageUrl: r.imageUrl,
          pointsPrice: r.pointsPrice,
          stock: r.stock === null ? "" : r.stock,
        })),
      });
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setErr(res.error);
      }
    });
  }

  const doneCount = rows.filter((r) => r.status === "done").length;
  const busy = rows.some((r) => r.status === "uploading");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        className="cw-card max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-[var(--cw-radius)]"
        style={{ background: "var(--cw-bg-2)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="cw-title text-lg">เพิ่มหลายตัว (อัปหลายรูป)</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--cw-text-3)" }}>
            ปิด
          </button>
        </div>
        <p className="mb-3 text-xs" style={{ color: "var(--cw-text-3)" }}>
          เลือกได้หลายรูปพร้อมกัน · แก้ชื่อ/ราคา/สต็อกแต่ละตัวได้ · เว้นสต็อกว่าง = ไม่จำกัด
        </p>

        <label className="cw-btn cw-btn-ghost mb-3 inline-flex cursor-pointer">
          + เลือกรูป (หลายรูปได้)
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {rows.length === 0 ? (
          <div
            className="mb-3 rounded-lg border border-dashed px-4 py-8 text-center text-sm"
            style={{ borderColor: "var(--cw-border)", color: "var(--cw-text-3)" }}
          >
            ยังไม่ได้เลือกรูป — กด “เลือกรูป” แล้วเลือกหลายรูปทีเดียวได้
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border p-2"
                style={{ borderColor: "var(--cw-border)" }}
              >
                <div className="relative h-14 w-14 shrink-0">
                  {r.previewUrl || r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.imageUrl || r.previewUrl}
                      alt={r.name}
                      className="h-14 w-14 rounded-lg border object-cover"
                      style={{ borderColor: "var(--cw-border)", opacity: r.status === "done" ? 1 : 0.5 }}
                    />
                  ) : (
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-lg border text-[10px]"
                      style={{ borderColor: "var(--cw-border)", color: "var(--cw-text-3)" }}
                    >
                      …
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <input
                    className="cw-input w-full"
                    value={r.name}
                    placeholder="ชื่อตุ๊กตา"
                    onChange={(e) => patch(r.id, { name: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--cw-text-2)" }}>
                      แต้ม
                      <input
                        type="number"
                        min={1}
                        className="cw-input cw-tnum w-20"
                        value={r.pointsPrice}
                        onChange={(e) => patch(r.id, { pointsPrice: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--cw-text-2)" }}>
                      สต็อก
                      <input
                        type="number"
                        min={0}
                        placeholder="∞"
                        className="cw-input cw-tnum w-20"
                        value={r.stock ?? ""}
                        onChange={(e) =>
                          patch(r.id, { stock: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </label>
                    <span className="text-xs" style={{ color: r.status === "error" ? "var(--cw-danger)" : "var(--cw-text-3)" }}>
                      {r.status === "uploading" ? "กำลังอัป…" : r.status === "error" ? (r.error ?? "อัปไม่สำเร็จ") : "พร้อม ✓"}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className="shrink-0 text-sm"
                  style={{ color: "var(--cw-text-3)" }}
                  aria-label="ลบแถวนี้"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {err ? (
          <p className="mb-2 text-sm font-semibold" style={{ color: "var(--cw-danger)" }}>
            {err}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs" style={{ color: "var(--cw-text-3)" }}>
            พร้อมบันทึก {doneCount}/{rows.length} ตัว
          </span>
          <div className="flex gap-2">
            <button type="button" className="cw-btn cw-btn-ghost" onClick={onClose} disabled={saving}>
              ยกเลิก
            </button>
            <button type="button" className="cw-btn" onClick={saveAll} disabled={saving || busy || doneCount === 0}>
              {saving ? "กำลังบันทึก…" : `บันทึกทั้งหมด (${doneCount})`}
            </button>
          </div>
        </div>

        <style jsx>{`
          :global(.clawhub-scope .cw-input) {
            border: 1px solid var(--cw-border);
            border-radius: 10px;
            padding: 6px 10px;
            font-size: 14px;
            background: var(--cw-surface);
          }
        `}</style>
      </div>
    </div>
  );
}

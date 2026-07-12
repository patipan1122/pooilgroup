"use client";

// =============================================================
// ClawFleet · นำเข้าเก็บเงิน/เติมตุ๊กตา — พรีวิว + ยืนยัน (client · เฟส 1)
// =============================================================
// UX 2 ขั้น: เลือกไฟล์ → previewCollectionsFile() แยกทุกแถวเป็น พร้อม/ซ้ำ/ผิด
// แล้วโชว์ตารางให้ตรวจ. ปุ่มยืนยันบันทึกจริงเปิดในเฟสถัดไป (ยังไม่เขียน DB ในเฟสนี้).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { previewCollectionsFile } from "./actions";
import type { PreviewRow, PreviewResult } from "./types";

const KIND_TONE: Record<
  PreviewRow["kind"],
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  ready: { label: "พร้อมบันทึก", tone: "success" },
  dedup: { label: "ซ้ำ · ข้าม", tone: "warning" },
  invalid: { label: "ไม่ผ่าน", tone: "danger" },
};

interface PreviewState extends PreviewResult {
  filename: string;
}

export function ClawImportShell() {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);

  function onUpload(formData: FormData) {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const res = await previewCollectionsFile(formData);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      const file = formData.get("file");
      const name = file instanceof File ? file.name : "ไฟล์";
      setPreview({ ...res, filename: name });
      toast.success(
        `อ่านไฟล์เรียบร้อย · ${res.counts.ready} แถวพร้อม · ${res.counts.dedup} ซ้ำ · ${res.counts.invalid} ผิด`,
      );
    });
  }

  function onCancel() {
    setPreview(null);
    setError(null);
    setFilename(null);
  }

  return (
    <section className="space-y-3">
      <form action={onUpload} className="space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-zinc-800">
            เลือกไฟล์ (.xlsx หรือ .csv)
          </label>
          <Input
            type="file"
            name="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            disabled={isPending}
            className="h-12 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {filename ? `เลือกไฟล์: ${filename}` : "รับ .xlsx (Excel) และ .csv · ขนาดไม่เกิน 5MB"}
          </p>
        </div>
        <Button type="submit" disabled={isPending} size="lg">
          {isPending && !preview ? "กำลังอ่านไฟล์…" : "ขั้นถัดไป → ดูพรีวิว"}
        </Button>
      </form>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs text-zinc-500">{preview.filename}</p>
              <p className="text-sm font-semibold text-zinc-900">
                พรีวิว · {preview.counts.total} แถว · {preview.counts.machines} ตู้ ·{" "}
                {preview.counts.days} วัน
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone="success">พร้อม {preview.counts.ready}</Badge>
              <Badge tone="warning">ซ้ำ {preview.counts.dedup}</Badge>
              <Badge tone="danger">ผิด {preview.counts.invalid}</Badge>
            </div>
          </header>

          {preview.counts.initial > 0 ? (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              ในนี้มี <strong>{preview.counts.initial}</strong> แถวเป็น{" "}
              <strong>“ตั้งค่าครั้งแรก”</strong> (ตู้ที่ยังไม่เคยมีข้อมูล วันเก่าสุดของตู้นั้น) ·{" "}
              {preview.counts.collection} แถวเป็นการเก็บปกติ
            </div>
          ) : null}

          <div className="max-h-[60vh] overflow-auto rounded-md border border-zinc-100">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">สถานะ</th>
                  <th className="px-2 py-1.5">สาขา · ตู้</th>
                  <th className="px-2 py-1.5">วันที่</th>
                  <th className="px-2 py-1.5">ประเภท</th>
                  <th className="px-2 py-1.5 text-right">มิเตอร์เงิน</th>
                  <th className="px-2 py-1.5 text-right">เงิน (บาท)</th>
                  <th className="px-2 py-1.5 text-right">ตุ๊กตา ก่อน/เติม/หลัง</th>
                  <th className="px-2 py-1.5">หมายเหตุ / ข้อผิดพลาด</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const meta = KIND_TONE[r.kind];
                  return (
                    <tr
                      key={r.rowIndex}
                      className={
                        "border-t border-zinc-100 " +
                        (r.kind === "invalid"
                          ? "bg-rose-50/40"
                          : r.kind === "dedup"
                            ? "bg-amber-50/40"
                            : "")
                      }
                    >
                      <td className="px-2 py-1.5 tabular-nums text-zinc-500">{r.rowIndex}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-zinc-800">{(r.branchName ?? r.branchInput) || "—"}</div>
                        <div className="text-[10px] text-zinc-500">
                          {(r.machineCode ?? r.machineInput) || "—"}
                          {r.machineNickname ? ` · ${r.machineNickname}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{(r.date ?? r.dateInput) || "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.kind === "ready" ? (
                          r.entryType === "INITIAL" ? (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              ตั้งค่าครั้งแรก
                            </span>
                          ) : (
                            <span className="text-zinc-500">เก็บปกติ</span>
                          )
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.coinMeterUsed != null ? r.coinMeterUsed.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                        {r.cashBaht != null ? r.cashBaht.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                        {r.stockBefore ?? "—"} / {r.refillQty ?? "—"} / {r.stockAfter ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-600">
                        {r.errors.length > 0 || r.warnings.length > 0 ? (
                          <ul className="list-disc pl-3">
                            {r.errors.map((e, i) => (
                              <li key={`e${i}`} className="text-rose-700">
                                {e}
                              </li>
                            ))}
                            {r.warnings.map((w, i) => (
                              <li key={`w${i}`} className="text-amber-700">
                                ⚠ {w}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              ✅ นี่คือหน้าพรีวิว · <strong>ยังไม่บันทึกลงระบบ</strong> ตรวจตัวเลขให้ครบก่อน
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
                ยกเลิก
              </Button>
              <Button type="button" size="lg" disabled title="เปิดในเฟสถัดไป">
                ยืนยันบันทึกจริง (กำลังทำต่อ)
              </Button>
            </div>
          </footer>
        </div>
      ) : null}
    </section>
  );
}

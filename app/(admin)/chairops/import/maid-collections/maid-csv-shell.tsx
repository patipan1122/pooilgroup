"use client";

// =============================================================
// F1 · CSV import preview + commit shell (client)
// =============================================================
// Two-step UX:
//   1. user picks file → previewMaidCsv() classifies every row
//      into ready / dedup / invalid
//   2. user reviews → presses ยืนยัน → commitMaidCsv() writes rows + revalidates
//
// We keep the preview entirely in client state (no DB row created until
// commit) so the CEO can cancel without leaving cruft. Diff schema matches
// pos-ingest preview convention so any future "Daily Maid Ingest" report can
// reuse the same UI patterns.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { previewMaidCsv, commitMaidCsv } from "./actions";
import type { PreviewRow } from "./types";

const KIND_TONE: Record<
  PreviewRow["kind"],
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  ready: { label: "พร้อมบันทึก", tone: "success" },
  dedup: { label: "ซ้ำ · ข้าม", tone: "warning" },
  invalid: { label: "ไม่ผ่าน", tone: "danger" },
};

interface PreviewState {
  rows: PreviewRow[];
  counts: { ready: number; dedup: number; invalid: number; total: number };
  payload: string;
  /** HMAC signature returned by previewMaidCsv · required at commit. */
  payloadSig: string;
  filename: string;
}

export function MaidCsvShell() {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);

  function onUpload(formData: FormData) {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const res = await previewMaidCsv(formData);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      const file = formData.get("file");
      const name = file instanceof File ? file.name : "csv";
      setPreview({ ...res, filename: name });
      toast.success(
        `อ่านไฟล์เรียบร้อย · ${res.counts.ready} แถวพร้อม · ${res.counts.dedup} ซ้ำ · ${res.counts.invalid} ผิด`,
      );
    });
  }

  function onCommit() {
    if (!preview) return;
    if (preview.counts.ready === 0) {
      toast.error("ไม่มีแถวที่จะ commit");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await commitMaidCsv(
        preview.payload,
        preview.counts.dedup,
        preview.payloadSig,
      );
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      // BA-01 / QA-02 (2026-06-03) · surface the TOCTOU-skipped delta so the
      // CEO sees "พร้อม 47 · เขียนจริง 45 · ข้ามตอน commit 2" visibly when
      // a race collapsed concurrent imports.
      if (res.skippedAtCommit > 0) {
        toast.warning(
          `บันทึก ${res.committed} แถว · ข้ามอีก ${res.skippedAtCommit} แถว (ซ้ำจากการ import พร้อมกัน)`,
        );
      } else {
        toast.success(`บันทึก ${res.committed} แถว`);
      }
      setPreview(null);
      router.push(
        `/chairops/import/maid-collections?committed=${res.committed}&dedup=${res.dedup}&skipped=${res.skippedAtCommit}`,
      );
      router.refresh();
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
            เลือกไฟล์ CSV
          </label>
          <Input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            disabled={isPending}
            className="h-12 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {filename
              ? `เลือกไฟล์: ${filename}`
              : "รับเฉพาะ .csv · ขนาดไม่เกิน 5MB"}
          </p>
        </div>
        <Button type="submit" disabled={isPending} size="lg">
          {isPending && !preview ? "กำลังอ่านไฟล์…" : "ขั้นถัดไป → ดู preview"}
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
                Preview · {preview.counts.total} แถว
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone="success">พร้อม {preview.counts.ready}</Badge>
              <Badge tone="warning">ซ้ำ {preview.counts.dedup}</Badge>
              <Badge tone="danger">ผิด {preview.counts.invalid}</Badge>
            </div>
          </header>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-zinc-100">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">สถานะ</th>
                  <th className="px-2 py-1.5">สาขา</th>
                  <th className="px-2 py-1.5">เวลา</th>
                  <th className="px-2 py-1.5 text-right">นับได้</th>
                  <th className="px-2 py-1.5">แม่บ้าน</th>
                  <th className="px-2 py-1.5">หมายเหตุ / error</th>
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
                      <td className="px-2 py-1.5 tabular-nums text-zinc-500">
                        {r.rowIndex}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-zinc-800">
                          {r.branchName ?? "—"}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {r.branchSlug || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {r.collectedAt ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.countedAmount != null
                          ? r.countedAmount.toLocaleString("en-US")
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">{r.maidLabel ?? "—"}</td>
                      <td className="px-2 py-1.5 text-zinc-600">
                        {r.errors.length > 0 ? (
                          <ul className="list-disc pl-3">
                            {r.errors.map((e, i) => (
                              <li key={i}>{e}</li>
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
          <footer className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isPending}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={onCommit}
              disabled={isPending || preview.counts.ready === 0}
              size="lg"
            >
              {isPending
                ? "กำลังบันทึก…"
                : `ยืนยัน · บันทึก ${preview.counts.ready} แถว`}
            </Button>
          </footer>
        </div>
      ) : null}
    </section>
  );
}

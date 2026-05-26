"use client";

// PanelImport — bulk CSV import for machines (P0 from brief).
// Three-step flow per [[pool-csv-import-must-diff-before-write]] memory:
//   1) upload CSV
//   2) parse + diff vs existing machines (new / changed / same counts)
//   3) confirm + write
// Real action is stubbed — see TODO[claude-design].

import { useMemo, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  CircleCheck,
  CircleX,
  AlertTriangle,
  Download,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Machine {
  id: string;
  code: string;
  kind: "CLAW" | "EXCHANGER";
  branchName: string;
  isActive: boolean;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export interface PanelImportProps {
  machines: Machine[];
  branches: Branch[];
}

type Step = "upload" | "diff" | "done";

interface ParsedRow {
  code: string;
  kind: "CLAW" | "EXCHANGER" | "?";
  branchCode: string;
  nickname: string;
  rawLine: number;
  error?: string;
}

interface DiffSummary {
  newRows: ParsedRow[];
  changedRows: { row: ParsedRow; before: Machine }[];
  sameRows: { row: ParsedRow; before: Machine }[];
  invalidRows: ParsedRow[];
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  // skip header if present
  const header = lines[0].toLowerCase();
  const dataLines = /code|kind|branch/.test(header) ? lines.slice(1) : lines;
  return dataLines.map((line, idx) => {
    const cols = line.split(",").map((c) => c.trim());
    const [code, kind, branchCode, nickname = ""] = cols;
    const rawLine = idx + (/code|kind|branch/.test(header) ? 2 : 1);
    if (!code) {
      return {
        code: "",
        kind: "?",
        branchCode: branchCode ?? "",
        nickname,
        rawLine,
        error: "ขาด code",
      };
    }
    if (kind !== "CLAW" && kind !== "EXCHANGER") {
      return {
        code,
        kind: "?",
        branchCode: branchCode ?? "",
        nickname,
        rawLine,
        error: `kind ต้องเป็น CLAW หรือ EXCHANGER (ได้ "${kind ?? ""}")`,
      };
    }
    if (!branchCode) {
      return {
        code,
        kind,
        branchCode: "",
        nickname,
        rawLine,
        error: "ขาด branch_code",
      };
    }
    return { code, kind, branchCode, nickname, rawLine };
  });
}

function buildDiff(rows: ParsedRow[], machines: Machine[]): DiffSummary {
  const byCode = new Map(machines.map((m) => [m.code.toLowerCase(), m]));
  const newRows: ParsedRow[] = [];
  const changedRows: { row: ParsedRow; before: Machine }[] = [];
  const sameRows: { row: ParsedRow; before: Machine }[] = [];
  const invalidRows: ParsedRow[] = [];
  for (const r of rows) {
    if (r.error) {
      invalidRows.push(r);
      continue;
    }
    const before = byCode.get(r.code.toLowerCase());
    if (!before) {
      newRows.push(r);
      continue;
    }
    const changed = before.kind !== r.kind; // ignore branch/nickname for shallow diff
    if (changed) changedRows.push({ row: r, before });
    else sameRows.push({ row: r, before });
  }
  return { newRows, changedRows, sameRows, invalidRows };
}

export function PanelImport({ machines, branches }: PanelImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);

  const diff = useMemo<DiffSummary | null>(
    () => (rows.length ? buildDiff(rows, machines) : null),
    [rows, machines],
  );

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      setFileName(file.name);
      setRows(parseCsv(text));
      setStep("diff");
    };
    reader.readAsText(file);
  }

  function reset() {
    setStep("upload");
    setFileName("");
    setRows([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function confirmImport() {
    // TODO[claude-design]: real action requires importMachinesCsv server action
    // (audit doc §9.2 · uses createMachine in a loop wrapped in tx + audit row)
    alert(
      `Bulk import ยังไม่พร้อม · กำลังพัฒนา · Phase 1.5\n\nจะนำเข้า: ${diff?.newRows.length ?? 0} ตู้ใหม่ · อัปเดต ${diff?.changedRows.length ?? 0} ตู้`,
    );
    setStep("done");
  }

  function downloadTemplate() {
    // TODO[claude-design]: serve real template from /api/clawfleet/csv-template
    const sample = [
      "code,kind,branch_code,nickname",
      "CLAW-001,CLAW,BR01,ตู้คีบหน้าร้าน",
      "CLAW-002,CLAW,BR01,ตู้คีบกลาง",
      "EXCH-001,EXCHANGER,BR01,ตู้แลกหน้าร้าน",
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clawfleet-machines-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Stepper header */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Upload className="size-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-zinc-900">นำเข้า CSV</h2>
              <p className="text-sm text-zinc-500">
                เพิ่มตู้ทีละหลายเครื่อง · ตรวจ diff ก่อนเขียนเสมอ
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            <Download className="size-4" /> ดาวน์โหลด template
          </Button>
        </header>

        <Stepper step={step} />
      </section>

      {step === "upload" && (
        <section className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center shadow-sm">
          <FileSpreadsheet className="mx-auto size-10 text-zinc-300" />
          <h3 className="mt-3 text-base font-semibold text-zinc-900">
            เลือกไฟล์ CSV
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            คอลัมน์: <code>code</code> · <code>kind</code> ·{" "}
            <code>branch_code</code> · <code>nickname</code> (เลือก)
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="primary"
            className="mt-5"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" /> เลือกไฟล์
          </Button>
          <p className="mt-3 text-xs text-zinc-500">
            มีตู้ในระบบแล้ว <span className="tabular-nums">{machines.length}</span>{" "}
            ตู้ ·{" "}
            <span className="tabular-nums">{branches.length}</span> สาขา
          </p>
        </section>
      )}

      {step === "diff" && diff && (
        <>
          {/* Diff summary tiles */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DiffTile
              label="ใหม่"
              count={diff.newRows.length}
              tone="emerald"
              icon={<CircleCheck className="size-4" />}
            />
            <DiffTile
              label="เปลี่ยน"
              count={diff.changedRows.length}
              tone="amber"
              icon={<AlertTriangle className="size-4" />}
            />
            <DiffTile
              label="เหมือนเดิม"
              count={diff.sameRows.length}
              tone="zinc"
              icon={<ChevronRight className="size-4" />}
            />
            <DiffTile
              label="ผิดรูปแบบ"
              count={diff.invalidRows.length}
              tone="rose"
              icon={<CircleX className="size-4" />}
            />
          </section>

          {/* File meta + actions */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet className="size-5 text-zinc-500" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {fileName}
                </p>
                <p className="text-xs text-zinc-500">
                  <span className="tabular-nums">{rows.length}</span> แถวทั้งหมด
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                <RotateCcw className="size-4" /> เลือกไฟล์ใหม่
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={confirmImport}
                disabled={
                  diff.newRows.length + diff.changedRows.length === 0 ||
                  diff.invalidRows.length > 0
                }
              >
                ยืนยันนำเข้า (
                <span className="tabular-nums">
                  {diff.newRows.length + diff.changedRows.length}
                </span>
                )
              </Button>
            </div>
          </section>

          {diff.invalidRows.length > 0 && (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <header className="mb-3 flex items-center gap-2 text-rose-900">
                <CircleX className="size-5 text-rose-600" />
                <h3 className="text-base font-semibold">
                  แถวที่มีปัญหา ({diff.invalidRows.length})
                </h3>
              </header>
              <ul className="space-y-1.5 text-sm text-rose-800">
                {diff.invalidRows.slice(0, 10).map((r) => (
                  <li
                    key={r.rawLine}
                    className="flex items-start gap-2 rounded-lg bg-white px-3 py-2"
                  >
                    <span className="font-mono text-xs text-rose-600">
                      บรรทัด {r.rawLine}
                    </span>
                    <span>
                      <span className="font-mono">{r.code || "—"}</span>:{" "}
                      {r.error}
                    </span>
                  </li>
                ))}
                {diff.invalidRows.length > 10 && (
                  <li className="text-xs text-rose-700">
                    ยังมีอีก {diff.invalidRows.length - 10} แถว · แก้แล้วลองใหม่
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
                <h3 className="text-sm font-semibold text-zinc-900">
                  ตัวอย่าง 50 แถวแรก
                </h3>
                <p className="text-xs text-zinc-500">
                  ตรวจก่อนกด &ldquo;ยืนยันนำเข้า&rdquo;
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50">
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="px-3 py-2 font-medium">บรรทัด</th>
                      <th className="px-3 py-2 font-medium">code</th>
                      <th className="px-3 py-2 font-medium">kind</th>
                      <th className="px-3 py-2 font-medium">branch_code</th>
                      <th className="px-3 py-2 font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.slice(0, 50).map((r) => {
                      const inDiff = diff.invalidRows.includes(r)
                        ? "invalid"
                        : diff.newRows.includes(r)
                          ? "new"
                          : diff.changedRows.find((c) => c.row === r)
                            ? "changed"
                            : "same";
                      return (
                        <tr key={r.rawLine} className="hover:bg-zinc-50">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-500 tabular-nums">
                            {r.rawLine}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-900">
                            {r.code || "—"}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">{r.kind}</td>
                          <td className="px-3 py-2 text-zinc-700">
                            {r.branchCode || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusChip kind={inDiff} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {step === "done" && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
          <CircleCheck className="mx-auto size-10 text-emerald-600" />
          <h3 className="mt-3 text-base font-semibold text-emerald-900">
            ส่งคำขอนำเข้าแล้ว
          </h3>
          <p className="mt-1 text-sm text-emerald-800">
            ระบบจะเขียน + บันทึก audit log · refresh หน้าโครงสร้างเพื่อดูตู้ใหม่
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-5"
            onClick={reset}
          >
            <RotateCcw className="size-4" /> นำเข้าไฟล์ใหม่
          </Button>
        </section>
      )}
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────
function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "1 · เลือกไฟล์" },
    { key: "diff", label: "2 · ตรวจ diff" },
    { key: "done", label: "3 · นำเข้า" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                done && "bg-emerald-100 text-emerald-700",
                active && "bg-indigo-100 text-indigo-700",
                !done && !active && "bg-zinc-100 text-zinc-500",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {done && <CircleCheck className="size-3.5" />}
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="size-4 text-zinc-300" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Diff tile ───────────────────────────────────────────────
function DiffTile({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "emerald" | "amber" | "zinc" | "rose";
  icon: React.ReactNode;
}) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-600",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{count}</p>
    </div>
  );
}

// ── Status chip per row ─────────────────────────────────────
function StatusChip({
  kind,
}: {
  kind: "new" | "changed" | "same" | "invalid";
}) {
  if (kind === "new")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        ใหม่
      </span>
    );
  if (kind === "changed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        เปลี่ยน
      </span>
    );
  if (kind === "invalid")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
        ผิดรูปแบบ
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      เหมือนเดิม
    </span>
  );
}

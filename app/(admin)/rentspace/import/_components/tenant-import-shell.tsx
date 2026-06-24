"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// ── Robust CSV parser ──────────────────────────────────────────────
// Handles quoted fields with embedded commas + newlines and "" escapes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // normalize line endings
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  // flush last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Flexible header → canonical key mapping by keyword.
const HEADER_KEYWORDS: { key: string; match: (h: string) => boolean }[] = [
  { key: "ชื่อห้อง", match: (h) => /ชื่อห้อง|ห้อง|unit|room/.test(h) },
  { key: "ชื่อ-นามสกุล/ชื่อร้าน", match: (h) => /นามสกุล|ชื่อร้าน|ชื่อ.?สกุล|ผู้เช่า|ร้าน|name|tenant/.test(h) },
  { key: "เบอร์โทร", match: (h) => /เบอร์|โทร|phone|tel|mobile/.test(h) },
  { key: "วันเกิด", match: (h) => /วันเกิด|เกิด|birth|dob/.test(h) },
  { key: "สัญชาติ", match: (h) => /สัญชาติ|nation/.test(h) },
  { key: "เลขบัตรประชาชน", match: (h) => /บัตรประชาชน|บัตร.?ปชช|เลขบัตร|id.?card|citizen/.test(h) },
  { key: "ที่อยู่", match: (h) => /ที่อยู่|address|addr/.test(h) },
  { key: "อีเมล", match: (h) => /อีเมล|email|e-?mail/.test(h) },
  { key: "line id", match: (h) => /line/.test(h) },
  { key: "วันที่เข้าทำสัญญา", match: (h) => /เข้าทำสัญญา|เริ่มสัญญา|วันเริ่ม|start|begin|เข้า.?สัญญา/.test(h) },
  { key: "วันสิ้นสุดสัญญา", match: (h) => /สิ้นสุด|หมดสัญญา|วันสิ้น|end|expire|หมดอายุ/.test(h) },
];

function buildColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((raw, idx) => {
    const h = raw.trim().toLowerCase();
    if (!h) return;
    for (const { key, match } of HEADER_KEYWORDS) {
      if (map[key] === undefined && match(h)) {
        map[key] = idx;
        break;
      }
    }
  });
  return map;
}

type Row = Record<string, string>;
type Diff = {
  row: number;
  unitCode: string;
  status: "new" | "updated" | "error";
  tenant: string;
  errors: string[];
};
type ApiResult = {
  ok: boolean;
  counts: { total: number; new: number; updated: number; error: number; newUnits?: number; newContracts?: number };
  diffs: Diff[];
};

function rowsFromCsv(text: string): { rows: Row[]; mappedKeys: string[]; rawHeaders: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 1) return { rows: [], mappedKeys: [], rawHeaders: [] };
  const headers = grid[0];
  const colMap = buildColumnMap(headers);
  const mappedKeys = Object.keys(colMap);
  const rows: Row[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const obj: Row = {};
    for (const key of mappedKeys) {
      obj[key] = (cells[colMap[key]] ?? "").trim();
    }
    // skip rows with no unit + no tenant identity
    const hasUnit = (obj["ชื่อห้อง"] ?? "").trim() !== "";
    const hasName = (obj["ชื่อ-นามสกุล/ชื่อร้าน"] ?? "").trim() !== "";
    if (!hasUnit && !hasName) continue;
    rows.push(obj);
  }
  return { rows, mappedKeys, rawHeaders: headers };
}

export default function TenantImportShell() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<{ rows: Row[]; mappedKeys: string[] } | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [committing, startCommit] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      setCsvText(text);
      toast.success(`โหลดไฟล์ ${file.name} แล้ว`);
    };
    reader.onerror = () => toast.error("อ่านไฟล์ไม่สำเร็จ");
    reader.readAsText(file, "utf-8");
  }

  async function callApi(rows: Row[], commit: boolean): Promise<ApiResult> {
    const res = await fetch("/api/rentspace/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, commit }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg || `ผิดพลาด (${res.status})`);
    }
    return (await res.json()) as ApiResult;
  }

  function preview() {
    const text = csvText.trim();
    if (!text) {
      toast.error("กรุณาวางข้อความ CSV หรืออัปโหลดไฟล์ก่อน");
      return;
    }
    const { rows, mappedKeys } = rowsFromCsv(text);
    if (rows.length === 0) {
      toast.error("ไม่พบข้อมูลในไฟล์ — ตรวจหัวตารางและคอลัมน์ ‘ชื่อห้อง’");
      return;
    }
    if (!mappedKeys.includes("ชื่อห้อง")) {
      toast.error("ไม่พบคอลัมน์ ‘ชื่อห้อง’ — ตรวจหัวตาราง");
      return;
    }
    setParsed({ rows, mappedKeys });
    setCommitted(false);
    startPreview(async () => {
      try {
        const r = await callApi(rows, false);
        setResult(r);
        toast.success(`ตรวจแล้ว ${r.counts.total} แถว`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ตรวจสอบไม่สำเร็จ");
      }
    });
  }

  function commit() {
    if (!parsed) return;
    startCommit(async () => {
      try {
        const r = await callApi(parsed.rows, true);
        setResult(r);
        setCommitted(true);
        toast.success(
          `นำเข้าสำเร็จ — เพิ่มใหม่ ${r.counts.new} · อัปเดต ${r.counts.updated}` +
            (r.counts.error ? ` · ปัญหา ${r.counts.error}` : ""),
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ");
      }
    });
  }

  const busy = previewing || committing;

  return (
    <div className="space-y-5">
      {/* Input */}
      <section className="rs-card p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-base font-bold" style={{ color: "var(--rs-text)" }}>
            ข้อมูลนำเข้า
          </h2>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rs-btn rs-btn-ghost w-full sm:w-auto"
            disabled={busy}
          >
            <Upload className="h-4 w-4" /> อัปโหลดไฟล์ .csv
          </button>
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
          วางข้อความ CSV ที่นี่ หรือกดอัปโหลดไฟล์ด้านบน (บรรทัดแรก = หัวตาราง)
        </p>
        <textarea
          className="rs-input"
          style={{ height: 160, paddingTop: 8, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={
            "ชื่อห้อง,ชื่อ-นามสกุล/ชื่อร้าน,เบอร์โทร,วันเกิด,สัญชาติ,เลขบัตรประชาชน,ที่อยู่,อีเมล,line id,วันที่เข้าทำสัญญา,วันสิ้นสุดสัญญา\nA1 SHABU ZEED,ร้านชาบูจี๊ด,0812345678,01/01/2530,ไทย,1234567890123,\"123 ถ.สุข, ขอนแก่น\",shop@x.com,@shabu,01/01/2567,31/12/2567"
          }
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={preview} className="rs-btn flex-1 sm:flex-none" disabled={busy}>
            {previewing ? "กำลังตรวจ…" : (
              <>
                <FileSpreadsheet className="h-4 w-4" /> ตรวจสอบก่อนนำเข้า
              </>
            )}
          </button>
          {csvText && (
            <button
              type="button"
              onClick={() => {
                setCsvText("");
                setParsed(null);
                setResult(null);
                setCommitted(false);
              }}
              className="inline-flex items-center justify-center min-h-[44px] px-3 text-[13px] font-medium shrink-0"
              style={{ color: "var(--rs-text-3)" }}
              disabled={busy}
            >
              ล้าง
            </button>
          )}
        </div>
      </section>

      {/* Preview / result */}
      {result && (
        <section className="rs-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-bold" style={{ color: "var(--rs-text)" }}>
              {committed ? "ผลการนำเข้า" : "สรุปก่อนนำเข้า"}
            </h2>
            {committed && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}
              >
                <Check className="h-3.5 w-3.5" /> บันทึกแล้ว
              </span>
            )}
          </div>

          {/* counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="ทั้งหมด" value={result.counts.total} />
            <Stat label="เพิ่มใหม่" value={result.counts.new} tone="ok" />
            <Stat label="อัปเดต" value={result.counts.updated} tone="info" />
            <Stat label="มีปัญหา" value={result.counts.error} tone={result.counts.error ? "danger" : undefined} />
          </div>
          {(result.counts.newUnits != null || result.counts.newContracts != null) && (
            <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
              ห้องใหม่ {result.counts.newUnits ?? 0} · สัญญาใหม่ {result.counts.newContracts ?? 0}
            </p>
          )}

          {/* table — own contained horizontal scroll on phone, never the page */}
          <div className="rs-card overflow-x-auto p-0">
            <table className="rs-table w-full min-w-[460px] text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                  <th className="py-2.5 px-3 font-semibold">#</th>
                  <th className="py-2.5 px-3 font-semibold">ห้อง</th>
                  <th className="py-2.5 px-3 font-semibold">ผู้เช่า</th>
                  <th className="py-2.5 px-3 font-semibold">สถานะ</th>
                  <th className="py-2.5 px-3 font-semibold">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {result.diffs.slice(0, 30).map((d) => (
                  <tr
                    key={d.row}
                    className="border-t"
                    style={{ borderColor: "var(--rs-border)" }}
                  >
                    <td className="py-2 px-3 tabular-nums" style={{ color: "var(--rs-text-3)" }}>
                      {d.row}
                    </td>
                    <td className="py-2 px-3 font-medium" style={{ color: "var(--rs-text)" }}>
                      {d.unitCode || "—"}
                    </td>
                    <td className="py-2 px-3" style={{ color: "var(--rs-text-2)" }}>
                      {d.tenant || "—"}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="py-2 px-3 text-[12.5px]" style={{ color: "var(--rs-danger)" }}>
                      {d.errors.length ? d.errors.join(", ") : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.diffs.length > 30 && (
            <p className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
              แสดง 30 แถวแรกจาก {result.diffs.length} แถว
            </p>
          )}

          {/* commit */}
          {!committed && (
            <div className="flex justify-stretch sm:justify-end">
              <button
                type="button"
                onClick={commit}
                className="rs-btn w-full sm:w-auto"
                disabled={busy || result.counts.total === 0}
              >
                {committing ? "กำลังนำเข้า…" : (
                  <>
                    <Check className="h-4 w-4" /> ยืนยันนำเข้า ({result.counts.total} แถว)
                  </>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      <style jsx>{`
        .rs-input {
          width: 100%;
          min-height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: #fff;
          color: var(--rs-text);
          font-size: 14px;
        }
        .rs-input:focus {
          outline: none;
          border-color: var(--rs-brand);
          box-shadow: 0 0 0 3px var(--rs-brand-50);
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "info" | "danger" }) {
  const color =
    tone === "ok" ? "var(--rs-ok)" : tone === "danger" ? "var(--rs-danger)" : tone === "info" ? "var(--rs-info)" : "var(--rs-text)";
  return (
    <div className="rs-kpi">
      <div className="text-[12.5px] font-medium" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "new" | "updated" | "error" }) {
  const map = {
    new: { label: "เพิ่มใหม่", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)", icon: Check },
    updated: { label: "อัปเดต", color: "var(--rs-info)", soft: "var(--rs-info-soft)", icon: Check },
    error: { label: "มีปัญหา", color: "var(--rs-danger)", soft: "var(--rs-danger-soft)", icon: AlertTriangle },
  } as const;
  const t = map[status];
  const Icon = t.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: t.soft, color: t.color }}
    >
      <Icon className="h-3.5 w-3.5" />
      {t.label}
    </span>
  );
}

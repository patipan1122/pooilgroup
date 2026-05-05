"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  FileText,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { BUSINESS_TYPES } from "@/constants/business-types";

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const VALID_BUSINESS_TYPES = new Set(Object.keys(BUSINESS_TYPES));

const buildTemplate = (companies: CompanyOption[]) => {
  const exampleCompany = companies[0]?.code || "POOIL";
  return `code,name,businessType,companyCode,province,region,phone
PO-FUEL-002,ปั๊มน้ำมัน ขอนแก่น 02,fuel_station,${exampleCompany},ขอนแก่น,อีสาน,
PO-LPG-002,ปั๊มแก๊ส ขอนแก่น 02,lpg_station,${exampleCompany},ขอนแก่น,อีสาน,
PO-CAFE-002,Café Amazon ขอนแก่น 02,cafe,${exampleCompany},ขอนแก่น,อีสาน,043-555-1234`;
};

interface ParsedRow {
  code: string;
  name: string;
  businessType: string;
  companyCode: string;
  province?: string;
  region?: string;
  phone?: string;
  _line: number;
  _error?: string;
}

interface ResultRow {
  code: string;
  name: string;
  success: boolean;
  branchId?: string;
  error?: string;
}

function parseCSV(text: string, validCompanyCodes: Set<string>): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("code") && header.includes("businesstype");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line, idx) => {
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) {
        cols.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());

    const [code = "", name = "", businessType = "", companyCode = "", province = "", region = "", phone = ""] = cols;

    const row: ParsedRow = {
      code: code.toUpperCase(),
      name,
      businessType,
      companyCode: companyCode.toUpperCase(),
      province: province || undefined,
      region: region || undefined,
      phone: phone || undefined,
      _line: hasHeader ? idx + 2 : idx + 1,
    };

    if (!row.code) row._error = "ขาดรหัสสาขา";
    else if (!row.name) row._error = "ขาดชื่อสาขา";
    else if (!VALID_BUSINESS_TYPES.has(row.businessType))
      row._error = `ประเภทธุรกิจไม่ถูกต้อง: ${row.businessType}`;
    else if (!validCompanyCodes.has(row.companyCode))
      row._error = `ไม่พบบริษัทรหัส ${row.companyCode}`;

    return row;
  });
}

export function BranchImportClient({ companies }: { companies: CompanyOption[] }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    summary: { total: number; success: number; failed: number };
    rows: ResultRow[];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const TEMPLATE = buildTemplate(companies);
  const validCompanyCodes = new Set(companies.map((c) => c.code.toUpperCase()));
  const parsed = parseCSV(text, validCompanyCodes);
  const errors = parsed.filter((p) => p._error);
  const valid = parsed.filter((p) => !p._error);

  function copyTemplate() {
    navigator.clipboard.writeText(TEMPLATE);
    setCopied(true);
    toast.success("Copy template แล้ว");
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadTemplate() {
    const blob = new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pooilgroup-branches-template.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("ดาวน์โหลดไฟล์ template แล้ว เปิดด้วย Excel ได้เลย");
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === "string") {
        const cleaned = content.replace(/^﻿/, "");
        setText(cleaned);
        toast.success(`อ่านไฟล์ ${file.name} เรียบร้อย`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function submit() {
    if (errors.length > 0) {
      toast.error(`มี ${errors.length} แถวที่ไม่ถูกต้อง — แก้ก่อน`);
      return;
    }
    if (valid.length === 0) {
      toast.error("ไม่มีข้อมูลให้ import");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/branches/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: valid.map((r) => ({
            code: r.code,
            name: r.name,
            businessType: r.businessType,
            companyCode: r.companyCode,
            province: r.province,
            region: r.region,
            phone: r.phone,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Import ไม่สำเร็จ");
        return;
      }
      setResult({ summary: json.summary, rows: json.results });
      toast.success(`Import สำเร็จ ${json.summary.success}/${json.summary.total}`);
    });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <Card className="animate-fade-up">
          <CardBody className="text-center py-8 space-y-3">
            <div className="size-14 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-7" />
            </div>
            <h3 className="text-xl font-bold font-display">Import เสร็จสิ้น</h3>
            <div className="flex items-center justify-center gap-3 text-sm">
              <Badge tone="success">สำเร็จ {result.summary.success}</Badge>
              {result.summary.failed > 0 && (
                <Badge tone="danger">ล้มเหลว {result.summary.failed}</Badge>
              )}
              <Badge tone="neutral">ทั้งหมด {result.summary.total}</Badge>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <Button
                onClick={() => {
                  setResult(null);
                  setText("");
                }}
                size="lg"
              >
                Import ชุดต่อไป
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => (window.location.href = "/users")}
              >
                ดูสาขาทั้งหมด
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ผลลัพธ์ทุกแถว</CardTitle>
          </CardHeader>
          <CardBody className="!pt-0 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="text-left px-3 py-2">รหัส</th>
                  <th className="text-left px-3 py-2">ชื่อ</th>
                  <th className="text-left px-3 py-2">ผล</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="px-3 py-2 font-bold tabular-num font-display">
                      {r.code}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.name}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.success ? (
                        <Badge tone="success">เพิ่มแล้ว</Badge>
                      ) : (
                        <Badge tone="danger">{r.error}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ขั้นตอน</CardTitle>
        </CardHeader>
        <CardBody className="text-sm space-y-2.5 text-zinc-700">
          <Step n="1">กดปุ่ม <strong>Download .csv</strong> → เปิดด้วย Excel / Google Sheets</Step>
          <Step n="2">กรอกข้อมูลสาขาในแต่ละแถว · ลบบรรทัดตัวอย่างทิ้งได้</Step>
          <Step n="3">Save as CSV (UTF-8) → กลับมาที่นี่</Step>
          <Step n="4">ลากไฟล์มาวาง หรือ paste เนื้อหา → ตรวจ → กด Import</Step>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>1. ดาวน์โหลด Template</CardTitle>
          <div className="flex gap-1.5">
            <Button onClick={downloadTemplate} size="sm">
              <Download className="size-4" />
              Download .csv
            </Button>
            <Button onClick={copyTemplate} size="sm" variant="outline">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy
            </Button>
          </div>
        </CardHeader>
        <CardBody className="!pt-0">
          <pre className="text-xs font-mono bg-zinc-50 rounded-lg p-3 border border-zinc-200 overflow-x-auto">
            {TEMPLATE}
          </pre>
          <div className="mt-3 space-y-2">
            <div>
              <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                ประเภทธุรกิจ (businessType) ที่ใช้ได้:
              </p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(BUSINESS_TYPES).map(([key, cfg]) => (
                  <span
                    key={key}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-50 border border-zinc-200 font-mono"
                  >
                    {cfg.emoji} <code className="text-zinc-700">{key}</code>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                บริษัท (companyCode) ที่ใช้ได้:
              </p>
              <div className="flex flex-wrap gap-1">
                {companies.map((c) => (
                  <span
                    key={c.id}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] font-mono"
                  >
                    <code className="text-[var(--color-brand-800)]">{c.code}</code> {c.name}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              · province / region / phone ปล่อยว่างได้ · รหัสสาขา (code) ห้ามซ้ำของเดิม
            </p>
          </div>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-200">
        <CardHeader>
          <CardTitle>2. อัปโหลดไฟล์ที่กรอกเสร็จแล้ว</CardTitle>
        </CardHeader>
        <CardBody>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFileUpload(f);
            }}
            className={cn(
              "block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors",
              dragOver
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                : "border-zinc-300 bg-zinc-50 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40",
            )}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
                e.target.value = "";
              }}
            />
            <Download className="size-7 mx-auto text-zinc-400 mb-2 rotate-180" />
            <p className="text-sm font-bold text-zinc-700">
              ลากไฟล์ .csv มาวางตรงนี้ หรือคลิกเลือกไฟล์
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              รองรับไฟล์ UTF-8 จาก Excel / Google Sheets / Numbers
            </p>
          </label>

          <div className="mt-3">
            <p className="text-xs text-zinc-500 mb-1.5">หรือ paste เนื้อหา CSV ลงในกล่อง:</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="paste CSV ที่นี่..."
              rows={8}
              className="w-full font-mono text-xs rounded-xl border-2 border-zinc-200 bg-white p-3 focus:border-[var(--color-brand-500)] focus:outline-none resize-none"
            />
          </div>

          {parsed.length > 0 && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <Badge tone="success">ถูกต้อง {valid.length}</Badge>
              {errors.length > 0 && (
                <Badge tone="danger">ผิดพลาด {errors.length}</Badge>
              )}
              <span className="text-zinc-500 text-xs">
                ทั้งหมด {parsed.length} แถว
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      {parsed.length > 0 && (
        <Card className="animate-fade-up delay-250">
          <CardHeader>
            <CardTitle>ตรวจก่อน Import</CardTitle>
            {errors.length > 0 && (
              <Badge tone="danger">
                <AlertTriangle className="size-3" />
                แก้ {errors.length} แถว
              </Badge>
            )}
          </CardHeader>
          <CardBody className="!pt-0 max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">รหัส</th>
                  <th className="text-left px-3 py-2">ชื่อ</th>
                  <th className="text-left px-3 py-2">ประเภท</th>
                  <th className="text-left px-3 py-2">บริษัท</th>
                  <th className="text-left px-3 py-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => (
                  <tr
                    key={r._line}
                    className={cn(
                      "border-b border-zinc-100",
                      r._error && "bg-red-50/50",
                    )}
                  >
                    <td className="px-3 py-2 text-xs text-zinc-400 tabular-num">
                      {r._line}
                    </td>
                    <td className="px-3 py-2 font-bold tabular-num font-display text-xs">
                      {r.code || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {BUSINESS_TYPES[r.businessType]?.emoji} {r.businessType}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {r.companyCode}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r._error ? (
                        <Badge tone="danger">{r._error}</Badge>
                      ) : (
                        <Badge tone="success">พร้อม</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <div className="flex justify-end gap-2 animate-fade-up delay-300">
        <Button
          size="lg"
          onClick={submit}
          loading={pending}
          disabled={errors.length > 0 || valid.length === 0}
        >
          <FileText className="size-4" />
          Import {valid.length} สาขา
        </Button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="size-6 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-700)] text-xs font-bold flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

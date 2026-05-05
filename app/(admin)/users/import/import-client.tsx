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

const TEMPLATE = `name,email,phone,role,branchCodes
สมชาย ใจดี,somchai@pooilgroup.com,081-234-5678,branch_manager,KKN-001
สุดา ทอง,sudata@pooilgroup.com,089-555-1111,staff,"KKN-001,KKN-002"
มาดี ขับรถ,,082-222-3333,driver,
ผู้ดู ทดสอบ,viewer@pooilgroup.com,,viewer,`;

interface ParsedRow {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  branchCodes: string[];
  _line: number;
  _error?: string;
}

interface ResultRow {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  inviteUrl?: string;
  error?: string;
}

const ROLES = new Set([
  "super_admin",
  "org_admin",
  "branch_manager",
  "staff",
  "driver",
  "viewer",
]);

function parseCSV(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // Skip header if it looks like one
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("name") && header.includes("role");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line, idx) => {
    // Simple CSV parser supporting quoted values
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

    const [name = "", email = "", phone = "", role = "staff", branchCodesStr = ""] =
      cols;

    const row: ParsedRow = {
      name: name,
      email: email || undefined,
      phone: phone || undefined,
      role: role || "staff",
      branchCodes: branchCodesStr
        ? branchCodesStr
            .split(/[,;]/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [],
      _line: hasHeader ? idx + 2 : idx + 1,
    };

    // Inline validation
    if (!row.name) row._error = "ขาดชื่อ";
    else if (!ROLES.has(row.role))
      row._error = `บทบาทไม่ถูกต้อง: ${row.role}`;
    else if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email))
      row._error = "อีเมลไม่ถูกต้อง";

    return row;
  });
}

export function ImportClient() {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    summary: { total: number; success: number; failed: number };
    rows: ResultRow[];
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const parsed = parseCSV(text);
  const errors = parsed.filter((p) => p._error);
  const valid = parsed.filter((p) => !p._error);

  function copyTemplate() {
    navigator.clipboard.writeText(TEMPLATE);
    setCopied(true);
    toast.success("Copy template แล้ว");
    setTimeout(() => setCopied(false), 2000);
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
      const res = await fetch("/api/admin/users/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: valid.map((r) => ({
            name: r.name,
            email: r.email || undefined,
            phone: r.phone || undefined,
            role: r.role,
            branchCodes: r.branchCodes,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Import ไม่สำเร็จ");
        return;
      }
      setResult({ summary: json.summary, rows: json.results });
      toast.success(
        `Import สำเร็จ ${json.summary.success}/${json.summary.total}`,
      );
    });
  }

  function downloadResultsCsv() {
    if (!result) return;
    const headers = ["name", "email", "phone", "role", "inviteUrl", "error"];
    const lines = [
      headers.join(","),
      ...result.rows.map((r) =>
        [
          quote(r.name),
          quote(r.email),
          quote(r.phone),
          quote(r.role),
          quote(r.inviteUrl),
          quote(r.error),
        ].join(","),
      ),
    ];
    const csv = lines.join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pooilgroup-import-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (result) {
    return (
      <div className="space-y-4">
        <Card className="animate-fade-up">
          <CardBody className="text-center py-8 space-y-3">
            <div className="size-14 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-7" />
            </div>
            <h3 className="text-xl font-bold font-display">
              Import เสร็จสิ้น
            </h3>
            <div className="flex items-center justify-center gap-3 text-sm">
              <Badge tone="success">สำเร็จ {result.summary.success}</Badge>
              {result.summary.failed > 0 && (
                <Badge tone="danger">ล้มเหลว {result.summary.failed}</Badge>
              )}
              <Badge tone="neutral">ทั้งหมด {result.summary.total}</Badge>
            </div>
            <p className="text-sm text-zinc-600 max-w-md mx-auto pt-1">
              Download CSV ที่มี invite link ของทุกคน — ส่งให้แต่ละคนใน LINE
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={downloadResultsCsv} size="lg">
                <Download className="size-4" />
                Download CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setText("");
                }}
              >
                Import ชุดต่อไป
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
                  <th className="text-left px-3 py-2">ชื่อ</th>
                  <th className="text-left px-3 py-2">อีเมล</th>
                  <th className="text-left px-3 py-2">บทบาท</th>
                  <th className="text-left px-3 py-2">ผล</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.email ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.role}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.inviteUrl ? (
                        <Badge tone="success">สร้าง invite แล้ว</Badge>
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
          <Step n="1">
            กดปุ่ม <strong>Copy Template</strong> ด้านล่าง → เปิด Excel/Numbers
            → วาง
          </Step>
          <Step n="2">
            กรอกข้อมูลผู้ใช้ในแต่ละแถว · ลบบรรทัดตัวอย่าง 4 บรรทัดทิ้งได้
          </Step>
          <Step n="3">
            Save as CSV → เปิดไฟล์ด้วย Notepad → Copy เนื้อหาทั้งหมด
          </Step>
          <Step n="4">วางลงในกล่องด้านล่าง → ตรวจสอบ → กด Import</Step>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>Template CSV</CardTitle>
          <Button onClick={copyTemplate} size="sm" variant="outline">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy Template
          </Button>
        </CardHeader>
        <CardBody className="!pt-0">
          <pre className="text-xs font-mono bg-zinc-50 rounded-lg p-3 border border-zinc-200 overflow-x-auto">
            {TEMPLATE}
          </pre>
          <ul className="text-xs text-zinc-500 mt-2 space-y-0.5 list-disc pl-5">
            <li>ใส่หัวคอลัมน์บรรทัดแรกตาม template</li>
            <li>
              <code className="text-zinc-700">role</code>: super_admin / org_admin /
              branch_manager / staff / driver / viewer
            </li>
            <li>
              <code className="text-zinc-700">branchCodes</code>: รหัสสาขา หลายอันคั่นด้วย comma
              (ถ้ามี comma ในเซลล์ ให้ครอบด้วย "")
            </li>
            <li>email/phone/branchCodes ปล่อยว่างได้</li>
          </ul>
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-200">
        <CardHeader>
          <CardTitle>วาง CSV ที่นี่</CardTitle>
        </CardHeader>
        <CardBody>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="วาง CSV ที่นี่..."
            rows={10}
            className="w-full font-mono text-xs rounded-xl border-2 border-zinc-200 bg-white p-3 focus:border-[var(--color-brand-500)] focus:outline-none resize-none"
          />
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
            <CardTitle>ตรวจสอบก่อน import</CardTitle>
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
                  <th className="text-left px-3 py-2">ชื่อ</th>
                  <th className="text-left px-3 py-2">บทบาท</th>
                  <th className="text-left px-3 py-2">สาขา</th>
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
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name || "—"}</div>
                      <div className="text-xs text-zinc-500">
                        {r.email ?? r.phone ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.role}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {r.branchCodes.join(", ") || "—"}
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
          Import {valid.length} ผู้ใช้
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

function quote(v: string | undefined): string {
  if (!v) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

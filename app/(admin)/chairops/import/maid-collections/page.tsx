// =============================================================
// F1 · CSV import maid collections (page · audit MISS-04)
// =============================================================
// CEO+ADMIN-only landing page. Lays out:
//   • header + how-to copy
//   • CSV-template download (one click → no MS Excel guessing)
//   • upload form → preview client component
//
// All heavy lifting (parse · dedup · commit) lives in ./actions.ts. This page
// is purely a server-rendered shell · the preview/commit handshake runs on the
// client via `MaidCsvShell` so the CEO can click around the diff table.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { MaidCsvShell } from "./maid-csv-shell";
import { CSV_HEADER } from "./types";

export const dynamic = "force-dynamic";

interface SP {
  committed?: string;
  dedup?: string;
}

export default async function MaidCsvImportPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  // CEO+ADMIN — rank CEO=4 includes ADMIN=5 via rankOf comparison.
  const session = await requireRole("CEO");
  const sp = await searchParams;
  const committed = sp.committed ? Number(sp.committed) : null;
  const dedup = sp.dedup ? Number(sp.dedup) : null;

  // Show a short list of recent CSV-imported collection rows so the CEO can
  // verify the batch landed without leaving the page.
  // One real branch name to seed the .csv quick-download example.
  const firstBranch = await prisma.chairopsBranch.findFirst({
    where: { orgId: session.user.orgId, isActive: true },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  const exampleBranchName = firstBranch?.name ?? "ชื่อสาขา";

  const recent = await prisma.chairopsCashCollection.findMany({
    where: {
      // soft-delete: hide rows deleted by super_admin (CEO 2026-06-30)
      deletedAt: null,
      orgId: session.user.orgId,
      // Both CSV back-fills and admin-collected (OFFICE_PROXY) rows land here.
      source: { in: ["CSV_IMPORT", "OFFICE_PROXY"] },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      collectedAt: true,
      countedAmount: true,
      slipPhotoUrl: true,
      source: true,
      branch: { select: { name: true } },
      maid: { select: { displayName: true } },
    },
  });

  return (
    <div className="chairops-scope mx-auto max-w-3xl space-y-4 p-4">
      <Link
        href="/chairops/dashboard"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> กลับหน้าหลัก
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          นำเข้า · ChairOps
        </p>
        <h1 className="text-xl font-bold text-zinc-900">
          นำเข้ายอดแม่บ้าน (CSV)
        </h1>
        <p className="text-sm text-zinc-500">
          ใช้เมื่อบันทึกรอบเก็บเงินใน LIFF ไม่ทัน · กรอกลง Excel
          แล้วอัปโหลดเข้ามา · รองรับ .xlsx และ .csv · ระบบกรองรายการซ้ำให้
        </p>
        <Link
          href="/chairops/import/history"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          📋 ดูประวัติการนำเข้า · ลบ/เรียกคืน
        </Link>
      </header>

      {committed != null ? (
        <Card className="border-green-200 bg-green-50">
          <CardBody className="space-y-1 p-3 text-sm text-green-900">
            <p className="font-semibold">
              บันทึกสำเร็จ {committed.toLocaleString("en-US")} แถว
            </p>
            {dedup != null && dedup > 0 ? (
              <p className="text-xs">
                ข้ามรายการซ้ำ {dedup.toLocaleString("en-US")} แถว
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="space-y-2 p-4 text-sm">
          <div className="font-semibold text-zinc-800">วิธีใช้</div>
          <ol className="ml-5 list-decimal space-y-1 text-zinc-700">
            <li>
              ดาวน์โหลด template ด้านล่าง · <strong>ในไฟล์เติมชื่อสาขาให้แล้วทุกสาขา</strong> —
              พิมพ์ชื่อสาขาจริงได้เลย ไม่ต้องเปิดหารหัส
            </li>
            <li>
              กรอกแค่ <strong>ยอดเงิน + เวลา</strong> ข้างสาขาที่เก็บ · เวลาใช้รูปแบบ{" "}
              <code className="rounded bg-zinc-100 px-1">
                YYYY-MM-DD HH:mm
              </code>{" "}
              · สาขาที่ไม่ได้กรอก ระบบข้ามให้ (ไม่ต้องลบแถว)
            </li>
            <li>
              <strong>แอดมินเก็บเงินเอง</strong> (ไม่ใช่แม่บ้าน) → พิมพ์คำว่า{" "}
              <code className="rounded bg-sky-100 px-1 text-sky-800">แอดมิน</code>{" "}
              ในช่อง maidPhone ของแถวนั้น
            </li>
            <li>
              upload ไฟล์ · ระบบเช็คซ้ำกับฐานข้อมูล (±60 วินาที + ยอดเดียวกัน
              = ซ้ำ) แล้วกดยืนยัน → บันทึกเฉพาะแถวที่ผ่าน
            </li>
          </ol>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠ CSV import{" "}
            <strong>ไม่ต้องมีรูปถ่ายรอบเก็บเงิน และไม่ต้องมีสลิปฝากเงิน</strong> —
            เว้นช่อง slipUrl ว่างได้เลย (หรือจะลบคอลัมน์ slipUrl ทิ้งก็ยังอัปได้) ·
            ใช้สำหรับลงรายการย้อนหลังที่แม่บ้านลืมกดใน LIFF
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-4">
          <div className="text-sm font-semibold text-zinc-800">
            CSV header ที่ต้องใช้ (ตรงตามนี้)
          </div>
          <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-700">
            <code>{CSV_HEADER.join(",")}</code>
          </pre>
          <div className="grid gap-1 text-xs text-zinc-600">
            <div>
              <code className="font-semibold">สาขา</code> — พิมพ์ชื่อสาขาจริงได้เลย
              (หรือ slug ก็ได้)
            </div>
            <div>
              <code className="font-semibold">collectedAt</code> —{" "}
              <code>YYYY-MM-DD HH:mm</code> เวลาที่มาถึงสาขา
            </div>
            <div>
              <code className="font-semibold">countedAmount</code> — บาท
              (จำนวนเต็มบวกเท่านั้น)
            </div>
            <div>
              <code className="font-semibold">maidPhone</code> (ใส่หรือเว้นได้)
              — ใส่เบอร์=match แม่บ้าน · เว้น=แม่บ้านประจำสาขา · พิมพ์{" "}
              <code className="rounded bg-sky-100 px-1 text-sky-800">แอดมิน</code>{" "}
              = แอดมินเก็บเอง
            </div>
            <div>
              <code className="font-semibold">notes, slipUrl</code> (ไม่ต้องกรอก —{" "}
              <strong>ไม่มีสลิปก็อัปได้</strong>) · 3 ช่องท้าย (maidPhone, notes,
              slipUrl) จะลบทิ้งทั้งคอลัมน์ก็ได้ ขอแค่ <code>สาขา</code> +{" "}
              <code>collectedAt</code> + <code>countedAmount</code>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/chairops/import/maid-collections/template"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              ดาวน์โหลด template (.xlsx) — แนะนำ
            </a>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                CSV_HEADER.join(",") +
                  "\n" +
                  `${exampleBranchName},2026-06-01 10:30,5400,0891234567,,`,
              )}`}
              download="maid-collections-template.csv"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
            >
              ดาวน์โหลด template (.csv)
            </a>
          </div>
        </CardBody>
      </Card>

      <MaidCsvShell />

      {recent.length > 0 ? (
        <Card>
          <CardBody className="space-y-2 p-4">
            <div className="text-sm font-semibold text-zinc-800">
              รอบที่นำเข้าล่าสุด (CSV)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-zinc-500">
                  <tr>
                    <th className="px-2 py-1.5">เวลา</th>
                    <th className="px-2 py-1.5">สาขา</th>
                    <th className="px-2 py-1.5">แม่บ้าน</th>
                    <th className="px-2 py-1.5 text-right">นับได้</th>
                    <th className="px-2 py-1.5">สลิป</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-100">
                      <td className="px-2 py-1.5 tabular-nums">
                        {r.collectedAt
                          .toISOString()
                          .slice(0, 16)
                          .replace("T", " ")}
                      </td>
                      <td className="px-2 py-1.5">{r.branch?.name ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.source === "OFFICE_PROXY" ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                              แอดมินเก็บแทน
                            </span>
                            {r.maid?.displayName ?? ""}
                          </span>
                        ) : (
                          (r.maid?.displayName ?? "—")
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {Number(r.countedAmount).toLocaleString("en-US")}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.slipPhotoUrl ? "✓" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

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
import { CSV_HEADER } from "./actions";

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
  const recent = await prisma.chairopsCashCollection.findMany({
    where: {
      orgId: session.user.orgId,
      source: "CSV_IMPORT",
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      collectedAt: true,
      countedAmount: true,
      slipPhotoUrl: true,
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
          ใช้เมื่อบันทึกรอบเก็บเงินใน LIFF ไม่ทัน · พิมพ์ลง Excel/Sheets
          แล้วอัปโหลด CSV เข้ามา · ระบบกรองรายการซ้ำให้
        </p>
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
              ดาวน์โหลด template ด้านล่าง (header ตายตัว · เปลี่ยนชื่อ
              column ไม่ได้)
            </li>
            <li>
              กรอกแถวละ 1 รอบเก็บเงิน · เวลาใช้รูปแบบ{" "}
              <code className="rounded bg-zinc-100 px-1">
                YYYY-MM-DD HH:mm
              </code>
            </li>
            <li>
              upload ไฟล์ · ระบบเช็คซ้ำกับฐานข้อมูล (±60 วินาที + ยอดเดียวกัน
              = ซ้ำ)
            </li>
            <li>กดยืนยัน → ระบบบันทึกเฉพาะแถวที่ผ่าน</li>
          </ol>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠ CSV import จะตั้งค่า{" "}
            <strong>ไม่บังคับรูปถ่ายรอบเก็บเงิน</strong> · ใช้สำหรับลงรายการ
            ย้อนหลังที่แม่บ้านลืมกดใน LIFF เท่านั้น
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
              <code className="font-semibold">branchSlug</code> — slug ของสาขา
              (เช่น <code>central-rama-9</code>) ดูได้จากหน้า /chairops/branches
            </div>
            <div>
              <code className="font-semibold">collectedAt</code> —{" "}
              <code>YYYY-MM-DD HH:mm</code> เวลาที่แม่บ้านมาถึงสาขา
            </div>
            <div>
              <code className="font-semibold">countedAmount</code> — บาท
              (จำนวนเต็มบวกเท่านั้น)
            </div>
            <div>
              <code className="font-semibold">maidPhone</code> (ใส่หรือเว้นได้)
              — ถ้าใส่ระบบจะ match แม่บ้าน · ถ้าเว้นจะใช้ค่าเริ่มต้นของสาขา
            </div>
            <div>
              <code className="font-semibold">notes, slipUrl</code> (ใส่หรือเว้นได้)
            </div>
          </div>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
              CSV_HEADER.join(",") +
                "\n" +
                "central-rama-9,2026-06-01 10:30,5400,0891234567,,",
            )}`}
            download="maid-collections-template.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            ดาวน์โหลด template
          </a>
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
                      <td className="px-2 py-1.5">{r.maid?.displayName ?? "—"}</td>
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

// Step 1 — POS CSV upload form
// Server page fetches active branch list + wraps in OfficeShell · client form posts FormData.
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { UploadForm } from "./upload-form";

export default async function PosIngestNewPage() {
  const session = await requireRole("OFFICE");
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, tabName: true },
  });

  return (
    <OfficeShell session={session} active="/chairops/pos-ingest">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <Link href="/chairops/pos-ingest" className="text-sm text-muted-foreground hover:underline">
            ← กลับรายการ import
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">อัปโหลด POS CSV</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CSV จาก POS รายวัน · ระบบจะ <strong>preview ก่อน commit เสมอ</strong> — ไม่มีการเขียนทับโดยไม่ถาม
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background p-6">
          <UploadForm branches={branches} />
        </div>

        <div className="mt-6 rounded-md border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          <p className="mb-2 font-semibold text-foreground">รูปแบบ CSV ที่รองรับ</p>
          <p>คอลัมน์ที่เข้าใจ (header ภาษาไทยหรืออังกฤษ):</p>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li><code>วันที่</code> · <code>date</code> · รูปแบบ 2026-05-21 หรือ 21/05/69</li>
            <li><code>เลขเครื่อง</code> / <code>รหัสอุปกรณ์</code> (ถ้ามี → เก็บราย chair · ถ้าไม่มี → ยอดรวมสาขา)</li>
            <li><code>ชื่อร้าน</code> (ถ้ามี → auto-detect สาขา · ถ้าไม่มี → ต้องเลือกสาขาเอง)</li>
            <li><code>ออนไลน์</code> · <code>แบงค์</code> · <code>เหรียญ</code> · <code>รวม</code></li>
          </ul>
        </div>
      </div>
    </OfficeShell>
  );
}

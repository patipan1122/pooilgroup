// W3 (claude-design) · POS upload entry — step 1 of CSV ingest flow.
//
// Reuses the existing CSV parser via `previewImport` server action.
// Replaces legacy `app/(admin)/chairops/pos-ingest/new/page.tsx` (which
// now redirects here).

import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/card";
import { UploadForm } from "./upload-form";

export default async function PosIngestNewPage() {
  await requireRole("OFFICE");

  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, tabName: true },
  });

  return (
    <div className="chairops-scope mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/chairops/pos-ingest"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← กลับรายการ import
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          อัปโหลด POS CSV
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CSV จาก POS รายวัน · ระบบจะ <strong>preview 4 กลุ่มก่อน commit เสมอ</strong>{" "}
          — ไม่มีการเขียนทับโดยไม่ถาม
        </p>
      </div>

      <Card className="p-6">
        <UploadForm branches={branches} />
      </Card>

      <Card className="mt-6 bg-muted/40 p-4 text-xs text-muted-foreground">
        <p className="mb-2 font-semibold text-foreground">
          รูปแบบ CSV ที่รองรับ
        </p>
        <p>คอลัมน์ที่เข้าใจ (header ภาษาไทยหรืออังกฤษ):</p>
        <ul className="ml-5 mt-1 list-disc space-y-1">
          <li>
            <code>วันที่</code> · <code>date</code> · รูปแบบ 2026-05-21 หรือ
            21/05/69
          </li>
          <li>
            <code>เลขเครื่อง</code> / <code>รหัสอุปกรณ์</code> (ถ้ามี → เก็บราย
            chair · ถ้าไม่มี → ยอดรวมสาขา)
          </li>
          <li>
            <code>ชื่อร้าน</code> (ถ้ามี → auto-detect สาขา · ถ้าไม่มี →
            ต้องเลือกสาขาเอง)
          </li>
          <li>
            <code>ออนไลน์</code> · <code>แบงค์</code> · <code>เหรียญ</code> ·{" "}
            <code>รวม</code>
          </li>
        </ul>
      </Card>
    </div>
  );
}

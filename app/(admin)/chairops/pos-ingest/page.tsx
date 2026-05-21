// POS Imports list — recent uploads (filename · uploadedBy · rowCount · committed?)
// Two states: pending preview (committed=false) vs done (committed=true).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { thaiDateTime } from "@/lib/chairops/utils/format";

interface Search {
  committed?: string;
  error?: string;
}

export default async function PosIngestListPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OFFICE");
  const params = await searchParams;

  const imports = await prisma.chairopsPosImport.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  // batch-load uploader names
  const uploaderIds = [...new Set(imports.map((i) => i.uploadedById))];
  const uploaders = uploaderIds.length
    ? await prisma.chairopsUser.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const nameMap = new Map(uploaders.map((u) => [u.id, u.displayName]));

  return (
    <OfficeShell session={session} active="/chairops/pos-ingest">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">POS รายวัน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            อัปโหลด CSV ยอดขายจาก POS · ระบบจะแสดงสิ่งที่จะเปลี่ยนก่อน commit เสมอ
          </p>
        </div>
        <Link
          href="/chairops/pos-ingest/new"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          อัปโหลด POS CSV
        </Link>
      </div>

      {params.committed && (
        <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm text-foreground">
          commit สำเร็จ · drift และ alert ถูก recompute แล้ว
        </div>
      )}
      {params.error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-foreground">
          {decodeURIComponent(params.error)}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">เวลาอัปโหลด</th>
              <th className="px-3 py-2 font-medium">ชื่อไฟล์</th>
              <th className="px-3 py-2 font-medium">ผู้อัปโหลด</th>
              <th className="px-3 py-2 text-right font-medium">แถว</th>
              <th className="px-3 py-2 font-medium">สถานะ</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {imports.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                  ยังไม่มี import · กดปุ่ม &quot;อัปโหลด POS CSV&quot; เพื่อเริ่ม
                </td>
              </tr>
            )}
            {imports.map((imp) => {
              const summary = imp.diffSummary as unknown as
                | { counts?: { new: number; same: number; changed: number; error: number } }
                | null;
              const counts = summary?.counts;
              return (
                <tr key={imp.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {thaiDateTime(imp.uploadedAt)}
                  </td>
                  <td className="px-3 py-2 font-medium">{imp.filename}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {nameMap.get(imp.uploadedById) ?? imp.uploadedById.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{imp.rowCount}</td>
                  <td className="px-3 py-2">
                    {imp.committed ? (
                      <Badge variant="success">commit แล้ว</Badge>
                    ) : (
                      <Badge variant="warning">รอ commit</Badge>
                    )}
                    {counts && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ใหม่ {counts.new} · เปลี่ยน {counts.changed} · เหมือนเดิม {counts.same}
                        {counts.error > 0 ? ` · ผิด ${counts.error}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/chairops/pos-ingest/${imp.id}/preview`}
                      className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                    >
                      {imp.committed ? "ดูรายละเอียด" : "ตรวจ + commit"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}

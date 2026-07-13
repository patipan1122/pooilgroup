// GET /api/clawfleet/import/collections/machine-list
// ไฟล์ .xlsx แยกต่างหาก = "รายชื่อสาขา + รหัสตู้" ทั้งหมด (ตู้คีบ CLAW ที่ active)
// ไว้เปิดดูคู่กันตอนกรอก template นำเข้า → กันพิมพ์รหัสตู้/สาขาผิด (CEO 2026-07-13).
// เฉพาะแอดมิน ClawFleet.

import { type NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertCfAdmin } from "@/lib/clawfleet/role-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const machines = await prisma.cfMachine.findMany({
    where: { orgId, kind: "CLAW", isActive: true },
    select: {
      code: true,
      nickname: true,
      isFirstBaselineLocked: true,
      branch: { select: { name: true, code: true } },
    },
    orderBy: [{ branch: { name: "asc" } }, { code: "asc" }],
  });

  const wb = XLSX.utils.book_new();
  const rows: string[][] = [
    ["สาขา", "รหัสตู้", "ชื่อเล่นตู้", "รหัสสาขา", "สถานะในระบบ"],
    ...machines.map((m) => [
      m.branch.name,
      m.code,
      m.nickname ?? "",
      m.branch.code ?? "",
      m.isFirstBaselineLocked ? "มีข้อมูลแล้ว" : "ยังไม่ตั้งค่า (แถวแรก=ตั้งค่าครั้งแรก)",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, ws, "รายชื่อสาขา+ตู้");

  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  return new NextResponse(blob, {
    headers: {
      "Content-Disposition": 'attachment; filename="clawfleet-branch-machine-list.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

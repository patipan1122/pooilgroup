// GET /api/chairops/import/maid-collections/template
// Returns a pre-filled .xlsx template for maid collection CSV import.
// CEO+ADMIN only. Includes:
//   Sheet 1 "กรอกข้อมูล"  — header + example row (fill in from row 2)
//   Sheet 2 "คู่มือ"       — column descriptions in Thai
//   Sheet 3 "รายชื่อสาขา" — all active branches + slugs for reference

import { type NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";

// Mirrors CSV_HEADER in import/maid-collections/types.ts — keep in sync.
const CSV_HEADER = [
  "branchSlug",
  "collectedAt",
  "countedAmount",
  "maidPhone",
  "notes",
  "slipUrl",
] as const;

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await requireRole("CEO");

  const branches = await prisma.chairopsBranch.findMany({
    where: { orgId: session.user.orgId, isActive: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: กรอกข้อมูล ─────────────────────────────────────────────────
  // Row 1 = exact field names (same as CSV header — ห้ามแก้)
  // Row 2 = example data row (กรอกข้อมูลต่อจากแถวนี้ หรือลบแล้วกรอกใหม่)
  const exampleBranch = branches[0]?.slug ?? "central-rama-9";
  const now = new Date();
  const exampleDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 10:30`;

  const dataSheet: (string | number)[][] = [
    [...CSV_HEADER],
    [exampleBranch, exampleDate, 5400, "0891234567", "ตัวอย่าง", ""],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(dataSheet);

  // Set column widths for readability
  ws1["!cols"] = [
    { wch: 22 }, // branchSlug
    { wch: 18 }, // collectedAt
    { wch: 14 }, // countedAmount
    { wch: 14 }, // maidPhone
    { wch: 20 }, // notes
    { wch: 40 }, // slipUrl
  ];

  XLSX.utils.book_append_sheet(wb, ws1, "กรอกข้อมูล");

  // ── Sheet 2: คู่มือ ──────────────────────────────────────────────────────
  const guideSheet: string[][] = [
    ["ชื่อ column", "คำอธิบาย", "ตัวอย่าง", "บังคับ?"],
    ["branchSlug", "slug ของสาขา — ดูได้จาก sheet รายชื่อสาขา", exampleBranch, "✅ บังคับ"],
    ["collectedAt", "วันเวลาที่แม่บ้านมาเก็บเงิน รูปแบบ: YYYY-MM-DD HH:mm", exampleDate, "✅ บังคับ"],
    ["countedAmount", "ยอดเงินที่นับได้ (บาท · จำนวนเต็มบวกเท่านั้น)", "5400", "✅ บังคับ"],
    ["maidPhone", "เบอร์โทรแม่บ้าน · ถ้าเว้นว่างระบบใช้แม่บ้านประจำสาขา", "0891234567", "⬜ ใส่หรือเว้นได้"],
    ["notes", "หมายเหตุเพิ่มเติม", "เก็บย้อนหลัง 3 มิ.ย.", "⬜ ใส่หรือเว้นได้"],
    ["slipUrl", "URL รูปสลิปฝากเงิน (ถ้ามี · ต้องเป็น URL จากระบบเท่านั้น)", "", "⬜ ใส่หรือเว้นได้"],
    [],
    ["⚠ หมายเหตุ", "", "", ""],
    ["- ห้ามเปลี่ยนชื่อ column ใน sheet กรอกข้อมูล", "", "", ""],
    ["- ลบแถว ตัวอย่าง ออกก่อน upload (แถว 2 ใน sheet กรอกข้อมูล)", "", "", ""],
    ["- กรอกข้อมูลเริ่มจากแถว 2 ต่อจาก header", "", "", ""],
    ["- รองรับไฟล์ .xlsx และ .csv", "", "", ""],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(guideSheet);
  ws2["!cols"] = [{ wch: 16 }, { wch: 50 }, { wch: 28 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws2, "คู่มือ");

  // ── Sheet 3: รายชื่อสาขา ─────────────────────────────────────────────────
  const branchSheet: string[][] = [
    ["branchSlug (ใช้ใน column แรก)", "ชื่อสาขา"],
    ...branches.map((b) => [b.slug, b.name]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(branchSheet);
  ws3["!cols"] = [{ wch: 28 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, "รายชื่อสาขา");

  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  return new NextResponse(blob, {
    headers: {
      "Content-Disposition":
        'attachment; filename="maid-collections-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

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
// 2026-06-16 · column 1 renamed "branchSlug" → "สาขา" (accepts Thai name OR slug).
const CSV_HEADER = [
  "สาขา",
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
  // 2026-06-16 · pre-fill ONE ROW PER active branch (Thai name in column สาขา)
  // so the CEO just types the amount + time next to the branch he collected.
  // Rows left without amount AND time are skipped on import (skeleton rows), so
  // it's fine to ship every branch even if only a few get filled.
  const now = new Date();
  const exampleDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 10:30`;

  const dataSheet: (string | number)[][] = [
    [...CSV_HEADER],
    ...branches.map((b) => [b.name, "", "", "", "", ""]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(dataSheet);

  // Set column widths for readability
  ws1["!cols"] = [
    { wch: 28 }, // สาขา
    { wch: 18 }, // collectedAt
    { wch: 14 }, // countedAmount
    { wch: 16 }, // maidPhone
    { wch: 20 }, // notes
    { wch: 40 }, // slipUrl
  ];

  XLSX.utils.book_append_sheet(wb, ws1, "กรอกข้อมูล");

  // ── Sheet 2: คู่มือ ──────────────────────────────────────────────────────
  const exampleBranchName = branches[0]?.name ?? "สาขาตัวอย่าง";
  const guideSheet: string[][] = [
    ["ชื่อ column", "คำอธิบาย", "ตัวอย่าง", "บังคับ?"],
    ["สาขา", "ชื่อสาขา (พิมพ์ชื่อจริงได้เลย) หรือ slug — ในไฟล์เติมชื่อสาขาให้แล้วทุกสาขา", exampleBranchName, "✅ บังคับ"],
    ["collectedAt", "วันเวลาที่เก็บเงิน รูปแบบ: YYYY-MM-DD HH:mm", exampleDate, "✅ บังคับ"],
    ["countedAmount", "ยอดเงินที่นับได้ (บาท · จำนวนเต็มบวกเท่านั้น)", "5400", "✅ บังคับ"],
    ["maidPhone", 'เบอร์แม่บ้าน · เว้นว่าง=แม่บ้านประจำสาขา · พิมพ์ "แอดมิน" = แอดมินเก็บเอง', "0891234567 หรือ แอดมิน", "⬜ ใส่หรือเว้นได้"],
    ["notes", "หมายเหตุเพิ่มเติม", "เก็บย้อนหลัง 3 มิ.ย.", "⬜ ใส่หรือเว้นได้"],
    ["slipUrl", "URL รูปสลิปฝากเงิน (ถ้ามี · ต้องเป็น URL จากระบบเท่านั้น)", "", "⬜ ใส่หรือเว้นได้"],
    [],
    ["⚠ หมายเหตุ", "", "", ""],
    ["- ห้ามเปลี่ยนชื่อ column ในแถวแรกของ sheet กรอกข้อมูล", "", "", ""],
    ["- ไฟล์เติมชื่อสาขาให้แล้วทุกสาขา — กรอกแค่ยอด+เวลา ข้างสาขาที่เก็บ", "", "", ""],
    ["- สาขาที่ไม่ได้กรอกยอด+เวลา ระบบจะข้ามให้ (ไม่ต้องลบแถวออก)", "", "", ""],
    ['- แอดมินเก็บเงินเอง: พิมพ์ "แอดมิน" ในช่อง maidPhone ของแถวนั้น', "", "", ""],
    ["- รองรับไฟล์ .xlsx และ .csv", "", "", ""],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(guideSheet);
  ws2["!cols"] = [{ wch: 16 }, { wch: 56 }, { wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws2, "คู่มือ");

  // ── Sheet 3: รายชื่อสาขา ─────────────────────────────────────────────────
  // Reference only · column สาขา accepts either of these. Name first now that
  // it's the recommended value.
  const branchSheet: string[][] = [
    ["ชื่อสาขา (พิมพ์ในช่อง สาขา ได้เลย)", "slug (สำรอง)"],
    ...branches.map((b) => [b.name, b.slug]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(branchSheet);
  ws3["!cols"] = [{ wch: 32 }, { wch: 26 }];
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

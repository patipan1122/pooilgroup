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
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const exampleDate = `${dateStr} 10:30`;
  const exampleDate2 = `${dateStr} 16:45`;
  const exampleBranchName = branches[0]?.name ?? "สาขาตัวอย่าง";

  const dataSheet: (string | number)[][] = [
    [...CSV_HEADER],
    // 2026-06-23 · CEO asked for a visible filled example in the template. These
    // two demo rows show a completed row at a glance. The สาขา column starts with
    // "ตัวอย่าง" so previewMaidCsv() auto-skips them (isExampleRow) — the CEO does
    // NOT have to delete them. The slipUrl cell is intentionally left blank to
    // show that NO slip is required.
    [
      `ตัวอย่าง ▸ ${exampleBranchName} (ระบบข้ามแถวนี้ให้)`,
      exampleDate,
      5400,
      "0891234567",
      "รอบเช้า · ไม่ต้องมีสลิปก็ได้",
      "",
    ],
    [
      "ตัวอย่าง ▸ แอดมินเก็บเอง",
      exampleDate2,
      3200,
      "แอดมิน",
      'พิมพ์ "แอดมิน" = แอดมินเก็บแทนแม่บ้าน',
      "",
    ],
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
  const guideSheet: string[][] = [
    ["ชื่อ column", "คำอธิบาย", "ตัวอย่าง", "บังคับ?"],
    ["สาขา", "ชื่อสาขา (พิมพ์ชื่อจริงได้เลย) หรือ slug — ในไฟล์เติมชื่อสาขาให้แล้วทุกสาขา", exampleBranchName, "✅ บังคับ"],
    ["collectedAt", "วันเวลาที่เก็บเงิน รูปแบบ: YYYY-MM-DD HH:mm", exampleDate, "✅ บังคับ"],
    ["countedAmount", "ยอดเงินที่นับได้ (บาท · จำนวนเต็มบวกเท่านั้น)", "5400", "✅ บังคับ"],
    ["maidPhone", 'เบอร์แม่บ้าน · เว้นว่าง=แม่บ้านประจำสาขา · พิมพ์ "แอดมิน" = แอดมินเก็บเอง', "0891234567 หรือ แอดมิน", "⬜ ใส่หรือเว้นได้"],
    ["notes", "หมายเหตุเพิ่มเติม", "เก็บย้อนหลัง 3 มิ.ย.", "⬜ ใส่หรือเว้นได้"],
    ["slipUrl", "ไม่ต้องกรอก · เว้นว่างได้เลย (หรือจะลบคอลัมน์นี้ทิ้งทั้งคอลัมน์ก็ยังอัปได้)", "", "⬜ ไม่ต้องมีสลิปก็อัปได้"],
    [],
    ["⚠ หมายเหตุ", "", "", ""],
    ["- ห้ามเปลี่ยนชื่อ column ในแถวแรกของ sheet กรอกข้อมูล", "", "", ""],
    ["- 2 แถวแรกที่ขึ้นต้นว่า \"ตัวอย่าง\" = ตัวอย่างให้ดู ระบบข้ามให้อัตโนมัติ (ไม่ต้องลบ)", "", "", ""],
    ["- ไฟล์เติมชื่อสาขาให้แล้วทุกสาขา — กรอกแค่ยอด+เวลา ข้างสาขาที่เก็บ", "", "", ""],
    ["- สาขาที่ไม่ได้กรอกยอด+เวลา ระบบจะข้ามให้ (ไม่ต้องลบแถวออก)", "", "", ""],
    ['- แอดมินเก็บเงินเอง: พิมพ์ "แอดมิน" ในช่อง maidPhone ของแถวนั้น', "", "", ""],
    ["- ไม่มีสลิป/ไม่อยากใช้ช่อง maidPhone-notes-slipUrl → เว้นว่าง หรือลบทั้งคอลัมน์ท้ายได้", "", "", ""],
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

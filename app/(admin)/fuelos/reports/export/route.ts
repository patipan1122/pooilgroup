import { getCurrentUser, atLeast } from "@/lib/fuelos/auth";
import { getOrderCsvRows } from "@/lib/fuelos/reports-data";
import { audit } from "@/lib/fuelos/audit";
import { bkkDate } from "@/lib/fuelos/utils/format";

export const dynamic = "force-dynamic";

// แต่ละ field ของ CSV → ครอบด้วย " และ escape " ภายใน
function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  // route handler → ไม่ redirect; คืน 401/403 ตรง ๆ
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!atLeast(user.role, "SALES_HEAD")) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await getOrderCsvRows(user.orgId);

  const header = [
    "วันที่",
    "เลขที่ออเดอร์",
    "ลูกค้า",
    "ชนิดน้ำมัน",
    "ปริมาณ (ลิตร)",
    "ราคาขาย",
    "ต้นทุน",
    "กำไร",
  ];

  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(bkkDate(r.date)),
        csvCell(r.orderNo),
        csvCell(r.customer),
        csvCell(r.product),
        csvCell(r.liters.toFixed(0)),
        csvCell(r.sell.toFixed(2)),
        csvCell(r.cost.toFixed(2)),
        csvCell(r.profit.toFixed(2)),
      ].join(","),
    );
  }

  // ﻿ BOM → Excel เปิดไฟล์แล้วอ่านภาษาไทย UTF-8 ได้ถูก
  const csv = "﻿" + lines.join("\r\n");

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "REPORT_EXPORT",
    entity: "Order",
    meta: { rows: rows.length, scope: "month" },
  });

  // ชื่อไฟล์ต้องเป็น ASCII (HTTP header เก็บภาษาไทยไม่ได้) → ใช้วันที่ ISO
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

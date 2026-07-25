// GET /api/cafeorder/menu/template?brand=amazon|punthai
//   ดาวน์โหลด .xlsx **เติมเมนูจริงจาก research ไว้พร้อม** — CEO แก้ราคาให้ตรงสาขาแล้ว import = seed.
//   3 แท็บ: เมนู (pre-filled) · ตัวเลือก (presets) · วิธีกรอก. Manager ขึ้นไป.
import { type NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/auth/session";
import { canCafeManage } from "@/lib/cafeorder/role-guard";
import { AMAZON_MENU, PUNTHAI_MENU, OPTION_PRESETS, type SeedMenu } from "@/lib/cafeorder/seed-menu-data";

export const dynamic = "force-dynamic";

const HEADER = [
  "หมวด", "ชื่อเมนู", "ประเภท", "คำอธิบาย", "รูป_URL", "เปิดขาย(Y/N)",
  "ราคาร้อน", "ราคาเย็น", "ราคาปั่น", "ราคาเดี่ยว", "อัพไซส์เพิ่ม", "กลุ่มตัวเลือก",
];

function itemRow(m: SeedMenu): (string | number)[] {
  const groups = m.kind === "food" ? "" : "หวาน,น้ำแข็ง,ช็อต";
  return [
    m.category, m.name, m.kind === "food" ? "ของกิน" : "เครื่องดื่ม", "",
    m.image ?? "", "Y",
    m.hot ?? "", m.iced ?? "", m.blended ?? "", m.single ?? "", m.upsize ?? "", groups,
  ];
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!canCafeManage(session.user.role)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  const brand = req.nextUrl.searchParams.get("brand") === "punthai" ? "punthai" : "amazon";
  const menu = brand === "punthai" ? PUNTHAI_MENU : AMAZON_MENU;

  const wb = XLSX.utils.book_new();

  // แท็บ 1 · เมนู (เติมจริงไว้)
  const items = [HEADER, ...menu.map(itemRow)];
  const sh1 = XLSX.utils.aoa_to_sheet(items);
  sh1["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sh1, "เมนู");

  // แท็บ 2 · ตัวเลือก (presets)
  const optHeader = ["ชื่อกลุ่มตัวเลือก", "เลือกได้(เดี่ยว/หลาย)", "บังคับเลือก(Y/N)", "โชว์เฉพาะ(ทุกแบบ/เย็น)", "ตัวเลือกและราคา (ชื่อ:บาท คั่นด้วย |)"];
  const opts = [optHeader, ...OPTION_PRESETS.map((o) => [o.name, o.select, o.required, o.visible, o.choices])];
  const sh2 = XLSX.utils.aoa_to_sheet(opts);
  sh2["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, sh2, "ตัวเลือก");

  // แท็บ 3 · วิธีกรอก
  const guide = [
    ["วิธีกรอก template เมนู CafeOrder"],
    [""],
    ["1. แท็บ 'เมนู' เติมเมนูจริงไว้แล้ว — แก้ราคาให้ตรงสาขาของคุณ แล้วอัปกลับ"],
    ["2. เพิ่มเมนูใหม่ = เพิ่มบรรทัด · ลบเมนู = ลบบรรทัด (การ import จะไม่ลบของเดิม เพิ่ม/อัปเดตเท่านั้น)"],
    ["3. ราคาปล่อยว่างได้ถ้าเมนูนั้นไม่มีแบบนั้น (เช่น เมนูเย็นอย่างเดียว = ใส่แค่ 'ราคาเย็น')"],
    ["4. 'อัพไซส์เพิ่ม' = บาทที่บวกเมื่อเลือกแก้วใหญ่ (ว่าง = ไม่มีแก้วใหญ่)"],
    ["5. ของกิน = ใส่ 'ประเภท' ว่า ของกิน แล้วกรอก 'ราคาเดี่ยว'"],
    ["6. 'กลุ่มตัวเลือก' = ชื่อกลุ่มจากแท็บ 'ตัวเลือก' คั่นด้วย , (เช่น หวาน,น้ำแข็ง,ช็อต)"],
    ["7. อัปไฟล์นี้ที่หน้า 'นำเข้าไฟล์' → ระบบพรีวิวให้ดูก่อนยืนยัน"],
    [""],
    ["⚠️ อย่าแก้ชื่อหัวคอลัมน์ (แถวแรก)"],
  ];
  const sh3 = XLSX.utils.aoa_to_sheet(guide);
  sh3["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, sh3, "วิธีกรอก");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fname = `cafeorder-menu-${brand}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}

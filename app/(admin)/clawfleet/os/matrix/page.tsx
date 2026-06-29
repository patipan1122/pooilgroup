/**
 * ตู้คีบ OS — รายงานเจาะสาขา (Matrix)
 * ตารางลึก ตู้ × รายวันย้อนหลัง ในหน้าเดียว — เลือกสาขา, สลับค่าในช่อง (ต้นทุน/ยอดเก็บ/ตุ๊กตา/รวม3),
 * สลับช่วง 20/30 วัน, คลิกหัวคอลัมน์เพื่อเจาะดูรายตู้.
 *
 * Server: โหลด "รายชื่อสาขา" จริง (getV2Branches) สำหรับ chips. ถ้า DB ว่าง → client ใช้สาขาตัวอย่าง.
 * ⚠️ Backend gap: ยังไม่มี query สำหรับเมทริกซ์ ตู้×วัน (ต้นทุน/ยอดเก็บ/ตุ๊กตา รายวัน) →
 *   ฝั่ง client สร้างข้อมูลตัวอย่างแบบ deterministic เพื่อโชว์โครงหน้าก่อน (จะต่อ query จริงภายหลัง).
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { MatrixClient, type MatrixBranch } from "./matrix-client";

export const dynamic = "force-dynamic";

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;

  let branches: MatrixBranch[] = [];
  try {
    const rows = await getV2Branches();
    branches = rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      machines: b.machines,
    }));
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้สาขาตัวอย่าง
  }

  return <MatrixClient branches={branches} initialBranch={sp.branch ?? null} />;
}

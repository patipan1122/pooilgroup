/**
 * ตู้คีบ OS — รายงานเจาะสาขา (Matrix)
 * ตารางลึก ตู้ × รายวันย้อนหลัง ในหน้าเดียว — เลือกสาขา, สลับค่าในช่อง (ต้นทุน/ยอดเก็บ/ตุ๊กตา/รวม3),
 * สลับช่วง 20/30 วัน, คลิกหัวคอลัมน์เพื่อเจาะดูรายตู้.
 *
 * Server: โหลด "รายชื่อสาขา" จริง (getV2Branches) สำหรับ chips + เมทริกซ์จริง ตู้×วัน
 *         (getMatrixData) ของสาขา/ช่วงที่เลือก (ผ่าน searchParams ?branch & ?days).
 * ทุกตัวเลขในช่อง = ข้อมูลจริงจาก cf_collection_events. DB ว่าง → client โชว์ตัวอย่าง.
 */
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getMatrixData } from "@/lib/clawfleet/matrix-queries";
import { MatrixClient, type MatrixBranch, type MatrixSerialMachine } from "./matrix-client";

export const dynamic = "force-dynamic";

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : 20;

  let branches: MatrixBranch[] = [];
  let machines: MatrixSerialMachine[] = [];
  let isoDays: string[] = [];
  let activeBranchCode: string | null = sp.branch ?? null;

  try {
    const rows = await getV2Branches();
    branches = rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      machines: b.machines,
    }));

    // เลือกสาขา: ตาม ?branch ถ้าอยู่ในรายการ ไม่งั้นสาขาแรก
    const picked =
      (sp.branch && branches.find((b) => b.code === sp.branch)?.code) ??
      branches[0]?.code ??
      null;
    activeBranchCode = picked;

    if (picked) {
      const data = await getMatrixData({ branchCode: picked, days });
      isoDays = data.isoDays;
      // serialize Map → record (Server→Client ต้องเป็น plain object)
      machines = data.machines.map((m) => ({
        machineId: m.machineId,
        code: m.code,
        nickname: m.nickname,
        days: Object.fromEntries(
          [...m.byDay.entries()].map(([iso, c]) => [
            iso,
            { cash: c.cash, dolls: c.dolls, cost: c.cost, swapped: c.swapped },
          ]),
        ),
      }));
    }
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้สาขาตัวอย่าง + เมทริกซ์ตัวอย่าง
  }

  return (
    <MatrixClient
      branches={branches}
      initialBranch={activeBranchCode}
      isoDays={isoDays}
      machines={machines}
      days={days}
    />
  );
}

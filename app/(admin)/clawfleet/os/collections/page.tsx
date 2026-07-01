/**
 * ตู้คีบ OS — ตรวจเงิน & กระทบยอด (Collections / Audit)
 * Server: รอบเก็บเงินจริง (anomaly inbox) + รายชื่อสาขา (สำหรับตัวกรอง).
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง"
 * (ตาม pattern ClawFleet เดิม — ห้ามหน้าโล่ง).
 */
import { loadAnomalies } from "@/lib/clawfleet/loaders";
import { getV2Branches } from "@/lib/clawfleet/queries";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { userBranchIds } from "@/lib/clawfleet/role-guard";
import { CollectionsClient, type CollectionRow, type BranchOption } from "./collections-client";

export const dynamic = "force-dynamic";

/**
 * org นี้ "เคยเก็บเงิน" ไหม (มี CfCollectionSession ใด ๆ) — scope ด้วย org + สาขาที่ user เห็น.
 * ใช้แยก "ยังไม่เคยเก็บเลย" (→ โชว์ตัวอย่าง) ออกจาก "เก็บแล้วแต่ไม่มีผิดปกติ" (→ empty-state จริง).
 * query พัง/ยังไม่ migrate → false (โชว์ตัวอย่างได้ · ปลอดภัยกว่าโชว์ empty ปลอม).
 */
async function orgHasAnyRounds(): Promise<boolean> {
  try {
    const session = await requireSession();
    const orgId = session.user.org_id;
    const branchIds = await userBranchIds(session);
    const branchWhere = branchIds === "ALL" ? {} : { branchId: { in: branchIds } };
    const n = await prisma.cfCollectionSession.count({ where: { orgId, ...branchWhere } });
    return n > 0;
  } catch {
    return false;
  }
}

export default async function CollectionsPage() {
  let anomalies: Awaited<ReturnType<typeof loadAnomalies>> = [];
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  let hasAnyRounds = false;
  try {
    [anomalies, branches, hasAnyRounds] = await Promise.all([
      loadAnomalies("all"),
      getV2Branches(),
      orgHasAnyRounds(),
    ]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ sample fallback
  }

  const branchOptions: BranchOption[] = branches.map((b) => ({
    value: b.id,
    label: `${b.name} (${b.code})`,
  }));

  // Map Anomaly → CollectionRow (รอบเก็บที่ระบบ flag = "ไม่ตรง")
  // expectedCash/actualCash/gap จาก loader เป็น "บาท" แล้ว (v2 client โชว์ ฿gap ตรง ๆ)
  const rows: CollectionRow[] = anomalies.map((a) => ({
    id: a.id,
    code: a.id,
    branch: a.branchName ?? a.branchCode ?? "สาขา",
    staff: a.staff || "—",
    date: a.timeAgo ? `${a.timeAgo}ที่แล้ว` : a.timestamp || "—",
    expectedCash: a.expectedCash,
    actualCash: a.actualCash,
    gap: a.gap,
    prizeExpected: a.prizeExpected,
    prizeActual: a.prizeActual,
    prizeGap: a.prizeGap,
    severity: a.severity,
    type: a.type,
    reason: a.reason || a.typeLabel || "ยอดไม่ตรงกับมิเตอร์",
    // รูปจริงที่พนักงานถ่ายต่อตู้ (anti-cheat) — ผ่าน eventToMachine → photoShots
    machines: a.machines.map((m) => ({
      code: m.code,
      name: m.name,
      photoShots: m.photoShots ?? [],
    })),
    // มิเตอร์ต่อเนื่อง: real loader ยังไม่ส่ง meter snapshot → ใช้ค่าประเมินจาก gap
    sample: false,
  }));

  return <CollectionsClient rows={rows} branchOptions={branchOptions} hasAnyRounds={hasAnyRounds} />;
}

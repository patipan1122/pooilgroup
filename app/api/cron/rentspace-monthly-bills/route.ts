// Cron — RentSpace auto monthly billing (ทุกวันที่ 1 เวลา 01:00)
// ────────────────────────────────────────────────────────────────────
// สำหรับทุกโครงการที่เปิด auto-bill → ออกบิลงวดเดือนปัจจุบันให้ทุกสัญญาที่ active
//   - rent (+ escalation), ค่าน้ำ-ไฟจากมิเตอร์ที่จดไว้, ค่าปรับจากบิลค้างเดือนก่อน
//   - Idempotent: @@unique([contractId, period]) → รันซ้ำ = ไม่ออกบิลซ้ำ
// Auth: Bearer ${CRON_SECRET}
// ────────────────────────────────────────────────────────────────────
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { currentPeriod } from "@/lib/rentspace/format";
import { createBillForContract } from "@/lib/rentspace/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const period = currentPeriod();

  // sweep: lapsed contracts (endDate ผ่านไปแล้ว) → expired (แค่ป้ายบอก "เลยวันหมดอายุ")
  // CEO 2026-08-09: expired = holdover (เช่าต่อรายเดือน) → ยังออกบิลอัตโนมัติต่อ (ดู filter ล่าง)
  await prisma.rentalContract.updateMany({
    where: { status: { in: ["active", "expiring"] }, endDate: { lt: new Date() } },
    data: { status: "expired" },
  });

  const projects = await prisma.rentalProject.findMany({
    where: { isActive: true, autoBillEnabled: true },
  });

  const summary: {
    project: string;
    created: number;
    skipped: number;
    errors: number;
    failed?: boolean;
    failureReason?: string;
  }[] = [];

  for (const project of projects) {
    // Per-project isolation: this cron runs once a month, so if one project's
    // query/audit throws and aborts the whole loop, every OTHER project also
    // silently gets skipped until next month. Wrap each project independently
    // so one bad project never blocks the rest.
    try {
      const contracts = await prisma.rentalContract.findMany({
        // รวม expired (holdover) ให้ตรงกับ actGenerateMonthlyBills · ตัดเฉพาะ terminated/draft
        where: { projectId: project.id, status: { in: ["active", "expiring", "expired"] } },
        include: { project: true, unit: true },
      });
      let created = 0;
      let skipped = 0;
      let errors = 0;
      for (const c of contracts) {
        try {
          // Idempotent: createBillForContract early-returns when a bill for
          // (contractId, period) already exists → buildBill (rent + meters + late
          // fee + recurring charges) runs at most once per bill, so re-running the
          // cron never double-adds line items. res.created=false ⇒ skipped.
          const res = await createBillForContract(c, period, { auto: true, issue: true });
          if (res.created) created++;
          else skipped++;
        } catch {
          errors++;
        }
      }
      if (created > 0 || errors > 0) {
        await audit({
          orgId: project.orgId,
          userId: null,
          action: "RENTSPACE_BILL_AUTO_CREATED",
          resourceType: "rental_project",
          resourceId: project.id,
          diff: { new: { period, created, skipped, errors } },
        });
      }
      summary.push({ project: project.name, created, skipped, errors });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(
        `[rentspace-monthly-bills] project ${project.id} (${project.name}) failed — skipped, continuing to next project:`,
        e,
      );
      summary.push({
        project: project.name,
        created: 0,
        skipped: 0,
        errors: 0,
        failed: true,
        failureReason: reason,
      });
    }
  }

  const failedProjects = summary.filter((s) => s.failed);
  return NextResponse.json({
    ok: failedProjects.length === 0,
    period,
    projects: summary,
    failedCount: failedProjects.length,
  });
}

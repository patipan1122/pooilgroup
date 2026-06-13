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
  if (header === `Bearer ${secret}`) return true;
  // Vercel cron also supports the x-vercel-cron header on the configured path
  return req.headers.get("x-vercel-cron") != null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const period = currentPeriod();
  const projects = await prisma.rentalProject.findMany({
    where: { isActive: true, autoBillEnabled: true },
  });

  const summary: { project: string; created: number; skipped: number; errors: number }[] = [];

  for (const project of projects) {
    const contracts = await prisma.rentalContract.findMany({
      where: { projectId: project.id, status: { in: ["active", "expiring"] } },
      include: { project: true, unit: true },
    });
    let created = 0;
    let skipped = 0;
    let errors = 0;
    for (const c of contracts) {
      try {
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
  }

  return NextResponse.json({ ok: true, period, projects: summary });
}

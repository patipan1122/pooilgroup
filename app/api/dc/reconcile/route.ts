// GET /api/dc/reconcile
// Runs the DC reconcile maintenance pass (runDcReconcile) and returns JSON.
//
// Auth (either is sufficient):
//   • CRON_SECRET — header `Authorization: Bearer <CRON_SECRET>`.
//     - with `?orgId=<uuid>` → reconcile that one org.
//     - WITHOUT orgId (the Vercel Cron case) → SWEEP every org that owns a DC
//       warehouse. No hard-coded UUID, scales to multi-org / multi-warehouse.
//   • or a logged-in DC manager session — scoped to that user's own org.
//
// Safe by construction: runDcReconcile never throws and never moves money; it only
// auto-promotes stale transfers and surfaces count-task suggestions.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";
import { runDcReconcile } from "@/lib/dc/reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;

  let orgId: string | null = null;

  if (isCron) {
    orgId = request.nextUrl.searchParams.get("orgId");
    if (!orgId) {
      // Vercel Cron: no org named → reconcile every org that has a DC warehouse.
      const orgs = await prisma.dcWarehouse.findMany({
        select: { orgId: true },
        distinct: ["orgId"],
      });
      const results = [];
      for (const o of orgs) {
        // runDcReconcile is non-throwing, but guard anyway so one bad org
        // never aborts the whole sweep.
        try {
          results.push({ orgId: o.orgId, ...(await runDcReconcile(o.orgId)) });
        } catch (e) {
          results.push({ orgId: o.orgId, ok: false, error: e instanceof Error ? e.message : "error" });
        }
      }
      return NextResponse.json({ ok: true, swept: results.length, results });
    }
  } else {
    // Session caller — must be a DC manager; always scoped to their own org.
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" }, { status: 401 });
    }
    if (!canDcManage(session.user.role)) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
    orgId = session.user.org_id;
  }

  try {
    const result = await runDcReconcile(orgId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ไม่ทราบสาเหตุ";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

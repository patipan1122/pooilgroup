"use server";

// Reconcile lib-level server actions (W2 claude-design Phase 2).
//
// Why this file lives in `lib/` (not `app/(admin)/chairops/reconcile/actions.ts`):
// the page-level `actions.ts` already owns mutations that share `actions` server
// fields (disputeCollection / requestWriteOff / approve / reject). This file
// is a thin server-action layer for the redesigned `(office)/reconcile` UI to
// invoke (e.g. the "recompute drift for this branch" button in the detail
// header). New W2 actions land here so we don't touch the existing
// reconcile/actions.ts that BR15 chain depends on.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import {
  recomputeDriftForBranch,
  recomputeAllDrifts,
} from "@/lib/chairops/reconcile/drift-engine";
import { writeAudit } from "@/lib/chairops/audit/log";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { pushBranchDepositsToLedger } from "@/lib/chairops/reconcile/ledger-push";

// TODO[claude-design]: Wave 2 · expand to optionally re-evaluate alerts after
// recompute so the right-rail alert badge refreshes without a second call.
// Today the page already refetches alerts on revalidate · safe enough for pilot.
export async function recomputeDriftForBranchAction(
  branchId: string,
): Promise<{ ok: true; driftAmount: number } | { ok: false; error: string }> {
  if (!branchId || typeof branchId !== "string") {
    return { ok: false, error: "missing branchId" };
  }
  const session = await requireRole("OFFICE");
  // CO-QA-02 fix: verify the branch belongs to the actor's org before recompute.
  // Without this, OFFICE of org A could recompute + overwrite drift of org B's
  // branch (cross-tenant IDOR write).
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId },
    select: { id: true },
  });
  if (!branch) {
    return { ok: false, error: "ไม่พบสาขา หรือไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  try {
    const snap = await recomputeDriftForBranch(branchId);
    await writeAudit({
      userId: session.user.id,
      action: "drift.recompute_manual",
      entity: "Drift",
      entityId: branchId,
      newValue: { driftAmount: snap.driftAmount, status: snap.status },
    });
    revalidatePath("/chairops/reconcile");
    revalidatePath(`/chairops/reconcile/${branchId}`);
    return { ok: true, driftAmount: snap.driftAmount };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ไม่สามารถ recompute ได้",
    };
  }
}

// ────────────────────────────────────────────────────────────────
// FIN-01 (audit 2026-06-15): "ปิดงวดเงินขาด" — เปลี่ยนตัวเลขเงินขาดจาก
// "สะสมตลอดชีพสาขา" (legacy default ที่ขัดกฎ CEO "ห้ามสะสมเงินขาด") เป็น
// "รายงวด" (window mode · วัดตั้งแต่ครั้งปิดงวดล่าสุด).
//
// กลไก: drift-engine window mode ใช้ branch.lastReconcileClosedAt เป็น anchor
// แต่เดิม "ไม่เคยมีโค้ดไหนเขียนค่านี้" → window mode fall back ไป createdAt =
// ยังสะสมตลอดชีพ. action นี้คือตัวเขียน anchor ที่ขาดไป.
//
// ทำ 3 ขั้นแบบ atomic ต่อ org:
//   1) snapshot ยอดเงินขาดสะสมปัจจุบันของทุกสาขา → audit log (หลักฐานก่อน reset)
//   2) set lastReconcileClosedAt = now (เปิดงวดใหม่)
//   3) recompute → เงินขาดเริ่มนับใหม่ตั้งแต่วันปิดงวด
//
// ต้องตั้ง env CHAIROPS_DRIFT_MODE=window ด้วย ตัวเลขถึงจะเป็นรายงวดจริง
// (ไม่งั้น legacy mode จะ ignore lastReconcileClosedAt). ผ่าน FIN+OFC+AUD lens.
export async function closePeriodForOrg(): Promise<
  | { ok: true; closedAt: string; branchCount: number; snapshotTotal: number }
  | { ok: false; error: string }
> {
  const session = await requireRole("ADMIN");
  // ปิดงวด = รีเซ็ตฐานการนับเงินขาดของทั้งองค์กร (money op สำคัญ) → super_admin เท่านั้น
  // (เหมือนปุ่มเชื่อมต่อภายนอกอื่น ๆ · CEO 2026-06-12).
  if (!isSuperAdmin(session.poolUser.role)) {
    return { ok: false, error: "เฉพาะผู้ดูแลสูงสุด (super admin) เท่านั้นที่ปิดงวดได้" };
  }
  const orgId = session.user.orgId;
  try {
    const branches = await prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (branches.length === 0) {
      return { ok: false, error: "ไม่พบสาขาที่เปิดใช้งาน" };
    }

    // 1) snapshot ยอดเงินขาดสะสมก่อนปิดงวด (หลักฐาน · ไม่ใช่การเก็บเงินจริง)
    const snapshots: { branchId: string; name: string; driftAmount: number }[] = [];
    for (const b of branches) {
      const snap = await recomputeDriftForBranch(b.id);
      snapshots.push({ branchId: b.id, name: b.name, driftAmount: snap.driftAmount });
    }
    const snapshotTotal = snapshots.reduce((s, x) => s + x.driftAmount, 0);
    const closedAt = new Date();

    // 2) เขียน anchor + audit หลักฐานแบบ atomic
    await prisma.$transaction([
      prisma.chairopsBranch.updateMany({
        where: { orgId, isActive: true },
        data: { lastReconcileClosedAt: closedAt },
      }),
    ]);
    await writeAudit({
      userId: session.user.id,
      action: "drift.period_closed",
      entity: "Branch",
      entityId: "ALL",
      orgId,
      newValue: {
        closedAt: closedAt.toISOString(),
        branchCount: branches.length,
        snapshotTotal,
        snapshots,
      },
    });

    // 3) recompute → เริ่มนับงวดใหม่
    await recomputeAllDrifts(orgId);
    revalidatePath("/chairops/reconcile");
    revalidatePath("/chairops");

    return {
      ok: true,
      closedAt: closedAt.toISOString(),
      branchCount: branches.length,
      snapshotTotal,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ปิดงวดไม่สำเร็จ",
    };
  }
}

// ────────────────────────────────────────────────────────────────
// CEO 2026-07-01: "ปิดสาขา" (ย้าย/เลิกกิจการ) จากแถบซ้ายหน้าตรวจยอด.
// ใช้ ChairopsBranch.closedAt (มีอยู่แล้ว · ไม่ต้อง migration) เป็นตัวมาร์ค UI —
// สาขาที่ closedAt != null จะถูกดันไปล่างสุดของแถบ + หรี่สี · ยังเห็นได้ ยังไม่ลบ
// ข้อมูล และ "ไม่แตะ" isActive → drift/ledger/รายงานยังคำนวณเหมือนเดิมทุกอย่าง.
// เปิดคืนได้ (closed=false → closedAt=null). super_admin เท่านั้น (เหมือนปุ่มปิดงวด).
export async function toggleBranchClosedAction(
  branchId: string,
  closed: boolean,
): Promise<{ ok: true; closed: boolean } | { ok: false; error: string }> {
  if (!branchId || typeof branchId !== "string") {
    return { ok: false, error: "missing branchId" };
  }
  const session = await requireRole("OFFICE");
  if (!isSuperAdmin(session.poolUser.role)) {
    return {
      ok: false,
      error: "เฉพาะผู้ดูแลสูงสุด (super admin) เท่านั้นที่ปิด/เปิดสาขาได้",
    };
  }
  // org-scope guard — กันแก้สาขาข้ามองค์กร (IDOR write).
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId },
    select: { id: true, name: true, closedAt: true },
  });
  if (!branch) {
    return { ok: false, error: "ไม่พบสาขา หรือไม่มีสิทธิ์เข้าถึงสาขานี้" };
  }
  try {
    const nextClosedAt = closed ? new Date() : null;
    await prisma.chairopsBranch.update({
      where: { id: branchId },
      data: { closedAt: nextClosedAt },
    });
    await writeAudit({
      userId: session.user.id,
      action: closed ? "branch.close" : "branch.reopen",
      entity: "Branch",
      entityId: branchId,
      oldValue: { closedAt: branch.closedAt?.toISOString() ?? null },
      newValue: { closedAt: nextClosedAt?.toISOString() ?? null },
    });
    revalidatePath("/chairops/reconcile");
    revalidatePath(`/chairops/reconcile/${branchId}`);
    // CEO 2026-08-23: closedAt now also drives /chairops/maids' branch rows.
    revalidatePath("/chairops/maids");
    return { ok: true, closed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ปิด/เปิดสาขาไม่สำเร็จ",
    };
  }
}

// CEO 2026-09-09 (Pinpoint): "อยากให้มีปุ่มส่งเข้าบัญชี reconcile กดส่งสาขาไหนบ้าง
// ให้ติ๊กสาขา แบบส่งทั้งหมด หรือติ๊กบางสาขาออก" — ส่งฝากของหลายสาขาเข้า
// ledger_revenue_entry ในคลิกเดียว แทนที่ต้องเปิดทีละสาขาแล้วกด sendDepositsToReconcile
// (app/(admin)/chairops/reconcile/actions.ts) ทีละครั้ง. เรียก
// pushBranchDepositsToLedger ต่อสาขาแบบ per-branch try/catch (สาขาหนึ่งพัง ไม่ทำให้
// สาขาอื่นในชุดพังตาม — ตาม pattern bulkApproveWriteOffsAction) โดยที่ตัวฟังก์ชันเอง
// กันส่งซ้ำอยู่แล้วใน DB (ON CONFLICT ... source_ref) จึงกดซ้ำได้ปลอดภัย.
export async function bulkSendDepositsToReconcileAction(
  branchIds: string[],
): Promise<
  | {
      ok: true;
      sentCount: number;
      skippedCount: number;
      errorCount: number;
      totalInserted: number;
    }
  | { ok: false; error: string }
> {
  const ids = Array.from(
    new Set(branchIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  if (ids.length === 0) {
    return { ok: false, error: "ไม่ได้เลือกสาขา" };
  }
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  // org-scope guard — กันส่งข้ามองค์กร (IDOR write) เผื่อ id หลุดมาจากที่อื่น
  const branches = await prisma.chairopsBranch.findMany({
    where: { id: { in: ids }, orgId },
    select: { id: true },
  });

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let totalInserted = 0;
  for (const branch of branches) {
    const result = await pushBranchDepositsToLedger(orgId, branch.id);
    await writeAudit({
      userId: session.user.id,
      action: "chairops_deposit.send_to_ledger",
      entity: "ChairopsBranch",
      entityId: branch.id,
      newValue: { ...result, bulk: true },
    });
    if (!result.ok) errorCount++;
    else if (result.inserted === 0) skippedCount++;
    else {
      sentCount++;
      totalInserted += result.inserted;
    }
  }

  revalidatePath("/chairops/reconcile");
  for (const branch of branches) revalidatePath(`/chairops/reconcile/${branch.id}`);

  return { ok: true, sentCount, skippedCount, errorCount, totalInserted };
}

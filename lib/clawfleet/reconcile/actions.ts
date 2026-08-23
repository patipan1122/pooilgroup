"use server";

// ClawFleet reconcile bridge (CEO 2026-08-23): ตั้งค่าบริษัท/บัญชีธนาคารของสาขา
// (1 บัญชีตายตัวต่อสาขา) + ปุ่มส่งยอดฝากเข้า ledger_revenue_entry (bank-recon).
// mirror ของ app/(admin)/chairops/reconcile/actions.ts — ดู ./ledger-push.ts
// สำหรับกลไกกันส่งซ้ำ.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { zUUID } from "@/lib/zod-helpers";
import { assertCfAdmin } from "../role-guard";
import {
  getBranchReconcileSummary,
  pushBranchDepositsToLedger,
  type BranchReconcileSummary,
  type PushResult,
} from "./ledger-push";

type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

export type ReconcileStatus = {
  companyId: string | null;
  bankAccountId: string | null;
  summary: BranchReconcileSummary;
};

/** อ่านสถานะบัญชี + สรุปยอดพร้อมส่งของสาขา — เรียกตอนแอดมินเลือกสาขาในการ์ด "ผูกบัญชี" */
export async function getClawfleetReconcileStatus(branchId: string): Promise<ResultOf<ReconcileStatus>> {
  const parsed = zUUID().safeParse(branchId);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  const summary = await getBranchReconcileSummary(orgId, branchId);
  return {
    ok: true,
    data: { companyId: summary.companyId, bankAccountId: summary.bankAccountId, summary },
  };
}

const SetReconcileAccountSchema = z.object({
  branchId: zUUID(),
  companyId: zUUID(),
  bankAccountId: zUUID(),
});

/** บันทึกบริษัท/บัญชีธนาคารของสาขา (upsert — 1 แถวต่อสาขา) */
export async function setClawfleetReconcileAccount(input: unknown): Promise<Result> {
  const parsed = SetReconcileAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { branchId, companyId, bankAccountId } = parsed.data;
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  const existing = await prisma.cfBranchReconcileConfig.findFirst({
    where: { branchId, orgId },
    select: { companyId: true, bankAccountId: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.cfBranchReconcileConfig.upsert({
        where: { branchId },
        create: { orgId, branchId, companyId, bankAccountId },
        update: { companyId, bankAccountId },
      });
      await tx.auditLog.create({
        data: {
          orgId,
          userId: session.user.id,
          action: "CF_BRANCH_RECONCILE_ACCOUNT_SAVE",
          resourceType: "CF_BRANCH_RECONCILE_CONFIG",
          resourceId: branchId,
          diff: {
            old: { companyId: existing?.companyId ?? null, bankAccountId: existing?.bankAccountId ?? null },
            new: { companyId, bankAccountId },
          },
        },
      });
    });
  } catch (e) {
    return { ok: false, error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` };
  }

  revalidatePath("/clawfleet/os/branches");
  return { ok: true };
}

const SendSchema = z.object({ branchId: zUUID() });

/** ส่งยอดฝากของสาขา (ที่ผ่านตรวจแล้ว) เข้า LedgerLine bank-recon — กดซ้ำได้ ระบบข้ามที่ส่งแล้วเอง */
export async function sendClawfleetDepositsToReconcile(input: unknown): Promise<ResultOf<PushResult>> {
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { branchId } = parsed.data;
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, orgId, businessType: "claw_machine" },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ" };

  const result = await pushBranchDepositsToLedger(orgId, branchId);

  await prisma.auditLog.create({
    data: {
      orgId,
      userId: session.user.id,
      action: "CF_DEPOSIT_SEND_TO_LEDGER",
      resourceType: "CF_BRANCH_RECONCILE_CONFIG",
      resourceId: branchId,
      diff: { old: null, new: result },
    },
  });

  if (!result.ok) return { ok: false, error: result.error ?? "ส่งไม่สำเร็จ" };
  revalidatePath("/clawfleet/os/branches");
  return { ok: true, data: result };
}

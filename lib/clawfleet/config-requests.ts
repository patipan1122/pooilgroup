"use server";

// ClawFleet · ตู้คีบ OS — คำขอตั้งค่าตู้ (machine config approval queue)
// พนักงานเสนอปรับความแรงคีบ/ราคา → PENDING → เจ้าของอนุมัติ/ตีกลับ.
// Org-scoped ทุก query/mutation. อนุมัติ/ตีกลับ = admin-tier เท่านั้น (assertCfAdmin).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCfAdmin } from "./role-guard";

type Result = { ok: true } | { ok: false; error: string };
type ResultOf<T> = { ok: true; data: T } | { ok: false; error: string };

const CONFIG_PATH = "/clawfleet/os/config";

/** สถานะคำขอที่ส่งให้ client (เทียบ "pending|approved|rejected" ในดีไซน์) */
export type CfConfigStatus = "pending" | "approved" | "rejected";

/** shape ที่ config-client ต้องใช้ render การ์ดคำขอ + ปุ่มอนุมัติ/ตีกลับ */
export type CfConfigRequestView = {
  id: string;
  status: CfConfigStatus;
  machineCode: string;
  branchName: string;
  branchId: string;
  machineId: string | null;
  productName: string | null;
  clawFrom: number | null;
  clawTo: number | null;
  priceBaht: number | null;
  reason: string;
  submittedByName: string | null;
  submittedAt: string; // ISO — client แปลงเป็น "วันนี้ 09:42" เอง
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

/** DB status (PENDING|APPROVED|REJECTED) → client status */
function toClientStatus(s: string): CfConfigStatus {
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  return "pending";
}

/**
 * รายการคำขอตั้งค่าตู้ของ org ปัจจุบัน (ใหม่สุดก่อน).
 * คืน [] เมื่อ table ยังไม่ถูก migrate (page เรียกใน try/catch อยู่แล้ว แต่กันไว้สองชั้น).
 */
export async function getCfConfigRequests(): Promise<CfConfigRequestView[]> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const rows = await prisma.cfConfigRequest.findMany({
    where: { orgId },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    status: toClientStatus(r.status),
    machineCode: r.machineCode,
    branchName: r.branchName,
    branchId: r.branchId,
    machineId: r.machineId,
    productName: r.productName,
    clawFrom: r.clawFrom,
    clawTo: r.clawTo,
    priceBaht: r.priceBaht,
    reason: r.reason,
    submittedByName: r.submittedByName,
    submittedAt: r.submittedAt.toISOString(),
    reviewedByName: r.reviewedByName,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewNote: r.reviewNote,
  }));
}

const SubmitSchema = z.object({
  branchId: z.string().uuid("ไม่ระบุสาขา"),
  machineId: z.string().uuid().optional(),
  machineCode: z.string().trim().min(1, "กรอกรหัสตู้").max(40),
  productName: z.string().trim().max(160).optional(),
  clawFrom: z.number().int().min(0).max(100).optional(),
  clawTo: z.number().int().min(0).max(100).optional(),
  priceBaht: z.number().int().min(0).max(100000).optional(),
  reason: z.string().trim().min(1, "กรอกเหตุผล").max(1000),
});

/**
 * เสนอคำขอตั้งค่าตู้ใหม่ (สถานะ PENDING). org-scoped + snapshot ชื่อสาขา/ผู้เสนอ.
 * เปิดให้ทุก role ที่ใช้ ClawFleet ได้เสนอ (พนักงานเก็บเงินเป็นผู้เสนอตามดีไซน์) —
 * แค่ตรวจสิทธิ์เข้าถึงสาขานั้นผ่าน FK + org guard.
 */
export async function submitCfConfigRequest(input: unknown): Promise<ResultOf<{ id: string }>> {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const data = parsed.data;
  const session = await requireSession();
  const orgId = session.user.org_id;

  // สาขาต้องอยู่ใน org นี้ (และเป็นสาขาตู้คีบ)
  const branch = await prisma.branch.findFirst({
    where: { id: data.branchId, orgId, businessType: "claw_machine" },
    select: { id: true, name: true },
  });
  if (!branch) return { ok: false, error: "ไม่พบสาขาตู้คีบ หรือสาขาไม่อยู่ในองค์กรนี้" };

  // ถ้าระบุ machineId → ต้องเป็นตู้ใน org นี้
  let machineId: string | null = null;
  if (data.machineId) {
    const m = await prisma.cfMachine.findFirst({
      where: { id: data.machineId, orgId },
      select: { id: true },
    });
    if (!m) return { ok: false, error: "ไม่พบตู้ในองค์กรนี้" };
    machineId = m.id;
  }

  try {
    const r = await prisma.cfConfigRequest.create({
      data: {
        orgId,
        branchId: branch.id,
        machineId,
        machineCode: data.machineCode,
        branchName: branch.name,
        productName: data.productName || null,
        clawFrom: data.clawFrom ?? null,
        clawTo: data.clawTo ?? null,
        priceBaht: data.priceBaht ?? null,
        reason: data.reason,
        status: "PENDING",
        submittedById: session.user.id,
        submittedByName: session.user.name ?? null,
      },
      select: { id: true },
    });
    revalidatePath(CONFIG_PATH);
    return { ok: true, data: { id: r.id } };
  } catch (e) {
    return { ok: false, error: `ส่งคำขอไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/**
 * อนุมัติคำขอ (PENDING → APPROVED) · admin-tier เท่านั้น · org-scoped.
 *
 * B4 (audit 2026-07-01) — อนุมัติต้อง "ทำจริง" ไม่ใช่แค่พลิกสถานะ:
 * ถ้าคำขอมี priceBaht → เขียน loadout ใหม่ให้ตู้ในทรานแซกชันเดียวกับการพลิกสถานะ
 * (ปิด loadout เดิม effectiveTo=now · เปิด loadout ใหม่ effectiveFrom=now · สินค้ายกมาจากเดิม)
 * เพราะราคานี้คือ "ตัวหาร" ที่ reconcile ใช้ → ต้องเปลี่ยนของจริง ไม่งั้นเป็น approval theater.
 *
 * แปลงราคา: priceBaht → เหรียญ/ครั้ง (pricePerPlayCoins) ด้วยอัตรา 1 เหรียญ = 10 บาท
 * (ตาม comment schema CfMachineLoadout · ปัดขึ้นอย่างน้อย 1 เหรียญ).
 *
 * clawFrom/clawTo (ความแรงคีบ) — ยังไม่มี field เก็บใน loadout/machine → บันทึกลง notes
 * ของ loadout ใหม่ไว้เป็นหลักฐาน (ไม่ silently drop) และแจ้งใน briefing ว่ายังไม่ apply เชิงกลไก.
 */
export async function approveCfConfigRequest(id: string): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const req = await prisma.cfConfigRequest.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      status: true,
      machineId: true,
      priceBaht: true,
      clawFrom: true,
      clawTo: true,
      productName: true,
    },
  });
  if (!req) return { ok: false, error: "ไม่พบคำขอตั้งค่าตู้" };
  if (req.status !== "PENDING") return { ok: false, error: "คำขอนี้ถูกตรวจไปแล้ว" };

  // ถ้าคำขอ "เสนอปรับราคา" (มี priceBaht) แต่ผูกตู้ไม่ได้ → ห้ามอนุมัติแบบ half-apply
  // (จะพลิกสถานะเป็นอนุมัติแต่ราคาตู้ไม่เปลี่ยน = theater เดิม) → fail ชัดเจน
  const wantsPriceChange = req.priceBaht != null && req.priceBaht > 0;
  if (wantsPriceChange && !req.machineId) {
    return {
      ok: false,
      error: "คำขอนี้ขอปรับราคาแต่ไม่ได้ระบุตู้ที่จะปรับ · แก้คำขอให้ผูกตู้ก่อนอนุมัติ",
    };
  }

  const clawNote =
    req.clawFrom != null && req.clawTo != null
      ? ` · ความแรงคีบ ${req.clawFrom}→${req.clawTo} (บันทึกไว้ · ยังไม่เชื่อมฮาร์ดแวร์)`
      : "";

  try {
    await prisma.$transaction(async (tx) => {
      // 1) พลิกสถานะ + ประทับผู้ตรวจ
      await tx.cfConfigRequest.update({
        where: { id: req.id },
        data: {
          status: "APPROVED",
          reviewedById: session.user.id,
          reviewedByName: session.user.name ?? null,
          reviewedAt: new Date(),
        },
      });

      if (!wantsPriceChange || !req.machineId) return; // ไม่ได้ขอปรับราคา = แค่อนุมัติ

      // 2) หา loadout ที่ active อยู่ของตู้ (effectiveTo = null) — ต้องมีสินค้ายกมา
      const active = await tx.cfMachineLoadout.findFirst({
        where: { orgId, machineId: req.machineId, effectiveTo: null },
        orderBy: { effectiveFrom: "desc" },
        select: { id: true, productId: true },
      });
      if (!active) {
        // ไม่มี loadout ตั้งต้น → ไม่รู้ว่าตู้ขายสินค้าอะไร → เปิด loadout ใหม่ไม่ได้อย่างปลอดภัย
        // rollback ทั้งก้อน (รวมการพลิกสถานะ) → คำขอยังคง PENDING
        throw new Error(
          "ตู้นี้ยังไม่ได้ตั้งสินค้า/ราคาเริ่มต้น (loadout) · ตั้งค่าตู้ก่อนจึงจะอนุมัติปรับราคาได้",
        );
      }

      // 3) ราคา baht → เหรียญ/ครั้ง (1 เหรียญ = 10 บาท · อย่างน้อย 1 เหรียญ)
      const coins = Math.max(1, Math.round((req.priceBaht ?? 0) / 10));
      const now = new Date();

      // 4) ปิด loadout เดิม (effectiveTo = now)
      await tx.cfMachineLoadout.update({
        where: { id: active.id },
        data: { effectiveTo: now },
      });

      // 5) เปิด loadout ใหม่ ราคาใหม่ · สินค้ายกมาจากเดิม · effectiveFrom = now
      await tx.cfMachineLoadout.create({
        data: {
          orgId,
          machineId: req.machineId,
          productId: active.productId,
          pricePerPlayCoins: coins,
          effectiveFrom: now,
          effectiveTo: null,
          setById: session.user.id,
          notes: `อนุมัติจากคำขอตั้งค่าตู้ · ราคาใหม่ ${req.priceBaht} บาท/ครั้ง (${coins} เหรียญ)${clawNote}`,
        },
      });
    });
    revalidatePath(CONFIG_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `อนุมัติไม่สำเร็จ: ${(e as Error).message}` };
  }
}

/** ตีกลับคำขอ (PENDING → REJECTED + note) · admin-tier เท่านั้น · org-scoped */
export async function rejectCfConfigRequest(id: string, note?: string): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  const req = await prisma.cfConfigRequest.findFirst({
    where: { id, orgId },
    select: { id: true, status: true },
  });
  if (!req) return { ok: false, error: "ไม่พบคำขอตั้งค่าตู้" };
  if (req.status !== "PENDING") return { ok: false, error: "คำขอนี้ถูกตรวจไปแล้ว" };

  try {
    await prisma.cfConfigRequest.update({
      where: { id: req.id },
      data: {
        status: "REJECTED",
        reviewedById: session.user.id,
        reviewedByName: session.user.name ?? null,
        reviewedAt: new Date(),
        reviewNote: note ? String(note).slice(0, 1000) : null,
      },
    });
    revalidatePath(CONFIG_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ตีกลับไม่สำเร็จ: ${(e as Error).message}` };
  }
}

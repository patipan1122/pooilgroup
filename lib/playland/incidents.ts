"use server";

// Playland · บันทึกอุบัติเหตุ/เหตุการณ์ — กันคดี · เคลมประกัน · บันทึกทุกเหตุการณ์เด็กบาดเจ็บ/ทะเลาะ
// พนักงาน (staff) บันทึกได้เอง (cashier-level) — เกิดเหตุต้องรีบลงทันที ไม่ต้องรอผู้จัดการ

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newIncidentCode } from "./codes";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

export async function createIncident(input: {
  branchId: string;
  occurredAt: string; // datetime-local string จากฟอร์ม
  kind: string;
  severity: string;
  childName?: string;
  memberId?: string;
  location?: string;
  description: string;
  actionTaken?: string;
  parentNotified: boolean;
}): Promise<ActionResult<{ incidentId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์บันทึกเหตุการณ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (!input.description.trim()) return err("ใส่รายละเอียดเหตุการณ์");
  const occurredAt = new Date(input.occurredAt);
  if (isNaN(occurredAt.getTime())) return err("เวลาที่เกิดเหตุไม่ถูกต้อง");

  const incident = await prisma.playlandIncident.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      incidentCode: newIncidentCode(),
      occurredAt,
      kind: input.kind,
      severity: input.severity || "minor",
      childName: input.childName?.trim() || null,
      memberId: input.memberId?.trim() || null,
      location: input.location?.trim() || null,
      description: input.description.trim(),
      actionTaken: input.actionTaken?.trim() || null,
      parentNotified: input.parentNotified,
      photoR2Paths: [], // ยังไม่มีอัปโหลดรูปในเวอร์ชันนี้
      reportedByUserId: session.user.id,
    },
    select: { id: true },
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  if ("error" in incident) return err(incident.error);
  revalidatePath("/playland/incidents");
  return { ok: true, data: { incidentId: incident.id } };
}

// ── ลบเหตุการณ์ (ผู้จัดการขึ้นไป · เก็บ snapshot ลง audit ก่อนลบ) ──
export async function deleteIncident(id: string): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("เฉพาะผู้จัดการขึ้นไปลบได้");
  const rec = await prisma.playlandIncident.findFirst({ where: { id, orgId: session.user.org_id } });
  if (!rec) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  try {
    await prisma.$transaction([
      prisma.playlandAuditLog.create({
        data: {
          orgId: session.user.org_id, branchId: rec.branchId, actorUserId: session.user.id, actorRole: session.user.role,
          action: "incident.delete", entityType: "PlaylandIncident", entityId: rec.id,
          before: JSON.parse(JSON.stringify(rec)), category: "general",
        },
      }),
      prisma.playlandIncident.delete({ where: { id } }),
    ]);
    revalidatePath("/playland/incidents");
    return { ok: true, data: { id } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
  }
}

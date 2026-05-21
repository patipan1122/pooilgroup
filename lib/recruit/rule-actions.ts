"use server";

// Auto-screen rules CRUD + apply-to-application action
// Per Recruit Redesign canvas section 11B (AutoScreenRules)
//
// Rule shape:
//   condition = { field: "ai_score" | "age" | "tag" | "blacklist", op: ">=" | "<=" | "==", value: any }
//   action = { setStatus?: ApplicationStatus, addTag?: string, comment?: string }

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { canRecruitAdmin } from "./role-guard";
import {
  changeApplicationStatus,
  setApplicationTags,
  addApplicationNote,
} from "./actions";
import type { ApplicationStatus } from "./types";

export interface RuleCondition {
  field: "ai_score" | "tag" | "blacklist";
  op: ">=" | "<=" | "==" | "contains";
  value: number | string | boolean;
}

export interface RuleAction {
  setStatus?: ApplicationStatus;
  addTag?: string;
  comment?: string;
}

export interface RuleInput {
  name: string;
  enabled: boolean;
  condition: RuleCondition;
  action: RuleAction;
}

function validateRule(input: RuleInput) {
  if (!input.name.trim()) throw new Error("ตั้งชื่อกฎ");
  if (!input.condition.field) throw new Error("เลือก field");
  if (!input.action.setStatus && !input.action.addTag && !input.action.comment) {
    throw new Error("กฎต้องมี action อย่างน้อย 1 อย่าง");
  }
}

export async function createRule(input: RuleInput) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  validateRule(input);

  const rule = await prisma.recruitScreeningRule.create({
    data: {
      orgId: session.user.org_id,
      name: input.name.trim(),
      enabled: input.enabled,
      condition: input.condition as unknown as object,
      action: input.action as unknown as object,
      createdById: session.user.id,
    },
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "RECRUIT_RULE_CREATED",
    resourceType: "recruit_screening_rule",
    resourceId: rule.id,
    diff: { new: { name: input.name } },
  });

  revalidatePath("/recruit/auto-rules");
  return { ok: true, id: rule.id };
}

export async function updateRule(id: string, input: Partial<RuleInput>) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitScreeningRule.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) throw new Error("ไม่พบกฎ");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitScreeningRule.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.enabled != null ? { enabled: input.enabled } : {}),
      ...(input.condition ? { condition: input.condition as unknown as object } : {}),
      ...(input.action ? { action: input.action as unknown as object } : {}),
    },
  });

  await audit({
    orgId: existing.orgId,
    userId: session.user.id,
    action: "RECRUIT_RULE_UPDATED",
    resourceType: "recruit_screening_rule",
    resourceId: id,
    diff: { new: input as Record<string, unknown> },
  });

  revalidatePath("/recruit/auto-rules");
  return { ok: true };
}

export async function toggleRule(id: string, enabled: boolean) {
  return updateRule(id, { enabled });
}

export async function deleteRule(id: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitScreeningRule.findUnique({
    where: { id },
    select: { orgId: true, name: true },
  });
  if (!existing) throw new Error("ไม่พบกฎ");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitScreeningRule.delete({ where: { id } });

  await audit({
    orgId: existing.orgId,
    userId: session.user.id,
    action: "RECRUIT_RULE_DELETED",
    resourceType: "recruit_screening_rule",
    resourceId: id,
    diff: { old: { name: existing.name } },
  });

  revalidatePath("/recruit/auto-rules");
  return { ok: true };
}

// Apply all enabled rules to a single application (called manually by HR)
export async function applyRulesToApplication(applicationId: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const app = await prisma.recruitApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      orgId: true,
      status: true,
      aiScore: true,
      tags: true,
      flaggedBlacklist: true,
    },
  });
  if (!app) throw new Error("ไม่พบใบสมัคร");
  if (app.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  const rules = await prisma.recruitScreeningRule.findMany({
    where: { orgId: app.orgId, enabled: true },
  });

  const applied: string[] = [];

  for (const r of rules) {
    const cond = r.condition as unknown as RuleCondition;
    const action = r.action as unknown as RuleAction;

    let matches = false;
    if (cond.field === "ai_score" && typeof cond.value === "number") {
      const score = app.aiScore ?? 0;
      matches =
        cond.op === ">="
          ? score >= cond.value
          : cond.op === "<="
            ? score <= cond.value
            : cond.op === "=="
              ? score === cond.value
              : false;
    } else if (cond.field === "tag" && typeof cond.value === "string") {
      matches =
        cond.op === "contains" || cond.op === "=="
          ? app.tags.some((t) => t.toLowerCase().includes(String(cond.value).toLowerCase()))
          : false;
    } else if (cond.field === "blacklist") {
      matches = (cond.op === "=="
        ? app.flaggedBlacklist === cond.value
        : false);
    }

    if (!matches) continue;

    // Apply action
    if (action.setStatus) {
      await changeApplicationStatus(applicationId, action.setStatus);
    }
    if (action.addTag) {
      const nextTags = [...new Set([...app.tags, action.addTag])];
      await setApplicationTags(applicationId, nextTags);
    }
    if (action.comment) {
      await addApplicationNote(applicationId, `[NOTE] auto-rule: ${action.comment}`);
    }

    // Bump counter
    await prisma.recruitScreeningRule.update({
      where: { id: r.id },
      data: { firesCount: { increment: 1 }, lastFiredAt: new Date() },
    });

    applied.push(r.name);
  }

  await audit({
    orgId: app.orgId,
    userId: session.user.id,
    action: "RECRUIT_RULES_APPLIED",
    resourceType: "recruit_application",
    resourceId: applicationId,
    diff: { new: { rulesFired: applied } },
  });

  revalidatePath(`/recruit/applications/${applicationId}`);
  return { ok: true, applied };
}

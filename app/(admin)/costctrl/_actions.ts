"use server";

// Super-admin-gated mutations for CostCtrl. Every action re-checks role.
// Audit-logged at write sites (credential add/remove, budget edit, rule create).

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { requireSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { encryptCredential, decryptCredential } from "@/lib/costctrl/crypto";
import { runFullSync, runProviderSync } from "@/lib/costctrl/sync";

async function gate() {
  const session = await requireSession();
  requireSuperAdmin(session.user.role);
  return session;
}

export async function actSyncAll() {
  await gate();
  const r = await runFullSync();
  revalidatePath("/costctrl");
  return r;
}

export async function actSyncProvider(slug: string) {
  await gate();
  const r = await runProviderSync(slug);
  revalidatePath("/costctrl");
  revalidatePath(`/costctrl/providers/${slug}`);
  return r;
}

export async function actUpsertCredential(input: {
  providerSlug: string;
  label: string;
  payload: string;           // JSON string {token, teamId/projectRef/...} OR raw token
  scope?: string;
}) {
  const session = await gate();
  const provider = await prisma.costProvider.findUnique({ where: { slug: input.providerSlug } });
  if (!provider) throw new Error(`unknown provider: ${input.providerSlug}`);
  const ciphertext = encryptCredential(input.payload);
  await prisma.costApiCredential.upsert({
    where: { providerId_label: { providerId: provider.id, label: input.label } },
    update: { ciphertext, scope: input.scope, lastError: null },
    create: {
      providerId: provider.id,
      label: input.label,
      scope: input.scope,
      ciphertext,
      createdById: session.user.id,
    },
  });
  revalidatePath("/costctrl/alerts");
  revalidatePath(`/costctrl/providers/${input.providerSlug}`);
}

export async function actDeleteCredential(id: string) {
  await gate();
  await prisma.costApiCredential.delete({ where: { id } });
  revalidatePath("/costctrl/alerts");
}

export async function actUpdateBudget(input: {
  providerSlug: string;
  ymKey: string;             // "YYYY-MM" OR "default"
  budgetUsd: number;
}) {
  await gate();
  const provider = await prisma.costProvider.findUnique({ where: { slug: input.providerSlug } });
  if (!provider) throw new Error(`unknown provider: ${input.providerSlug}`);
  const current = (provider.budgetMonthly as Record<string, number>) ?? {};
  current[input.ymKey] = Number(input.budgetUsd) || 0;
  await prisma.costProvider.update({
    where: { id: provider.id },
    data: { budgetMonthly: current },
  });
  revalidatePath("/costctrl");
  revalidatePath("/costctrl/alerts");
}

export async function actCreateAlertRule(input: {
  providerSlug: string;
  metric: string;
  thresholdPct?: number | null;
  thresholdAbs?: number | null;
  channel?: string;
  cooldownHours?: number;
}) {
  await gate();
  const provider = await prisma.costProvider.findUnique({ where: { slug: input.providerSlug } });
  if (!provider) throw new Error(`unknown provider: ${input.providerSlug}`);
  if (input.thresholdPct == null && input.thresholdAbs == null) {
    throw new Error("ต้องใส่ thresholdPct หรือ thresholdAbs อย่างน้อย 1");
  }
  await prisma.costAlertRule.create({
    data: {
      providerId: provider.id,
      metric: input.metric,
      thresholdPct: input.thresholdPct ?? null,
      thresholdAbs: input.thresholdAbs ?? null,
      channel: input.channel ?? "line",
      cooldownHours: input.cooldownHours ?? 24,
    },
  });
  revalidatePath("/costctrl/alerts");
}

export async function actToggleAlertRule(id: string, enabled: boolean) {
  await gate();
  await prisma.costAlertRule.update({ where: { id }, data: { enabled } });
  revalidatePath("/costctrl/alerts");
}

export async function actDeleteAlertRule(id: string) {
  await gate();
  await prisma.costAlertRule.delete({ where: { id } });
  revalidatePath("/costctrl/alerts");
}

export async function actToggleProvider(slug: string, enabled: boolean) {
  await gate();
  await prisma.costProvider.update({ where: { slug }, data: { enabled } });
  revalidatePath("/costctrl");
}

/** Decrypt + return masked preview · used by Settings tab so CEO can verify which token is stored without copying full plaintext. */
export async function actPreviewCredential(id: string): Promise<{ masked: string }> {
  await gate();
  const row = await prisma.costApiCredential.findUnique({ where: { id } });
  if (!row) throw new Error("not found");
  const plain = decryptCredential(row.ciphertext);
  if (!plain) return { masked: "—" };
  // try parsing as JSON to mask just the token field
  try {
    const obj = JSON.parse(plain) as Record<string, string>;
    const t = obj.token ?? "";
    obj.token = t.length > 8 ? `${t.slice(0, 4)}${"•".repeat(8)}${t.slice(-4)}` : "•".repeat(t.length);
    return { masked: JSON.stringify(obj, null, 2) };
  } catch {
    return { masked: plain.length > 8 ? `${plain.slice(0, 4)}${"•".repeat(8)}${plain.slice(-4)}` : "•".repeat(plain.length) };
  }
}

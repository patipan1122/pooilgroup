"use server";

// Alert actions — ack / resolve (single + bulk) + LINE channel toggle stub.
// Spec: AUDIT_chairops_2026-05-25 §3.3 (BR15 bulk) + /tmp/claude-design_chairops_plan.md §4.1
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { ackAlert, resolveAlert } from "@/lib/chairops/reconcile/alerts";
import { writeAudit } from "@/lib/chairops/audit/log";
import { ChairopsAlertKind } from "@/lib/generated/prisma/enums";

export async function ackAlertAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const id = String(formData.get("alertId") ?? "");
  if (!id) redirect("/chairops/alerts?error=missing-id");
  // Wave-0 fix: ack + audit atomic
  await prisma.$transaction(async (tx) => {
    await ackAlert(id, session.user.id, tx);
    await writeAudit(
      {
        userId: session.user.id,
        action: "alert.ack",
        entity: "Alert",
        entityId: id,
      },
      tx,
    );
  });
  revalidatePath("/chairops/alerts");
  redirect("/chairops/alerts?acked=" + id);
}

export async function resolveAlertAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const id = String(formData.get("alertId") ?? "");
  if (!id) redirect("/chairops/alerts?error=missing-id");
  // Wave-0 fix: resolve + audit atomic
  await prisma.$transaction(async (tx) => {
    await resolveAlert(id, session.user.id, tx);
    await writeAudit(
      {
        userId: session.user.id,
        action: "alert.resolve",
        entity: "Alert",
        entityId: id,
      },
      tx,
    );
  });
  revalidatePath("/chairops/alerts");
  redirect("/chairops/alerts?resolved=" + id);
}

// Bulk ack — accepts FormData with repeated `alertIds[]` entries.
// BR15 atomic chain · per-row ack + 1 batch audit log.
export async function bulkAckAlertsAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const rawIds = formData.getAll("alertIds[]").map((v) => String(v)).filter(Boolean);
  if (rawIds.length === 0) redirect("/chairops/alerts?error=no-selection");

  await prisma.$transaction(async (tx) => {
    for (const id of rawIds) {
      await ackAlert(id, session.user.id, tx);
    }
    await writeAudit(
      {
        userId: session.user.id,
        action: "alert.bulk_ack",
        entity: "Alert",
        entityId: rawIds[0] ?? "bulk",
        metadata: { count: rawIds.length, ids: rawIds },
      },
      tx,
    );
  });
  revalidatePath("/chairops/alerts");
  redirect(`/chairops/alerts?acked=bulk:${rawIds.length}`);
}

// Bulk resolve — same pattern, optional `reason` text.
export async function bulkResolveAlertsAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const rawIds = formData.getAll("alertIds[]").map((v) => String(v)).filter(Boolean);
  const reason = String(formData.get("reason") ?? "").trim();
  if (rawIds.length === 0) redirect("/chairops/alerts?error=no-selection");

  await prisma.$transaction(async (tx) => {
    for (const id of rawIds) {
      await resolveAlert(id, session.user.id, tx);
    }
    await writeAudit(
      {
        userId: session.user.id,
        action: "alert.bulk_resolve",
        entity: "Alert",
        entityId: rawIds[0] ?? "bulk",
        metadata: { count: rawIds.length, ids: rawIds, reason: reason || null },
      },
      tx,
    );
  });
  revalidatePath("/chairops/alerts");
  redirect(`/chairops/alerts?resolved=bulk:${rawIds.length}`);
}

// LINE Notify per-event toggle stub.
// TODO[claude-design]: real persistence model `ChairopsLineEventChannel`
// (eventKind PK · channel · enabled · sendCount) planned Wave 2 alongside
// LINE Messaging API migration (D-NEW-3). For Wave 1 this stub only writes
// an audit row so UI is testable end-to-end; toggling does NOT yet change
// downstream `sendLineNotify()` behaviour.
export async function setLineChannelForEventKind(formData: FormData): Promise<void> {
  const session = await requireRole("OFFICE");
  const kind = String(formData.get("kind") ?? "") as ChairopsAlertKind;
  const channel = String(formData.get("channel") ?? "");
  const enabled = String(formData.get("enabled") ?? "false") === "true";

  if (!kind || !(kind in ChairopsAlertKind)) {
    redirect("/chairops/alerts?error=invalid-kind");
  }

  await writeAudit({
    userId: session.user.id,
    action: "alert.line_channel_toggle",
    entity: "AlertChannelConfig",
    entityId: `${kind}:${channel}`,
    metadata: { kind, channel, enabled, note: "stub Wave-1 · no persistence yet" },
  });
  revalidatePath("/chairops/alerts");
}

"use server";

// Alert actions — thin wrappers around lib/reconcile/alerts.ts ack/resolve
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";
import { ackAlert, resolveAlert } from "@/lib/chairops/reconcile/alerts";
import { writeAudit } from "@/lib/chairops/audit/log";

export async function ackAlertAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const id = String(formData.get("alertId") ?? "");
  if (!id) redirect("/chairops/alerts?error=missing-id");
  await ackAlert(id, session.user.id);
  await writeAudit({
    userId: session.user.id,
    action: "alert.ack",
    entity: "Alert",
    entityId: id,
  });
  revalidatePath("/chairops/alerts");
  redirect("/chairops/alerts?acked=" + id);
}

export async function resolveAlertAction(formData: FormData) {
  const session = await requireRole("OFFICE");
  const id = String(formData.get("alertId") ?? "");
  if (!id) redirect("/chairops/alerts?error=missing-id");
  await resolveAlert(id, session.user.id);
  await writeAudit({
    userId: session.user.id,
    action: "alert.resolve",
    entity: "Alert",
    entityId: id,
  });
  revalidatePath("/chairops/alerts");
  redirect("/chairops/alerts?resolved=" + id);
}

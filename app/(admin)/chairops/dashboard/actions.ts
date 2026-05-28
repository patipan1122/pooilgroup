"use server";

// Manual refresh button on CEO dashboard
// Per memory [[role-rank-privilege-escalation-guard]] — gate by role, not just auth
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/chairops/auth/session";
import { evaluateAndEmitAlerts } from "@/lib/chairops/reconcile/alerts";
import { writeAudit } from "@/lib/chairops/audit/log";

export async function refreshDrifts() {
  const session = await requireRole("MANAGER");
  const result = await evaluateAndEmitAlerts();
  await writeAudit({
    userId: session.user.id,
    action: "dashboard.refresh_drifts",
    entity: "Drift",
    entityId: "all",
    metadata: {
      snapshotCount: result.snapshots.length,
      newAlerts: result.emitted.length,
    },
  });
  revalidatePath("/chairops/dashboard");
  return {
    snapshotCount: result.snapshots.length,
    newAlerts: result.emitted.length,
  };
}

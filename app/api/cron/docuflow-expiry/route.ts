// Cron — DocuFlow expiry digest source
// ────────────────────────────────────────────────────────────────────
// Auth: Bearer ${CRON_SECRET} (mirrors morning-brief)
//
// For each org with an active DocuFlow OrgModule, returns renewals
// expiring within 90 days, grouped by severity.
// Telegram delivery is the responsibility of Agent C — this endpoint
// just exposes the data so the morning-brief composer can consume it.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadRenewals, type RenewalWithDocument } from "@/lib/docuflow/data";

export const dynamic = "force-dynamic";

interface OrgExpiryDigest {
  orgId: string;
  orgName: string;
  expired: RenewalWithDocument[];
  critical: RenewalWithDocument[];
  urgent: RenewalWithDocument[];
  watch: RenewalWithDocument[];
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  return GET(req);
}

async function run() {
  // Orgs that have DocuFlow turned on
  const activeModules = await prisma.orgModule.findMany({
    where: { moduleName: "docuflow", isActive: true },
    select: {
      orgId: true,
      org: { select: { id: true, name: true, isActive: true } },
    },
  });

  const digests: OrgExpiryDigest[] = [];

  for (const m of activeModules) {
    if (!m.org || !m.org.isActive) continue;

    const renewals = await loadRenewals(m.orgId, {
      withinDays: 90,
      excludeStatuses: ["renewed"],
    });

    const buckets: OrgExpiryDigest = {
      orgId: m.orgId,
      orgName: m.org.name,
      expired: [],
      critical: [],
      urgent: [],
      watch: [],
    };

    for (const r of renewals) {
      switch (r.expiryStatus) {
        case "expired":
          buckets.expired.push(r);
          break;
        case "critical":
          buckets.critical.push(r);
          break;
        case "urgent":
          buckets.urgent.push(r);
          break;
        case "watch":
          buckets.watch.push(r);
          break;
        // 'normal' falls outside the 90-day window — loadRenewals
        // already excludes it, so nothing to do here.
        default:
          break;
      }
    }

    digests.push(buckets);
  }

  return NextResponse.json({ ok: true, digests });
}

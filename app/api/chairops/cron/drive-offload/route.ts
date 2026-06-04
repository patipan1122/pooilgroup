// GET /api/chairops/cron/drive-offload
// CEO 2026-06-03 · after a file has lived in BOTH R2 and Google Drive for
// `CHAIROPS_DRIVE_OFFLOAD_DAYS` days, delete the R2 copy (cost saving) and flip
// the owning row's live URL to the Drive link.
//
// SAFETY:
//   - DISABLED unless CHAIROPS_DRIVE_OFFLOAD_DAYS is a positive number.
//   - Only touches files in ChairopsDriveAsset (never arbitrary R2 keys).
//   - Verifies the Drive copy still exists (not trashed) BEFORE deleting R2.
//   - Only offloads categories we can re-point in the UI (known sourceTable),
//     so an offloaded file never becomes a broken image.

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { runWithMonitor } from "@/lib/cron/runner";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/r2/upload";
import { getDriveSession, driveFileExists } from "@/lib/chairops/storage/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// sourceTable → re-point the live URL after R2 deletion, but ONLY if the row
// still references THIS asset's R2 url (else the contract was replaced since —
// don't clobber the newer one; we just drop the now-orphaned old R2 object).
const REPOINT: Record<
  string,
  (id: string, oldR2Url: string | null, driveUrl: string) => Promise<void>
> = {
  ChairopsUser: async (id, oldR2Url, driveUrl) => {
    if (!oldR2Url) return;
    await prisma.chairopsUser.updateMany({
      where: { id, contractFileUrl: oldR2Url },
      data: { contractFileUrl: driveUrl },
    });
  },
};

function r2KeyFromUrl(url: string | null, r2Key: string | null): string | null {
  if (r2Key) return r2Key;
  const base = process.env.R2_PUBLIC_URL;
  if (!url || !base) return null;
  if (!url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\/+/, "");
}

export async function GET(request: NextRequest) {
  const guard = requireCronSecret(request);
  if (guard) return guard;

  const days = Number(process.env.CHAIROPS_DRIVE_OFFLOAD_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({
      ok: true,
      skipped: "CHAIROPS_DRIVE_OFFLOAD_DAYS not set — offload disabled",
    });
  }

  return runWithMonitor(
    "chairops-drive-offload",
    async () => {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const candidates = await prisma.chairopsDriveAsset.findMany({
        where: {
          offloadedAt: null,
          createdAt: { lt: cutoff },
          sourceTable: { in: Object.keys(REPOINT) },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });

      // group by org so we reuse one Drive access token per tenant
      const byOrg = new Map<string, typeof candidates>();
      for (const a of candidates) {
        const arr = byOrg.get(a.orgId) ?? [];
        arr.push(a);
        byOrg.set(a.orgId, arr);
      }

      let offloaded = 0;
      let skipped = 0;
      for (const [orgId, assets] of byOrg) {
        const session = await getDriveSession(orgId);
        if (!session) {
          skipped += assets.length;
          continue;
        }
        for (const a of assets) {
          // never delete R2 unless the Drive copy is confirmed alive
          const alive = await driveFileExists(session.accessToken, a.driveFileId);
          if (!alive) {
            skipped++;
            continue;
          }
          const key = r2KeyFromUrl(a.r2Url, a.r2Key);
          if (key) {
            await deleteObject(key).catch(() => {});
          }
          if (a.sourceTable && a.sourceId && REPOINT[a.sourceTable]) {
            await REPOINT[a.sourceTable](a.sourceId, a.r2Url, a.driveUrl).catch(
              () => {},
            );
          }
          await prisma.chairopsDriveAsset.update({
            where: { id: a.id },
            data: { offloadedAt: new Date(), r2Key: null },
          });
          offloaded++;
        }
      }

      return NextResponse.json({ ok: true, offloaded, skipped, days });
    },
    { req: request, allowMultipleRunsPerDay: true },
  );
}

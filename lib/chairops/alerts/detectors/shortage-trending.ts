// Wave 4 · SHORTAGE_TRENDING detector — a branch (or chair) whose collection
// came up SHORT N rounds in a row, computed from the ungameable cumulative
// meter (a maid can game one round's reported time but not a sustained run of
// short collections). CEO 2026-06-29: N=3, alert at both branch and chair
// level. In-app only (channels:[]) — LINE for ChairOps isn't wired yet; the
// alert surfaces on /chairops/alerts. Each bad branch is isolated in try/catch
// so one failure can't sink the detector; the orchestrator also wraps this.
import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";
import { getBranchShortageTrend } from "@/lib/chairops/queries/reconcile-v2";

const CONSECUTIVE = 3;

function fmtBaht(n: number): string {
  return n < 0 ? `−฿${Math.abs(n).toLocaleString()}` : `฿${n.toLocaleString()}`;
}
function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export async function detectShortageTrending(orgId?: string): Promise<NewAlert[]> {
  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true, ...(orgId ? { orgId } : {}) },
    select: { id: true, name: true, orgId: true },
  });

  const out: NewAlert[] = [];
  for (const b of branches) {
    if (out.length >= PER_DETECTOR_EMIT_CAP) break;

    let trend;
    try {
      trend = await getBranchShortageTrend({
        orgId: b.orgId,
        branchId: b.id,
        consecutive: CONSECUTIVE,
      });
    } catch {
      continue; // one bad branch must not sink the whole detector
    }

    // ── Branch-level ──
    if (trend.branchTrending) {
      const dup = await findOpenAlert({
        orgId: b.orgId,
        kind: ChairopsAlertKind.SHORTAGE_TRENDING,
        branchId: b.id,
        entityKey: "streamKey",
        entityValue: "branch",
      });
      if (!dup) {
        const lastVar = last(trend.branchLast)?.variance ?? 0;
        out.push({
          orgId: b.orgId,
          branchId: b.id,
          kind: ChairopsAlertKind.SHORTAGE_TRENDING,
          level: ChairopsAlertLevel.WARN,
          title: `ยอดขาดสะสมโตต่อเนื่อง · สาขา ${b.name}`,
          message: `สาขา ${b.name} เก็บได้น้อยกว่ายอดขาย ${CONSECUTIVE} รอบติดต่อกัน (รอบล่าสุดขาด ${fmtBaht(lastVar)}) — ควรตรวจสอบการเก็บเงิน`,
          contextJson: {
            streamKey: "branch",
            source: "shortage-trending",
            linkPath: `/chairops/reconcile/${b.id}?view=perchair&pcv=summary`,
          },
          channels: [],
        });
      }
    }

    // ── Chair-level ──
    for (const c of trend.chairsTrending) {
      if (out.length >= PER_DETECTOR_EMIT_CAP) break;
      const dup = await findOpenAlert({
        orgId: b.orgId,
        kind: ChairopsAlertKind.SHORTAGE_TRENDING,
        branchId: b.id,
        entityKey: "streamKey",
        entityValue: `chair:${c.chairCode}`,
      });
      if (dup) continue;
      const lastVar = last(c.variances) ?? 0;
      out.push({
        orgId: b.orgId,
        branchId: b.id,
        kind: ChairopsAlertKind.SHORTAGE_TRENDING,
        level: ChairopsAlertLevel.WARN,
        title: `ตู้ ${c.chairCode} เก็บขาดติดต่อกัน · ${b.name}`,
        message: `ตู้ ${c.chairCode} (สาขา ${b.name}) เก็บได้น้อยกว่ายอดขาย ${CONSECUTIVE} รอบติด (รอบล่าสุด ${fmtBaht(lastVar)}) — ควรตรวจสอบตู้นี้`,
        contextJson: {
          streamKey: `chair:${c.chairCode}`,
          chairCode: c.chairCode,
          source: "shortage-trending",
          linkPath: `/chairops/reconcile/${b.id}?view=perchair&pcv=summary&chair=${encodeURIComponent(c.chairCode)}`,
        },
        channels: [],
      });
    }
  }

  return out;
}

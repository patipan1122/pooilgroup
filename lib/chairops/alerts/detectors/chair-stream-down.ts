// D5 · CHAIR_STREAM_DOWN detector — one payment device on a chair stopped
// earning while the chair is otherwise alive (suspect the device broke).
//
// All the detection logic lives in the shared compute (_stream-activity.ts) so
// the daily cron and the on-demand "เช็คตู้เสียด่วน" page can never disagree.
// This file only turns suspects into deduped NewAlert rows.
//
// Mutual-exclusion with D2 CHAIR_OFFLINE is enforced inside computeStreamSuspects
// (a fully-silent chair is CHAIR_OFFLINE's case, never emitted here). Dedup is on
// the composite (chairCode, stream) so the daily cron does not re-emit the same
// dead device every morning.

import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  findOpenAlert,
  isFirstRun,
  PER_DETECTOR_EMIT_CAP,
  type NewAlert,
} from "@/lib/chairops/alerts/_shared";
import {
  computeStreamSuspects,
  STREAM_LABEL,
} from "@/lib/chairops/alerts/_stream-activity";

// "ตู้เสีย" merged into ของเสีย as the ตู้ต้องเช็ก tab (CEO 2026-06-29).
const LINK_PATH = "/chairops/damage?tab=suspects";

export async function detectChairStreamDown(orgId?: string): Promise<NewAlert[]> {
  const suspects = await computeStreamSuspects(orgId);
  if (suspects.length === 0) return [];

  const out: NewAlert[] = [];

  // First-run guard per org — if an org has never seen CHAIR_STREAM_DOWN, emit
  // ONE summary INFO instead of N device rows (avoids a historical storm).
  const byOrg = new Map<string, typeof suspects>();
  for (const s of suspects) {
    const arr = byOrg.get(s.orgId);
    if (arr) arr.push(s);
    else byOrg.set(s.orgId, [s]);
  }

  for (const [oid, orgSuspects] of byOrg.entries()) {
    if (await isFirstRun(oid, ChairopsAlertKind.CHAIR_STREAM_DOWN)) {
      const existing = await findOpenAlert({
        orgId: oid,
        kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
        branchId: null,
      });
      if (!existing) {
        out.push({
          orgId: oid,
          branchId: null,
          kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
          level: ChairopsAlertLevel.INFO,
          title: `ช่องรับเงินน่าจะเสียหลายตู้ · ตรวจย้อนหลัง`,
          message: `${orgSuspects.length} ช่องรับเงินไม่มีเงินเข้าหลายวัน · เปิดหน้า "จัดการตู้เสีย" เพื่อตรวจ`,
          contextJson: {
            historical: true,
            streamsAffected: orgSuspects.length,
            linkPath: LINK_PATH,
            source: "ingest-watchdog-first-run",
          },
          channels: ["repair"],
        });
      }
      continue; // skip per-device emits on the org's first run
    }

    for (const s of orgSuspects) {
      if (out.length >= PER_DETECTOR_EMIT_CAP) break;
      const existing = await findOpenAlert({
        orgId: s.orgId,
        kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
        branchId: s.branchId,
        entityKey: "streamKey",
        entityValue: s.streamKey,
      });
      if (existing) continue;
      const deviceLabel = STREAM_LABEL[s.stream];
      out.push({
        orgId: s.orgId,
        branchId: s.branchId,
        kind: ChairopsAlertKind.CHAIR_STREAM_DOWN,
        level: ChairopsAlertLevel.WARN,
        title: `${deviceLabel}น่าจะเสีย · ${s.chairCode} (${s.branchName})`,
        message: s.lastActiveAt
          ? `${deviceLabel}ไม่มีเงินเข้า ${s.daysZero} วันติด (เครื่องยังทำงาน) · มีเงินล่าสุด ${s.lastActiveAt
              .toISOString()
              .slice(0, 10)} · ไปเช็กเครื่อง`
          : `${deviceLabel}ไม่มีเงินเข้า ${s.daysZero} วันติด · ไปเช็กเครื่อง`,
        contextJson: {
          chairCode: s.chairCode,
          chairId: s.chairId,
          stream: s.stream,
          streamKey: s.streamKey,
          daysZero: s.daysZero,
          threshold: s.threshold,
          sinceDate: s.lastActiveAt
            ? new Date(s.lastActiveAt.getTime() + 86_400_000).toISOString().slice(0, 10)
            : null,
          lastActiveAt: s.lastActiveAt ? s.lastActiveAt.toISOString() : null,
          linkPath: LINK_PATH,
          source: "ingest-watchdog",
        },
        channels: ["repair"],
      });
    }
  }

  return out;
}

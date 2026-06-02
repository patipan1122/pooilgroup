// Shared types + helpers for BF2 alert detectors.
//
// Why this file isn't "use server": detector libs are imported from a cron
// route (server context) AND from event-driven hooks inside other server
// actions. Per [[feedback-use-server-only-async-2026-06-02]] a "use server"
// file may export ONLY async functions — so the typed `NewAlert` shape +
// the in-memory fatigue Map below would not be re-exportable. Plain lib it is.
//
// All four detectors return `NewAlert[]` instead of writing themselves, so the
// cron route can dedupe + log + dispatch LINE pushes once.

import { prisma } from "@/lib/prisma";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";
import { notifyChannel, type ChairopsLineChannel } from "@/lib/chairops/line/messaging";

export interface NewAlert {
  orgId: string;
  branchId: string | null;
  kind: ChairopsAlertKind;
  level: ChairopsAlertLevel;
  title: string;
  message: string;
  contextJson: Record<string, unknown> & {
    /** Deep-link path (e.g. `/chairops/pos-ingest`). Rendered as 'ดูรายละเอียด' in LINE/UI. */
    linkPath?: string;
    /** Entity-id encoded into contextJson because schema has no typed column (yet). */
    chairCode?: string;
    ticketId?: string;
    reportId?: string;
    /** Where the alert came from — for audit + auto-resolve trace. */
    source?: string;
  };
  /** Channel(s) to push to via notifyChannel. */
  channels: ChairopsLineChannel[];
}

// ---------------------------------------------------------------------------
// orgId cache — same pattern as reconcile/alerts.ts:18-25.
// ---------------------------------------------------------------------------

export function makeOrgIdResolver() {
  const cache = new Map<string, string>();
  return async function orgIdFor(branchId: string): Promise<string> {
    const hit = cache.get(branchId);
    if (hit) return hit;
    const row = await prisma.chairopsBranch.findUniqueOrThrow({
      where: { id: branchId },
      select: { orgId: true },
    });
    cache.set(branchId, row.orgId);
    return row.orgId;
  };
}

// ---------------------------------------------------------------------------
// Idempotency — only create when no OPEN/ACK alert of (orgId, kind, entityId)
// already exists. entityId is read out of contextJson because we don't have
// typed columns yet (BF2.1 deferred).
// ---------------------------------------------------------------------------

export async function findOpenAlert(args: {
  orgId: string;
  kind: ChairopsAlertKind;
  branchId?: string | null;
  entityKey?: "chairCode" | "ticketId" | "reportId";
  entityValue?: string;
}): Promise<{ id: string } | null> {
  const where: Parameters<typeof prisma.chairopsAlert.findFirst>[0] = {
    where: {
      orgId: args.orgId,
      kind: args.kind,
      status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] },
    },
    select: { id: true },
  };
  if (args.branchId !== undefined) {
    (where.where as Record<string, unknown>).branchId = args.branchId;
  }
  if (args.entityKey && args.entityValue) {
    (where.where as Record<string, unknown>).contextJson = {
      path: [args.entityKey],
      equals: args.entityValue,
    };
  }
  return prisma.chairopsAlert.findFirst(where);
}

// ---------------------------------------------------------------------------
// Fatigue guard — cap LINE pushes per channel per 15-min window. In-memory
// Map is fine for daily cron (cold-start every run, single invocation).
// If we ever move to sub-hourly, swap to Redis.
// ---------------------------------------------------------------------------

const FATIGUE_WINDOW_MS = 15 * 60 * 1000;
const FATIGUE_CAP_PER_CHANNEL = 5;

interface FatigueBucket {
  windowStart: number;
  count: number;
}

const fatigueState = new Map<string, FatigueBucket>();

export function fatigueCheck(channel: ChairopsLineChannel): boolean {
  const now = Date.now();
  const bucket = fatigueState.get(channel);
  if (!bucket || now - bucket.windowStart > FATIGUE_WINDOW_MS) {
    fatigueState.set(channel, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= FATIGUE_CAP_PER_CHANNEL) return false;
  bucket.count++;
  return true;
}

// ---------------------------------------------------------------------------
// First-run guard — if NO prior alert of this kind has ever existed for the
// org, emit ONE summary INFO row instead of N rows (historical backfill).
// Prevents the "62-day silence → 1860-row storm" failure mode.
// ---------------------------------------------------------------------------

export async function isFirstRun(orgId: string, kind: ChairopsAlertKind): Promise<boolean> {
  const any = await prisma.chairopsAlert.findFirst({
    where: { orgId, kind },
    select: { id: true },
  });
  return any === null;
}

// ---------------------------------------------------------------------------
// LINE message template (consistent across detectors).
// ---------------------------------------------------------------------------

export function formatLineMessage(alert: NewAlert): string {
  const icon = alert.level === ChairopsAlertLevel.CRITICAL ? "🔴"
    : alert.level === ChairopsAlertLevel.WARN ? "⚠️"
    : "ℹ️";
  const base = `${icon} ${alert.title}\n${alert.message}`;
  const link = alert.contextJson.linkPath;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (link && appUrl) {
    return `${base}\n${appUrl}${link}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Per-detector emit cap — defense against pathological data (many branches all
// at once). After cap, downstream code can summarize the overflow.
// ---------------------------------------------------------------------------

export const PER_DETECTOR_EMIT_CAP = 50;

// Re-export so cron route only needs one import.
export { notifyChannel, ChairopsAlertKind, ChairopsAlertLevel, ChairopsAlertStatus };

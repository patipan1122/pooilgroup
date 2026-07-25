// Pinpoint — server-side read helpers (review surface).
//
// Always scope by orgId (multi-tenant). Uses adminClient for the super_admin
// review list, same pattern as GET /api/bugs. The RLS policy is the backstop;
// the explicit .eq("org_id", …) is the primary guard.

import "server-only";
import { adminClient } from "@/lib/db/server";
import type { PinpointPin, PinpointSession } from "./types";

export interface SessionListRow extends PinpointSession {
  author: { id: string; name: string | null } | null;
  /** Live pin counts computed from actual rows (audit A2 — never drifts). */
  totalCount?: number;
  fixedCount?: number;
}

export interface ListOptions {
  /** When set, only sessions authored by this user (the "รอบของฉัน" view). */
  authorId?: string;
}

export async function listSessions(
  orgId: string,
  opts: ListOptions = {},
): Promise<SessionListRow[]> {
  const admin = adminClient();
  let q = admin
    .from("pinpoint_sessions")
    .select(
      "id, org_id, author_id, title, status, reviewed_by_id, reviewed_at, exported_at, consolidated_report_id, pin_count, recording_key, created_at, finished_at, updated_at, author:author_id(id, name)",
    )
    .eq("org_id", orgId);
  if (opts.authorId) q = q.eq("author_id", opts.authorId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[pinpoint.listSessions]", error);
    return [];
  }
  const rows = (data ?? []) as unknown as SessionListRow[];

  // One query for live total + fixed counts across all listed sessions, so the
  // displayed numbers are computed from actual pins (audit A2 — no drift).
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: pins } = await admin
      .from("pinpoint_pins")
      .select("session_id, status")
      .eq("org_id", orgId)
      .in("session_id", ids);
    const total = new Map<string, number>();
    const fixed = new Map<string, number>();
    for (const p of (pins ?? []) as { session_id: string; status: string }[]) {
      total.set(p.session_id, (total.get(p.session_id) ?? 0) + 1);
      if (p.status === "fixed")
        fixed.set(p.session_id, (fixed.get(p.session_id) ?? 0) + 1);
    }
    for (const r of rows) {
      r.totalCount = total.get(r.id) ?? 0;
      r.fixedCount = fixed.get(r.id) ?? 0;
    }
  }
  return rows;
}

export async function getSessionWithPins(
  orgId: string,
  sessionId: string,
): Promise<{ session: SessionListRow; pins: PinpointPin[] } | null> {
  const admin = adminClient();
  const { data: session, error: sErr } = await admin
    .from("pinpoint_sessions")
    .select(
      "id, org_id, author_id, title, status, reviewed_by_id, reviewed_at, exported_at, consolidated_report_id, pin_count, recording_key, created_at, finished_at, updated_at, author:author_id(id, name)",
    )
    .eq("org_id", orgId)
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr || !session) return null;

  const { data: pins, error: pErr } = await admin
    .from("pinpoint_pins")
    .select("*")
    .eq("org_id", orgId)
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (pErr) {
    console.error("[pinpoint.getSessionWithPins] pins", pErr);
  }
  return {
    session: session as unknown as SessionListRow,
    pins: (pins ?? []) as unknown as PinpointPin[],
  };
}

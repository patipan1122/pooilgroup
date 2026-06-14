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
  /** How many pins in this session are marked fixed (for "แก้แล้ว X/Y"). */
  fixedCount?: number;
}

export async function listSessions(orgId: string): Promise<SessionListRow[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("pinpoint_sessions")
    .select(
      "id, org_id, author_id, title, status, reviewed_by_id, reviewed_at, exported_at, consolidated_report_id, pin_count, created_at, finished_at, updated_at, author:author_id(id, name)",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[pinpoint.listSessions]", error);
    return [];
  }
  const rows = (data ?? []) as unknown as SessionListRow[];

  // One extra query for fixed-pin counts across all listed sessions.
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: fixed } = await admin
      .from("pinpoint_pins")
      .select("session_id")
      .eq("org_id", orgId)
      .eq("status", "fixed")
      .in("session_id", ids);
    const counts = new Map<string, number>();
    for (const p of (fixed ?? []) as { session_id: string }[]) {
      counts.set(p.session_id, (counts.get(p.session_id) ?? 0) + 1);
    }
    for (const r of rows) r.fixedCount = counts.get(r.id) ?? 0;
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
      "id, org_id, author_id, title, status, reviewed_by_id, reviewed_at, exported_at, consolidated_report_id, pin_count, created_at, finished_at, updated_at, author:author_id(id, name)",
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

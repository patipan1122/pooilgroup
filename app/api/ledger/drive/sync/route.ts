// POST /api/ledger/drive/sync — { id, companyId }
// Archive ONE expense's receipt original into Google Drive (เดือน/สาขา/หมวด) and
// store the shareable link on the row. Used by:
//   • the review-pane "ส่งเข้า Google Drive" button (manual / re-share)
//   • the LIFF/web capture app (fire-and-forget after a draft is created)
// Idempotent: if the row already has a Drive file, returns it unchanged.
// No-op-safe: if Drive env isn't configured, returns a friendly notConfigured.

import { NextResponse, type NextRequest } from "next/server";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { archiveExpenseToDrive } from "@/lib/ledger/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Pool admin OR active LINE member — same actor model as the LIFF edit, so a
  // field-staff member can re-share too (no more "ไม่มีสิทธิ์" wall).
  const actor = await resolveLedgerActor();
  if (!actor) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });

  let body: { id?: string; companyId?: string };
  try {
    body = (await req.json()) as { id?: string; companyId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!body.id || !body.companyId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const res = await archiveExpenseToDrive({ orgId: actor.orgId, companyId: body.companyId, id: body.id });
  if (!res.ok && !res.notConfigured) {
    return NextResponse.json(res, { status: res.error === "ไม่พบรายการ" ? 404 : 502 });
  }
  return NextResponse.json(res);
}

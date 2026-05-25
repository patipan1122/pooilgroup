// Universal member search — powers the Cmd+K palette
// Returns top 8 matches by name / phone / memberCode

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { searchMembers } from "@/lib/playland/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ ok: true, members: [] });

  const members = await searchMembers(session.user.org_id, q, undefined, 8);
  return NextResponse.json({
    ok: true,
    members: members.map((m) => ({ id: m.id, name: m.name, phone: m.phone, memberCode: m.memberCode })),
  });
}

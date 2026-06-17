// POST /api/clawhub/member
// Customer LIFF: register / record PDPA consent. The id_token is the ONLY trusted
// identity — we verify it server-side (W-014) and resolve→create the ClawhubMember
// for the verified LINE sub. Returns a member summary (no secrets, no member id needed
// for later writes since every write re-verifies the token).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveMemberFromIdToken } from "@/lib/clawhub/verify-member";
import { setConsent } from "@/lib/clawhub/member";
import {
  getMemberSummary,
  getPointHistory,
  getRefundHistory,
  getRedemptionHistory,
} from "@/lib/clawhub/customer-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  idToken: z.string().min(20).max(4096),
  displayName: z.string().max(120).optional(),
  pictureUrl: z.string().max(1024).optional(),
  /** When true, stamp PDPA consent (the register screen sends this on accept). */
  consent: z.boolean().optional(),
  /** When true, also return point/refund/redemption history (the points screen). */
  includeHistory: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const resolved = await resolveMemberFromIdToken(parsed.data.idToken, {
    displayName: parsed.data.displayName,
    pictureUrl: parsed.data.pictureUrl,
  });
  if (!resolved) {
    return NextResponse.json({ error: "LINE token ไม่ถูกต้อง" }, { status: 401 });
  }

  let { member } = resolved;
  // Idempotent: stamp consent if asked and not already consented.
  if (parsed.data.consent && !member.consentAt) {
    member = await setConsent(member.id);
  }

  const summary = await getMemberSummary(member);

  if (parsed.data.includeHistory) {
    const [points, refunds, redemptions] = await Promise.all([
      getPointHistory(member.id),
      getRefundHistory(member.id),
      getRedemptionHistory(member.id),
    ]);
    return NextResponse.json({
      ok: true,
      member: summary,
      history: { points, refunds, redemptions },
    });
  }

  return NextResponse.json({ ok: true, member: summary });
}

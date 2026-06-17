// POST /api/clawhub/redeem
// Customer spends points for a reward (ตุ๊กตา). Verify id_token (W-014), resolve the
// member, then redeemReward — which does spend + redemption-row + stock-decrement in
// ONE transaction, so a member can never lose points without getting a pickup code.
// Returns the pickup code on success, or a clean reason on failure.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveMemberFromIdToken } from "@/lib/clawhub/verify-member";
import { redeemReward } from "@/lib/clawhub/rewards";
import { availableBalance } from "@/lib/clawhub/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  idToken: z.string().min(20).max(4096),
  rewardId: z.string().uuid(),
});

const REASON_TH: Record<string, string> = {
  insufficient_points: "แต้มไม่พอแลกของชิ้นนี้",
  out_of_stock: "ของชิ้นนี้หมดแล้ว",
  reward_unavailable: "ของชิ้นนี้ไม่พร้อมให้แลกแล้ว",
};

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

  const resolved = await resolveMemberFromIdToken(parsed.data.idToken);
  if (!resolved) {
    return NextResponse.json({ error: "LINE token ไม่ถูกต้อง" }, { status: 401 });
  }
  const { orgId, member } = resolved;

  const result = await redeemReward({
    orgId,
    memberId: member.id,
    rewardId: parsed.data.rewardId,
  });

  const balance = await availableBalance(member.id);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason ?? "error",
        message: REASON_TH[result.reason ?? ""] ?? "แลกไม่สำเร็จ ลองใหม่อีกครั้ง",
        balance,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    redemptionId: result.redemptionId,
    pickupCode: result.pickupCode,
    balance,
  });
}

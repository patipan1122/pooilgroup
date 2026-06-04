// LedgerLine — daily digest cron.
// DMs each company's CEO/accountant a short summary (today's captures, pending
// drafts, month spend, budget alerts). NEVER posts into a branch group — only
// 1:1 push to accountant/admin members who linked their LINE id.
// Auth via CRON_SECRET (reuses the shared cron guard). Scheduled in vercel.json.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronSecret } from "@/lib/chairops/auth/cron-secret";
import { decryptToken } from "@/lib/recruit/channel-crypto";
import { buildLedgerDigest } from "@/lib/ledger/digest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function pushText(accessToken: string, to: string, text: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const guard = requireCronSecret(req);
  if (guard) return guard;

  const channels = await prisma.ledgerLineChannel.findMany({
    where: { active: true },
    select: { orgId: true, companyId: true, accessTokenEnc: true },
  });

  const results: Record<string, unknown>[] = [];
  for (const ch of channels) {
    try {
      const token = decryptToken(ch.accessTokenEnc);
      if (!token) {
        results.push({ companyId: ch.companyId, skipped: "no-token" });
        continue;
      }
      const digest = await buildLedgerDigest(ch.orgId, ch.companyId);
      if (!digest.hasContent) {
        results.push({ companyId: ch.companyId, skipped: "no-content" });
        continue;
      }
      // Recipients = accountant/admin members of this org+company who linked LINE.
      const recipients = await prisma.ledgerLineMember.findMany({
        where: {
          orgId: ch.orgId,
          companyId: ch.companyId,
          active: true,
          role: { in: ["accountant", "admin"] },
        },
        select: { lineUserId: true },
      });
      let pushed = 0;
      for (const r of recipients) {
        if (await pushText(token, r.lineUserId, digest.text)) pushed++;
      }
      results.push({ companyId: ch.companyId, recipients: recipients.length, pushed });
    } catch (e) {
      console.error("[ledger:daily-digest]", ch.companyId, e);
      results.push({ companyId: ch.companyId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, channels: channels.length, results });
}

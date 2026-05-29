// FAQ matching — deterministic, free. Checked before any AI call.
// Admin-authored keyword→answer pairs (highest priority first).

import { prisma } from "@/lib/prisma";

export async function matchFaq(
  orgId: string,
  businessTag: string,
  textRaw: string,
): Promise<{ id: string; answer: string } | null> {
  const faqs = await prisma.inboxBotFaq.findMany({
    where: { orgId, businessTag, enabled: true },
    orderBy: { priority: "desc" },
    select: { id: true, keywords: true, answer: true },
  });
  const text = (textRaw ?? "").toLowerCase();
  for (const f of faqs) {
    const kws = f.keywords
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (kws.some((k) => text.includes(k))) {
      return { id: f.id, answer: f.answer };
    }
  }
  return null;
}

export async function bumpFaqHit(id: string): Promise<void> {
  await prisma.inboxBotFaq
    .update({ where: { id }, data: { hits: { increment: 1 } } })
    .catch(() => {});
}

// Recruit — blacklist matching
// CEO Q1: ใช้รวม · ไม่ strict isolation · scope BOTH ใช้ default
// CEO Q5: ไม่เก็บ national ID → match ด้วย phone + name fuzzy

import { prisma } from "@/lib/prisma";

export interface BlacklistMatch {
  matched: boolean;
  matches: Array<{
    id: string;
    reason: string;
    addedAt: Date;
    expiresAt: Date;
    matchedBy: "phone" | "name";
  }>;
}

/** Check applicant against active blacklist entries. */
export async function checkBlacklist(
  orgId: string,
  applicant: { fullName: string; phone: string },
): Promise<BlacklistMatch> {
  const now = new Date();
  const entries = await prisma.recruitBlacklist.findMany({
    where: {
      orgId,
      removedAt: null,
      expiresAt: { gt: now },
      OR: [
        { phone: applicant.phone },
        { fullName: { equals: applicant.fullName.trim(), mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      phone: true,
      fullName: true,
      reason: true,
      addedAt: true,
      expiresAt: true,
    },
    take: 10,
  });

  const matches = entries.map((e) => ({
    id: e.id,
    reason: e.reason,
    addedAt: e.addedAt,
    expiresAt: e.expiresAt,
    matchedBy: (e.phone === applicant.phone ? "phone" : "name") as
      | "phone"
      | "name",
  }));

  return {
    matched: matches.length > 0,
    matches,
  };
}

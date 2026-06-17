// ClawHub (JOLLY PLAY) — reward catalog + redemption.
// Rewards are a small admin-managed catalog (ตุ๊กตา); members spend points to redeem.
// redeemReward runs spend + redemption-row + stock-decrement in ONE transaction so a
// member can never spend points without getting a redemption (or vice-versa). The
// denorm fields (sku/name/imageUrl/productId) are snapshotted onto the redemption so
// the receipt stays correct even if the reward later changes or is deleted.

import type { ClawhubReward } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { spendPoints } from "./points";

/** Active rewards for the catalog, ordered by sortOrder then newest-first-created. */
export async function listActiveRewards(orgId: string): Promise<ClawhubReward[]> {
  return prisma.clawhubReward.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Fetch one reward by id (null if not found). */
export async function getReward(id: string): Promise<ClawhubReward | null> {
  return prisma.clawhubReward.findUnique({ where: { id } });
}

// Unambiguous alphabet — no 0/O/1/I/L to avoid mis-reads when staff key in the code.
const PICKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Short human pickup code, e.g. "JP-7K3Q". Uppercase, ambiguity-free. */
export function generatePickupCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += PICKUP_ALPHABET[Math.floor(Math.random() * PICKUP_ALPHABET.length)];
  }
  return `JP-${code}`;
}

export type RedeemRewardArgs = {
  orgId: string;
  memberId: string;
  rewardId: string;
};

export type RedeemRewardResult = {
  ok: boolean;
  reason?: string;
  redemptionId?: string;
  pickupCode?: string;
};

/**
 * Member redeems a reward with points. All-or-nothing in one transaction:
 *  - reward must exist + be active            → else reason "reward_unavailable"
 *  - if stock tracked and depleted            → reason "out_of_stock"
 *  - spendPoints (FIFO lots) — insufficient   → reason "insufficient_points"
 *  - create PENDING redemption (snapshot reward) + decrement stock when tracked.
 * Insufficient points are caught cleanly (no leaked 500).
 */
export async function redeemReward(
  args: RedeemRewardArgs,
): Promise<RedeemRewardResult> {
  const { orgId, memberId, rewardId } = args;
  const pickupCode = generatePickupCode();

  try {
    return await prisma.$transaction(async (tx) => {
      const reward = await tx.clawhubReward.findUnique({ where: { id: rewardId } });
      if (!reward || !reward.isActive || reward.orgId !== orgId) {
        return { ok: false, reason: "reward_unavailable" };
      }
      if (reward.stock != null && reward.stock <= 0) {
        return { ok: false, reason: "out_of_stock" };
      }

      // Spend first — throws if the member has too few unexpired points.
      const redemptionId = crypto.randomUUID();
      await spendPoints(tx, {
        orgId,
        memberId,
        points: reward.pointsPrice,
        refType: "redemption",
        refId: redemptionId,
      });

      const redemption = await tx.clawhubRedemption.create({
        data: {
          id: redemptionId,
          orgId,
          memberId,
          rewardId: reward.id,
          productId: reward.productId,
          productSku: reward.sku,
          productName: reward.name,
          productImageUrl: reward.imageUrl,
          pointsSpent: reward.pointsPrice,
          status: "PENDING",
          pickupCode,
        },
      });

      if (reward.stock != null) {
        await tx.clawhubReward.update({
          where: { id: reward.id },
          data: { stock: { decrement: 1 } },
        });
      }

      return {
        ok: true,
        redemptionId: redemption.id,
        pickupCode: redemption.pickupCode,
      };
    });
  } catch (err: unknown) {
    // spendPoints throws on insufficient points — surface as a clean reason, not a 500.
    if (err instanceof Error && err.message.includes("insufficient points")) {
      return { ok: false, reason: "insufficient_points" };
    }
    throw err;
  }
}

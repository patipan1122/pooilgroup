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

/** How the member wants to receive the redeemed reward. */
export type RedeemFulfillment = {
  method: "DELIVERY" | "PICKUP" | "CONTACT";
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  pickupBranchCode?: string;
  pickupTime?: string;
  contactNote?: string;
};

export type RedeemRewardArgs = {
  orgId: string;
  memberId: string;
  rewardId: string;
  fulfillment: RedeemFulfillment;
};

export type RedeemRewardResult = {
  ok: boolean;
  reason?: string;
  redemptionId?: string;
  pickupCode?: string;
};

/**
 * Member redeems a reward with points. All-or-nothing in one transaction:
 *  - fulfillment must be complete             → else reason "missing_delivery_info"/"missing_pickup_branch"
 *  - reward must exist + be active            → else reason "reward_unavailable"
 *  - if stock tracked and depleted            → reason "out_of_stock"
 *  - spendPoints (FIFO lots) — insufficient   → reason "insufficient_points"
 *  - create PENDING redemption (snapshot reward + fulfillment choice) + decrement stock when tracked.
 * Bad fulfillment / insufficient points are caught cleanly (no leaked 500).
 */
export async function redeemReward(
  args: RedeemRewardArgs,
): Promise<RedeemRewardResult> {
  const { orgId, memberId, rewardId, fulfillment } = args;

  // Validate the fulfillment choice up front — never throw 500, return a clean reason.
  const trim = (v: string | undefined): string => (v ?? "").trim();
  const recipientName = trim(fulfillment.recipientName);
  const recipientPhone = trim(fulfillment.recipientPhone);
  const recipientAddress = trim(fulfillment.recipientAddress);
  const pickupBranchCode = trim(fulfillment.pickupBranchCode);
  const pickupTime = trim(fulfillment.pickupTime);
  const contactNote = trim(fulfillment.contactNote);

  if (fulfillment.method === "DELIVERY") {
    if (!recipientName || !recipientAddress || !recipientPhone) {
      return { ok: false, reason: "missing_delivery_info" };
    }
  } else if (fulfillment.method === "PICKUP") {
    if (!pickupBranchCode) {
      return { ok: false, reason: "missing_pickup_branch" };
    }
  }
  // CONTACT → always ok (note optional).

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
          fulfillMethod: fulfillment.method,
          recipientName: recipientName || null,
          recipientPhone: recipientPhone || null,
          recipientAddress: recipientAddress || null,
          pickupBranchCode: pickupBranchCode || null,
          pickupTime: pickupTime || null,
          contactNote: contactNote || null,
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

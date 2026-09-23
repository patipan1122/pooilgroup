import { config } from "dotenv";
config({ path: ".env.local" });
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const branch = await prisma.chairopsBranch.findFirst({
  where: { name: { contains: "lotus", mode: "insensitive" } },
  select: { id: true, name: true, orgId: true },
});
console.log("branch:", branch);

if (branch) {
  const deposits = await prisma.chairopsCashDeposit.findMany({
    where: {
      branchId: branch.id,
      createdAt: { gte: new Date("2026-08-04T00:00:00Z"), lte: new Date("2026-08-09T23:59:59Z") },
    },
    select: {
      id: true,
      depositedAmount: true,
      ocrAmount: true,
      ocrDate: true,
      ocrRefNo: true,
      ocrAccountName: true,
      ocrReadAt: true,
      requiresReview: true,
      ocrFlagReason: true,
      createdAt: true,
      maid: { select: { displayName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(JSON.stringify(deposits, null, 2));
}
await prisma.$disconnect();

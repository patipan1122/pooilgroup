import { prisma } from "@/lib/prisma";

async function main() {
  const rows = await prisma.chairopsPosCoinEvent.findMany({
    where: { chairDeviceId: "G0321380" },
    orderBy: { eventAt: "asc" },
    select: { eventAt: true, coinAdded: true, coinMeter: true, storeName: true },
  });
  const blipIdx = rows.findIndex((r, i) => i > 0 && Number(r.coinMeter) < Number(rows[i - 1]!.coinMeter));
  console.log(`chair G0321380 · ${rows.length} events · first non-monotonic at index ${blipIdx}`);
  if (blipIdx < 0) { process.exit(0); }
  console.log("Context (±2):");
  for (let i = Math.max(0, blipIdx - 2); i < Math.min(rows.length, blipIdx + 3); i++) {
    const r = rows[i]!;
    const tag = i === blipIdx ? "  ◄── BLIP" : "";
    console.log(`  ${r.eventAt.toISOString()}  +${r.coinAdded}  meter=${r.coinMeter}  ${r.storeName}${tag}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).then(() => process.exit(0));

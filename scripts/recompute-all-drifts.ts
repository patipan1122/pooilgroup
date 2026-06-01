// One-shot: trigger drift recompute for every active org. Used after a
// batch commit when fire-and-forget recomputeAllDrifts errored silently
// (audit P0 today: 8 active branches with stale cache · cached drift=0
// while live POS sum was 5,860 to 23,680).
//
// Run: pnpm exec tsx -r dotenv/config scripts/recompute-all-drifts.ts \
//   dotenv_config_path=.env.local

import { prisma } from "@/lib/prisma";
import { recomputeAllDrifts } from "@/lib/chairops/reconcile/drift-engine";

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`recomputing drift for ${orgs.length} orgs`);
  for (const o of orgs) {
    try {
      await recomputeAllDrifts(o.id);
      console.log(`  ✅ ${o.name} (${o.id.slice(0, 8)}…)`);
    } catch (e) {
      console.error(`  ❌ ${o.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

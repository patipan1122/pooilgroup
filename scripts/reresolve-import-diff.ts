// One-shot: rewalk every pending ChairopsPosImport's diffSummary and patch
// rows whose shopName now matches an existing ChairopsBranch (post-hoc fix
// for CEO 2026-06-01 — branches were created via UI but the in-place
// diffSummary patch didn't land for some imports).
//
// Read-then-write. Skips committed imports. Idempotent.
//
// Run: pnpm exec tsx -r dotenv/config scripts/reresolve-import-diff.ts \
//   dotenv_config_path=.env.local

import { prisma } from "@/lib/prisma";

interface PartialDiffRow {
  status: string;
  shopName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  errors?: string[];
}
interface PartialDiff {
  rows?: PartialDiffRow[];
  counts?: {
    new?: number;
    same?: number;
    changed?: number;
    error?: number;
  };
  starThing?: {
    unknownBranches?: string[];
    knownBranchEntries?: Array<[string, string]>;
  } | null;
}

async function main() {
  const pending = await prisma.chairopsPosImport.findMany({
    where: { committed: false },
    select: { id: true, orgId: true, filename: true, diffSummary: true },
  });
  console.log(`scanning ${pending.length} pending imports`);

  let importsTouched = 0;
  let totalRowsPatched = 0;

  for (const imp of pending) {
    const diff = imp.diffSummary as unknown as PartialDiff | null;
    if (!diff || !Array.isArray(diff.rows)) continue;

    const errorShopNames = new Set<string>();
    for (const r of diff.rows) {
      if (r.status === "error" && r.shopName) {
        errorShopNames.add(r.shopName.trim());
      }
    }
    if (errorShopNames.size === 0) continue;

    const matches = await prisma.chairopsBranch.findMany({
      where: { orgId: imp.orgId, name: { in: [...errorShopNames] } },
      select: { id: true, name: true },
    });
    if (matches.length === 0) continue;
    const branchByName = new Map(matches.map((m) => [m.name, m]));

    let rowsPatched = 0;
    for (const r of diff.rows) {
      if (r.status !== "error") continue;
      const n = (r.shopName ?? "").trim();
      const b = branchByName.get(n);
      if (!b) continue;
      r.status = "new";
      r.branchId = b.id;
      r.branchName = b.name;
      if (Array.isArray(r.errors)) {
        r.errors = r.errors.filter((e) => !/สาขา|ระบุสาขา/.test(e));
      }
      rowsPatched += 1;
    }
    if (rowsPatched === 0) continue;

    if (diff.counts) {
      diff.counts.error = Math.max(0, (diff.counts.error ?? 0) - rowsPatched);
      diff.counts.new = (diff.counts.new ?? 0) + rowsPatched;
    }
    if (diff.starThing) {
      const resolvedNames = new Set(branchByName.keys());
      if (Array.isArray(diff.starThing.unknownBranches)) {
        diff.starThing.unknownBranches = diff.starThing.unknownBranches.filter(
          (n) => !resolvedNames.has(n),
        );
      }
      const newEntries: Array<[string, string]> = [];
      for (const [name, b] of branchByName.entries()) {
        newEntries.push([name, b.id]);
      }
      if (Array.isArray(diff.starThing.knownBranchEntries)) {
        diff.starThing.knownBranchEntries.push(...newEntries);
      } else {
        diff.starThing.knownBranchEntries = newEntries;
      }
    }

    await prisma.chairopsPosImport.update({
      where: { id: imp.id },
      data: { diffSummary: diff as unknown as object },
    });
    importsTouched += 1;
    totalRowsPatched += rowsPatched;
    console.log(
      `  ✅ ${imp.filename} (id=${imp.id.slice(0, 8)}…) · patched ${rowsPatched} rows · counts now new=${diff.counts?.new} error=${diff.counts?.error}`,
    );
  }

  console.log(
    `\n${importsTouched} imports touched · ${totalRowsPatched} rows patched in total`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

// Read-only probe of a single ChairopsPosImport's diffSummary state — used to
// diagnose why the preview counts aren't matching expectation after CEO
// clicks "เพิ่มสาขานี้" on the UnknownBranchesCard. No writes. No secrets.
//
// Run: pnpm exec tsx -r dotenv/config scripts/probe-import-diff.ts <importId>
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
  const args = process.argv.slice(2).filter((a) => !a.includes("dotenv_") && !a.endsWith(".ts"));
  const importId = args[0];
  if (!importId) {
    console.error("usage: probe-import-diff.ts <importId>");
    process.exit(2);
  }

  const imp = await prisma.chairopsPosImport.findUnique({
    where: { id: importId },
    select: {
      id: true,
      filename: true,
      committed: true,
      committedAt: true,
      diffSummary: true,
    },
  });
  if (!imp) {
    console.error("import not found:", importId);
    process.exit(3);
  }

  console.log(`import ${imp.id}`);
  console.log(`  filename:  ${imp.filename}`);
  console.log(`  committed: ${imp.committed} ${imp.committedAt ?? ""}`);

  const diff = imp.diffSummary as unknown as PartialDiff | null;
  if (!diff) {
    console.error("(no diffSummary)");
    process.exit(0);
  }

  console.log("\ncounts:", JSON.stringify(diff.counts));
  console.log(
    "starThing.unknownBranches:",
    JSON.stringify(diff.starThing?.unknownBranches),
  );
  console.log(
    "starThing.knownBranchEntries (sample 10):",
    JSON.stringify(diff.starThing?.knownBranchEntries?.slice(0, 10)),
  );

  if (Array.isArray(diff.rows)) {
    const byStatus = new Map<string, number>();
    for (const r of diff.rows) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    }
    console.log("\nrows by status:");
    for (const [s, n] of [...byStatus.entries()].sort()) {
      console.log(`  ${s.padEnd(10)} ${n}`);
    }

    // Group rows still in error bucket by shopName
    const errBy = new Map<string, number>();
    for (const r of diff.rows) {
      if (r.status !== "error") continue;
      const k = (r.shopName ?? "").trim() || "(no shopName)";
      errBy.set(k, (errBy.get(k) ?? 0) + 1);
    }
    console.log("\nerror rows grouped by shopName (top 12):");
    const sorted = [...errBy.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sorted.slice(0, 12)) {
      console.log(`  ${String(n).padStart(4)} · "${k}"`);
    }
  }

  // Find branches with matching names that exist in DB
  const orgId = (await prisma.chairopsPosImport.findUnique({
    where: { id: importId },
    select: { orgId: true },
  }))?.orgId;
  if (orgId) {
    const errNames = new Set<string>();
    for (const r of diff.rows ?? []) {
      if (r.status === "error" && r.shopName) errNames.add(r.shopName.trim());
    }
    if (errNames.size > 0) {
      const matches = await prisma.chairopsBranch.findMany({
        where: { orgId, name: { in: [...errNames] } },
        select: { id: true, name: true, slug: true },
      });
      console.log("\nbranches that EXIST in DB matching unresolved storeNames:");
      for (const m of matches) {
        console.log(`  ✅ "${m.name}"  (slug=${m.slug}, id=${m.id})`);
      }
      const missing = [...errNames].filter(
        (n) => !matches.find((m) => m.name === n),
      );
      console.log("\nstoreNames in error rows with NO matching ChairopsBranch:");
      for (const n of missing.slice(0, 12)) {
        console.log(`  ❌ "${n}"`);
      }
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

"use server";

// Branch admin actions — chair list management primarily.
// CEO 2026-05-30 hit "ยังไม่มีเก้าอี้ในสาขา" on the branch-collect picker for
// 29/30 branches and there was no UI to add chairs. This adds a single
// idempotent bulk-add action so office/admin can paste chair codes (one per
// line) on the branch detail page.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const addChairsInput = z.object({
  branchId: z.string().uuid(),
  // chairCodes can be comma- or newline-separated; we normalize. Empty rejected.
  codesRaw: z.string().min(1).max(8000),
});

export type AddChairsInput = z.infer<typeof addChairsInput>;

export async function addChairsToBranch(
  raw: AddChairsInput,
): Promise<ActionResult<{ inserted: number; skippedExisting: number; codes: string[] }>> {
  const session = await requireRole("OFFICE");

  const parsed = addChairsInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  }
  const { branchId, codesRaw } = parsed.data;

  // Normalize: split on commas or newlines, trim, uppercase, dedupe, length-guard.
  const codes = Array.from(
    new Set(
      codesRaw
        .split(/[,\n\r]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0 && s.length <= 40),
    ),
  );
  if (codes.length === 0) {
    return { ok: false, error: "ไม่มีรหัสเก้าอี้ที่ใช้ได้" };
  }
  if (codes.length > 200) {
    return { ok: false, error: `รหัสเยอะเกินไป (${codes.length}) · จำกัด 200/ครั้ง` };
  }

  // Verify branch belongs to this org (defense-in-depth on requireRole gate).
  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId },
    select: { id: true, name: true },
  });
  if (!branch) {
    return { ok: false, error: "ไม่พบสาขา" };
  }

  // Find which codes already exist (idempotent — re-adding is a no-op).
  const existing = await prisma.chairopsChair.findMany({
    where: {
      orgId: session.user.orgId,
      chairCode: { in: codes },
    },
    select: { chairCode: true, branchId: true },
  });
  const existingSet = new Set(existing.map((e) => e.chairCode));
  const toInsert = codes.filter((c) => !existingSet.has(c));

  // Reject if any of the existing codes belong to a DIFFERENT branch — chair
  // codes are unique per org and re-pointing one to a new branch should be a
  // deliberate move, not an accidental side effect of "bulk add".
  const wrongBranch = existing.filter((e) => e.branchId !== branchId);
  if (wrongBranch.length > 0) {
    return {
      ok: false,
      error: `รหัส ${wrongBranch.map((e) => e.chairCode).join(",")} อยู่สาขาอื่นแล้ว · ย้ายผ่านหน้า edit เก้าอี้`,
    };
  }

  if (toInsert.length === 0) {
    return {
      ok: true,
      data: { inserted: 0, skippedExisting: codes.length, codes },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsChair.createMany({
      data: toInsert.map((code) => ({
        orgId: session.user.orgId,
        branchId,
        chairCode: code,
        isActive: true,
      })),
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "chairs.bulk_add",
        entity: "Chair",
        entityId: branchId,
        newValue: { branchId, codes: toInsert, count: toInsert.length },
        metadata: { route: "/chairops/branches/[id]/chairs/add" },
      },
      tx,
    );
  });

  revalidatePath(`/chairops/branches/${branchId}`);
  revalidatePath("/chairops/branches");
  revalidatePath("/chairops/branch-collect");

  return {
    ok: true,
    data: {
      inserted: toInsert.length,
      skippedExisting: existingSet.size,
      codes,
    },
  };
}

// Auto-sync chairs from POS history. CEO 2026-05-30: chair-per-branch data
// already lives in ChairopsPosDaily (one row per branch × chair × day from
// the StarThing XLSX import — see memory chairops-starthing-xlsx-schema-2026-
// 05-27). Backfilling ChairopsChair from those distinct (branchId, chairCode)
// pairs lets the collect picker render checkboxes without the admin manually
// typing every code. Safe to re-run: only INSERTs codes that don't exist on
// the target branch.
export async function syncChairsFromPos(): Promise<
  ActionResult<{
    branchesScanned: number;
    chairsInserted: number;
    chairsAlreadyExisting: number;
  }>
> {
  const session = await requireRole("OFFICE");

  // Pull all distinct (branchId, chairCode) pairs from POS daily history.
  // groupBy is the cheapest way; we filter chairCode null/empty server-side.
  const rows = await prisma.chairopsPosDaily.groupBy({
    by: ["branchId", "chairCode"],
    where: {
      orgId: session.user.orgId,
      chairCode: { not: null },
    },
    _count: { _all: true },
  });

  // Per-branch set of codes from POS.
  const posByBranch = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = r.chairCode?.trim();
    if (!code) continue;
    if (!posByBranch.has(r.branchId)) posByBranch.set(r.branchId, new Set());
    posByBranch.get(r.branchId)!.add(code);
  }
  if (posByBranch.size === 0) {
    return {
      ok: false,
      error: "ไม่พบข้อมูล POS · upload XLSX จาก StarThing ก่อนที่ /chairops/pos-ingest",
    };
  }

  // Existing chairs (one query, in-memory join on branch).
  const existing = await prisma.chairopsChair.findMany({
    where: {
      orgId: session.user.orgId,
      branchId: { in: Array.from(posByBranch.keys()) },
    },
    select: { branchId: true, chairCode: true },
  });
  const existingByBranch = new Map<string, Set<string>>();
  for (const e of existing) {
    if (!existingByBranch.has(e.branchId)) existingByBranch.set(e.branchId, new Set());
    existingByBranch.get(e.branchId)!.add(e.chairCode);
  }

  // Build createMany payload — every code in POS that isn't already in Chair.
  type NewRow = { orgId: string; branchId: string; chairCode: string; isActive: boolean };
  const toCreate: NewRow[] = [];
  let alreadyCount = 0;
  for (const [branchId, codes] of posByBranch) {
    const have = existingByBranch.get(branchId) ?? new Set();
    for (const code of codes) {
      if (have.has(code)) {
        alreadyCount += 1;
        continue;
      }
      toCreate.push({
        orgId: session.user.orgId,
        branchId,
        chairCode: code,
        isActive: true,
      });
    }
  }

  if (toCreate.length === 0) {
    return {
      ok: true,
      data: {
        branchesScanned: posByBranch.size,
        chairsInserted: 0,
        chairsAlreadyExisting: alreadyCount,
      },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.chairopsChair.createMany({
      data: toCreate,
      skipDuplicates: true, // belt-and-suspenders against the @@unique([orgId, chairCode])
    });
    await writeAudit(
      {
        userId: session.user.id,
        action: "chairs.sync_from_pos",
        entity: "Chair",
        entityId: session.user.orgId,
        newValue: {
          branchesScanned: posByBranch.size,
          inserted: toCreate.length,
          alreadyExisting: alreadyCount,
        },
        metadata: { route: "/chairops/branch-collect" },
      },
      tx,
    );
  });

  revalidatePath("/chairops/branches");
  revalidatePath("/chairops/branch-collect");

  return {
    ok: true,
    data: {
      branchesScanned: posByBranch.size,
      chairsInserted: toCreate.length,
      chairsAlreadyExisting: alreadyCount,
    },
  };
}

// Import StarThing "Store Equipment List" XLSX — the authoritative chair→
// branch mapping. CEO pastes a CoS signed URL on /chairops/branches/import-
// equipment; server fetches + parses + syncs.
//
// XLSX shape (StarThing portal export, 4 cols):
//   Device Code | Equipment type | Store Name | Online status
//
// For each store name:
//   1. Match existing ChairopsBranch by normalized name (lowercase · strip
//      parens/spaces).
//   2. No match → create a new ChairopsBranch with a slug from name +
//      tabName = name (must satisfy the unique on tabName).
//   3. For each chair code on that store: insert into ChairopsChair if not
//      present (idempotent).
//
// Skips rows with empty store name or store names matching /home|บ้าน/i
// (chairs in storage, not yet deployed).
const importEquipmentInput = z.object({
  xlsxUrl: z.string().url(),
});

export async function importStarThingEquipment(
  raw: z.infer<typeof importEquipmentInput>,
): Promise<
  ActionResult<{
    storesInFile: number;
    storesAtHome: number;
    chairsInFile: number;
    branchesMatched: number;
    branchesCreated: number;
    chairsInserted: number;
    chairsMoved: number;
    chairsAlreadyExisting: number;
    perStore: Array<{
      store: string;
      branchName: string;
      created: boolean;
      chairsInserted: number;
      chairsMoved: number;
      chairsAlreadyExisting: number;
    }>;
  }>
> {
  const session = await requireRole("OFFICE");
  const parsed = importEquipmentInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "URL ไม่ถูกต้อง" };
  }
  const { xlsxUrl } = parsed.data;

  // Fetch the XLSX (signed URLs · short TTL).
  let buf: ArrayBuffer;
  try {
    const r = await fetch(xlsxUrl);
    if (!r.ok) {
      return { ok: false, error: `fetch XLSX ${r.status}` };
    }
    buf = await r.arrayBuffer();
  } catch (e) {
    return {
      ok: false,
      error: `fetch XLSX: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  // Parse via the dependency we already use elsewhere (xlsx pkg).
  const { read, utils } = await import("xlsx");
  const wb = read(Buffer.from(buf), { type: "buffer" });
  const sh = wb.Sheets[wb.SheetNames[0]];
  if (!sh) return { ok: false, error: "ไม่พบ sheet ในไฟล์" };
  const rows = utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" });
  if (!Array.isArray(rows) || rows.length < 2) {
    return { ok: false, error: "ไฟล์ว่าง / ไม่มีข้อมูล" };
  }

  // Aggregate { store → chair codes }.
  const byStore = new Map<string, Set<string>>();
  let storesAtHome = 0;
  let totalChairRowsInFile = 0;
  for (const row of rows.slice(1)) {
    const code = String((row as unknown[])[0] ?? "").trim();
    const store = String((row as unknown[])[2] ?? "").trim();
    if (!code) continue;
    totalChairRowsInFile += 1;
    if (!store || /home|บ้าน/i.test(store)) {
      storesAtHome += 1;
      continue;
    }
    if (!byStore.has(store)) byStore.set(store, new Set());
    byStore.get(store)!.add(code.toUpperCase());
  }
  if (byStore.size === 0) {
    return { ok: false, error: "ไม่พบสาขาในไฟล์" };
  }

  // Normalize: lowercase + remove parens + remove spaces + strip Thai tone
  // marks (ิ ี ึ ื ุ ู ่ ้ ๊ ๋ ์ ็) so "centralโคราช(ธอส)(870)" matches "centralโคราชธอส".
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/\s+/g, "")
      .replace(/[่-๎ั-ฺ]/g, "");

  // Pull existing branches for org.
  const existingBranches = await prisma.chairopsBranch.findMany({
    where: { orgId: session.user.orgId },
    select: { id: true, name: true, slug: true, tabName: true },
  });
  const byNorm = new Map<string, (typeof existingBranches)[number]>();
  for (const b of existingBranches) byNorm.set(norm(b.name), b);

  // Build resolution plan.
  type Plan = {
    storeRaw: string;
    branchId?: string;
    branchName: string;
    isNewBranch: boolean;
    chairCodes: string[];
  };
  const plan: Plan[] = [];
  for (const [store, codeSet] of byStore) {
    const hit = byNorm.get(norm(store));
    plan.push({
      storeRaw: store,
      branchId: hit?.id,
      branchName: hit?.name ?? store,
      isNewBranch: !hit,
      chairCodes: Array.from(codeSet).sort(),
    });
  }

  // Slug helper — strip non-alnum and lowercase. Already-used slug suffixed
  // with -N to keep @@unique([orgId, slug]) happy.
  const usedSlugs = new Set(existingBranches.map((b) => b.slug));
  function pickSlug(seed: string): string {
    const base =
      seed
        .toLowerCase()
        .replace(/\(.*?\)/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || `branch-${Date.now()}`;
    if (!usedSlugs.has(base)) {
      usedSlugs.add(base);
      return base;
    }
    for (let i = 2; i < 100; i++) {
      const cand = `${base}-${i}`;
      if (!usedSlugs.has(cand)) {
        usedSlugs.add(cand);
        return cand;
      }
    }
    return `${base}-${Date.now()}`;
  }

  // ------------------------------------------------------------------------
  // Execute plan. File is source of truth for chair → branch mapping:
  //   - chair NOT in DB at all → CREATE (record ChairopsChairMove from=null)
  //   - chair in DB at SAME branch  → no-op
  //   - chair in DB at DIFFERENT branch → UPDATE branchId + record move
  // Chairs in DB but NOT in this file are left untouched (might be at-home
  // storage, awaiting redeploy). Operator can deactivate manually if needed.
  // ------------------------------------------------------------------------

  // Preload every chair the org owns so we can detect cross-branch moves
  // without per-row queries.
  const allChairs = await prisma.chairopsChair.findMany({
    where: { orgId: session.user.orgId },
    select: { id: true, chairCode: true, branchId: true },
  });
  const chairByCode = new Map(allChairs.map((c) => [c.chairCode, c]));

  let branchesCreated = 0;
  let chairsInsertedTotal = 0;
  let chairsMovedTotal = 0;
  let chairsAlreadyExistingTotal = 0;
  const perStore: Array<{
    store: string;
    branchName: string;
    created: boolean;
    chairsInserted: number;
    chairsMoved: number;
    chairsAlreadyExisting: number;
  }> = [];

  for (const p of plan) {
    let branchId = p.branchId;
    let created = false;
    if (!branchId) {
      const slug = pickSlug(p.storeRaw);
      const tabName = p.storeRaw.slice(0, 64);
      const fresh = await prisma.chairopsBranch.create({
        data: {
          orgId: session.user.orgId,
          slug,
          name: p.storeRaw,
          tabName,
          isActive: true,
        },
      });
      branchId = fresh.id;
      created = true;
      branchesCreated += 1;
    }

    let storeInserted = 0;
    let storeMoved = 0;
    let storeSame = 0;
    for (const code of p.chairCodes) {
      const existing = chairByCode.get(code);
      if (!existing) {
        // New chair — create + initial placement move row.
        const newChair = await prisma.chairopsChair.create({
          data: {
            orgId: session.user.orgId,
            branchId,
            chairCode: code,
            isActive: true,
          },
        });
        await prisma.chairopsChairMove.create({
          data: {
            orgId: session.user.orgId,
            chairId: newChair.id,
            fromBranchId: null,
            toBranchId: branchId,
            movedById: session.user.id,
            source: "starthing_import",
            notes: "first placement from StarThing equipment list",
          },
        });
        chairByCode.set(code, {
          id: newChair.id,
          chairCode: code,
          branchId,
        });
        storeInserted += 1;
        chairsInsertedTotal += 1;
        continue;
      }
      if (existing.branchId === branchId) {
        storeSame += 1;
        chairsAlreadyExistingTotal += 1;
        continue;
      }
      // Moved across branches.
      await prisma.chairopsChair.update({
        where: { id: existing.id },
        data: { branchId },
      });
      await prisma.chairopsChairMove.create({
        data: {
          orgId: session.user.orgId,
          chairId: existing.id,
          fromBranchId: existing.branchId,
          toBranchId: branchId,
          movedById: session.user.id,
          source: "starthing_import",
          notes: "branch change detected on StarThing re-import",
        },
      });
      chairByCode.set(code, { ...existing, branchId });
      storeMoved += 1;
      chairsMovedTotal += 1;
    }

    perStore.push({
      store: p.storeRaw,
      branchName: p.branchName,
      created,
      chairsInserted: storeInserted,
      chairsMoved: storeMoved,
      chairsAlreadyExisting: storeSame,
    });
  }

  await writeAudit({
    userId: session.user.id,
    action: "equipment.import_starthing",
    entity: "Chair",
    entityId: session.user.orgId,
    newValue: {
      url: xlsxUrl.slice(0, 120),
      storesInFile: byStore.size,
      storesAtHome,
      chairsInFile: totalChairRowsInFile,
      branchesCreated,
      chairsInserted: chairsInsertedTotal,
      chairsMoved: chairsMovedTotal,
    },
    metadata: { route: "/chairops/branches/import-equipment" },
  });

  revalidatePath("/chairops/branches");
  revalidatePath("/chairops/branch-collect");

  return {
    ok: true,
    data: {
      storesInFile: byStore.size,
      storesAtHome,
      chairsInFile: totalChairRowsInFile,
      branchesMatched: plan.filter((p) => !p.isNewBranch).length,
      branchesCreated,
      chairsInserted: chairsInsertedTotal,
      chairsMoved: chairsMovedTotal,
      chairsAlreadyExisting: chairsAlreadyExistingTotal,
      perStore,
    },
  };
}

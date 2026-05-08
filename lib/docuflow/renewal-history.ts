// DocuFlow · Renewal Comparison — chain history loader (Capability J)
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §14 (Renewal Comparison)
//
// "Renewal chain" = ลำดับเอกสารที่ต่ออายุกันมาเรื่อยๆ เช่น
//
//     ประกัน 2566 (oldest)        ↑ chain[0]
//        └── ต่ออายุ → ประกัน 2567 ↑ chain[1]
//             └── ต่ออายุ → ประกัน 2568 ↑ chain[2]
//                  └── ต่ออายุ → ประกัน 2569 ← given documentId
//
// Source of truth สำหรับ chain link คือ audit_logs:
//   action       = 'DOCUFLOW_RENEW'
//   resource_id  = ID ของเอกสารใหม่ (ปลายลูกศร)
//   diff.new.oldDocumentId = ID ของเอกสารเก่า (ต้นลูกศร)
//
// ไม่มี FK column → ใช้ JSON path query บน Postgres jsonb
// (`diff -> 'new' ->> 'oldDocumentId'`)
//
// Contract:
//   loadRenewalChain(orgId, documentId)
//     → returns array oldest → newest, รวม node ปัจจุบันด้วย
//     → org-scoped, soft-delete-aware (skip isActive=false)
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import {
  daysUntilExpiry,
  getExpiryStatus,
  type ExpiryStatus,
} from "./expiry";

/* ============================================================
   Types
   ============================================================ */

export interface RenewalChainNode {
  /** Document fields (subset — what UI needs) */
  document: {
    id: string;
    name: string;
    fileKey: string;
    mimeType: string | null;
    isActive: boolean;
    uploadedAt: Date;
  };
  /** Most recent renewal row for this document (may be null) */
  renewal: {
    id: string;
    expiryDate: Date;
    status: string;
    lastRenewedDate: Date | null;
    nextRenewalDate: Date | null;
    daysUntilExpiry: number;
    expiryStatus: ExpiryStatus;
  } | null;
  /** Convenience — Christian year of expiry (or upload year if no renewal) */
  year: number;
  /** Convenience — when this document was added to the chain */
  createdAt: Date;
  /** Position in chain — 0 = oldest, length-1 = newest */
  index: number;
}

/* ============================================================
   loadRenewalChain — traverse predecessors AND successors
   ============================================================ */

const MAX_CHAIN_LENGTH = 20; // safety bound — protect against cycles / runaway

/**
 * Build the full renewal chain that contains `documentId`.
 *
 * Strategy:
 *   1. Walk BACKWARDS — for each step, find the audit_log where
 *      this document is the NEW one (resource_id) and read
 *      `diff.new.oldDocumentId` → the predecessor.
 *   2. Walk FORWARDS — find audit_logs where THIS document is the
 *      OLD one (`diff.new.oldDocumentId = current`) → its successor
 *      is `resource_id`.
 *   3. Concatenate: predecessors (oldest → just-before) + current
 *      + successors (just-after → newest).
 *   4. Hydrate every id → Document + most-recent DocumentRenewal.
 */
export async function loadRenewalChain(
  orgId: string,
  documentId: string,
): Promise<RenewalChainNode[]> {
  // 1. predecessors — walk back via diff.new.oldDocumentId
  const predecessors: string[] = [];
  let cursor: string | null = documentId;
  const seenBack = new Set<string>([documentId]);

  while (cursor && predecessors.length < MAX_CHAIN_LENGTH) {
    const prev: string | null = await findPredecessor(orgId, cursor);
    if (!prev || seenBack.has(prev)) break;
    seenBack.add(prev);
    predecessors.unshift(prev); // prepend → keep oldest-first order
    cursor = prev;
  }

  // 2. successors — walk forward via diff.new.oldDocumentId = current
  const successors: string[] = [];
  let fwdCursor: string | null = documentId;
  const seenFwd = new Set<string>([documentId, ...predecessors]);

  while (fwdCursor && successors.length < MAX_CHAIN_LENGTH) {
    const next: string | null = await findSuccessor(orgId, fwdCursor);
    if (!next || seenFwd.has(next)) break;
    seenFwd.add(next);
    successors.push(next);
    fwdCursor = next;
  }

  // 3. final ordered ids — oldest → newest
  const allIds: string[] = [...predecessors, documentId, ...successors];

  // 4. hydrate — single batched query for docs + most-recent renewals
  const docs = await prisma.document.findMany({
    where: { id: { in: allIds }, orgId },
    select: {
      id: true,
      name: true,
      fileKey: true,
      mimeType: true,
      isActive: true,
      uploadedAt: true,
      renewals: {
        orderBy: { expiryDate: "desc" },
        take: 1,
        select: {
          id: true,
          expiryDate: true,
          status: true,
          lastRenewedDate: true,
          nextRenewalDate: true,
        },
      },
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Preserve the chronological order from `allIds`
  const nodes: RenewalChainNode[] = [];
  for (let i = 0; i < allIds.length; i += 1) {
    const id = allIds[i];
    const d = byId.get(id);
    if (!d) continue; // doc deleted hard or wrong org → skip silently
    const r = d.renewals[0] ?? null;
    const year = (r?.expiryDate ?? d.uploadedAt).getUTCFullYear();
    nodes.push({
      document: {
        id: d.id,
        name: d.name,
        fileKey: d.fileKey,
        mimeType: d.mimeType,
        isActive: d.isActive,
        uploadedAt: d.uploadedAt,
      },
      renewal: r
        ? {
            id: r.id,
            expiryDate: r.expiryDate,
            status: r.status,
            lastRenewedDate: r.lastRenewedDate,
            nextRenewalDate: r.nextRenewalDate,
            daysUntilExpiry: daysUntilExpiry(r.expiryDate),
            expiryStatus: getExpiryStatus(r.expiryDate),
          }
        : null,
      year,
      createdAt: d.uploadedAt,
      index: nodes.length,
    });
  }

  // Re-index after possible skips
  return nodes.map((n, i) => ({ ...n, index: i }));
}

/* ============================================================
   Internal helpers — audit_log walkers
   ============================================================ */

/** Find the document that THIS document was renewed FROM. */
async function findPredecessor(
  orgId: string,
  newDocumentId: string,
): Promise<string | null> {
  // resource_id = newDocumentId, diff->new->oldDocumentId = ?
  const admin = adminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("diff")
    .eq("org_id", orgId)
    .eq("action", "DOCUFLOW_RENEW")
    .eq("resource_type", "document")
    .eq("resource_id", newDocumentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const row = data[0] as { diff: { new?: { oldDocumentId?: string } } | null };
  const oldId = row.diff?.new?.oldDocumentId;
  return typeof oldId === "string" && oldId.length > 0 ? oldId : null;
}

/** Find the document that was created TO REPLACE this one. */
async function findSuccessor(
  orgId: string,
  oldDocumentId: string,
): Promise<string | null> {
  // diff->new->oldDocumentId = oldDocumentId, resource_id = newDocumentId
  // Supabase JS doesn't expose `->>` directly — use rpc-equivalent filter via
  // `filter()` on jsonb path. Falls back to client-side filter on small set.
  const admin = adminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("resource_id, diff")
    .eq("org_id", orgId)
    .eq("action", "DOCUFLOW_RENEW")
    .eq("resource_type", "document")
    .filter("diff->new->>oldDocumentId", "eq", oldDocumentId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const row = data[0] as { resource_id: string | null };
  return row.resource_id && row.resource_id.length > 0 ? row.resource_id : null;
}

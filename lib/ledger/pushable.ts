// Shared loader: expense row → the shape the TRCloud pusher/converter needs.
//
// MOVED OUT of app/(admin)/ledger/_actions.ts (a "use server" file — a lib cannot
// import from it). This is a PLAIN server-usable module (no "use server", no
// "server-only") so both the server actions AND the session-less auto-convert core
// (lib/ledger/ap-auto-convert.ts) can share ONE loader. Accounting logic unchanged.

import { prisma } from "@/lib/prisma";
import { isTrcloudSent } from "@/lib/ledger/trcloud-state";
import type { PushableExpense } from "@/lib/ledger/trcloud-push";

/** Load the full expense (items + category GL) → the shape the pusher needs.
 *  companyId is REQUIRED — never omit it, as one org can own multiple legal
 *  entities (e.g. Pooil + JP Sync with separate VAT books). A query without
 *  companyId would let an accountant push an expense belonging to a different
 *  company in the same org (cross-company VAT leak). */
export async function loadPushable(
  orgId: string,
  id: string,
  companyId: string,
): Promise<
  | {
      pushable: PushableExpense;
      status: string;
      docType: string;
      companyId: string;
      alreadyPushed: boolean;
      stalePending: boolean;
      // TRCloud state columns — callers guard on these (PO sent? already AP?)
      // without a second query. Raw values (may hold sentinels "pending"/"error").
      trcloudDocId: string | null;
      trcloudApDocId: string | null;
    }
  | null
> {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id, orgId, companyId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      category: {
        select: {
          name: true,
          trcloudAccCode: true,
          trcloudProductCode: true,
          vatClaimable: true,
        },
      },
      branch: { select: { settings: true } },
    },
  });
  if (!row) return null;

  // Branch.settings stores TRCloud branch config: { trcloudProject, trcloudDepartment }
  const branchSettings =
    row.branch?.settings && typeof row.branch.settings === "object"
      ? (row.branch.settings as Record<string, unknown>)
      : {};

  return {
    status: row.status,
    docType: row.docType,
    companyId: row.companyId,
    // Only a REAL doc id = already pushed. A failed push ("error") is RE-SENDABLE
    // (it created no TRCloud doc; the push dedups by reference). "pending" is handled
    // separately via stalePending below. See trcloud-state.ts.
    alreadyPushed: isTrcloudSent(row.trcloudDocId),
    // self-heal: a 'pending' row stuck >5 min = a prior push died mid-flight → reclaimable
    // (TRCloud push dedups by docCode, so retrying an actually-succeeded push won't dup the AP).
    stalePending:
      row.trcloudDocId === "pending" && row.updatedAt < new Date(Date.now() - 5 * 60 * 1000),
    trcloudDocId: row.trcloudDocId,
    trcloudApDocId: row.trcloudApDocId,
    pushable: {
      id: row.id,
      orgId: row.orgId,
      companyId: row.companyId,
      docCode: row.docCode,
      vendor: row.vendor,
      vendorTaxId: row.vendorTaxId,
      vendorAddress: row.vendorAddress,
      docDate: row.docDate,
      subtotal: Number(row.subtotal),
      vat: Number(row.vat),
      wht: Number(row.wht),
      discount: Number(row.discount),
      total: Number(row.total),
      paymentStatus: row.paymentStatus,
      note: row.note,
      categoryName: row.category?.name ?? null,
      categoryAccCode: row.category?.trcloudAccCode ?? null,
      trcloudProductCode:
        (row.category?.trcloudProductCode as string | null) ?? null,
      purchaseType: row.trcloudPurchaseType ?? null,
      inputVatClaimable: row.category?.vatClaimable ?? false,
      branchTrcloudProject:
        typeof branchSettings.trcloudProject === "string"
          ? branchSettings.trcloudProject
          : null,
      branchTrcloudDepartment:
        typeof branchSettings.trcloudDepartment === "string"
          ? branchSettings.trcloudDepartment
          : null,
      items: row.items.map((it) => ({
        description: it.description,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        vatRate: it.vatRate == null ? null : Number(it.vatRate),
      })),
    },
  };
}

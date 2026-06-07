// Shared types for the LedgerLine stock-IN preview flow. Kept OUT of the "use server"
// actions module — a server-action file may only export async functions, so the preview
// shapes (consumed by the client StockInButton) live here.

import type { PackUnit } from "@/lib/ledger/sku-match";

export type PreviewLine = {
  itemId: string;
  description: string;
  qty: number;
  amount: number;
  status: "ok" | "unmatched" | "untracked" | "wrong_branch";
  sku: { skuId: string; productId: string; productName: string | null; baseUnit: string | null; packUnits: PackUnit[] } | null;
};

export type StockInPreview =
  | {
      ok: true;
      branchId: string | null;
      branchName: string | null;
      projectSet: boolean;
      lines: PreviewLine[];
    }
  | { ok: false; error: string; alreadySent?: boolean };

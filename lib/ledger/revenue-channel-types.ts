// LedgerLine — Revenue channel taxonomy + normalization (CLIENT-SAFE).
//
// Pure constants + a pure normalizer with NO prisma / NO "server-only", so both
// client components (the add-modal dropdown, the channel→GL settings manager) and
// server code can import it. The prisma-backed GL resolution lives in the
// server-only sibling revenue-channel.ts.

export const REVENUE_CHANNELS = [
  "cash",
  "transfer",
  "card",
  "qr",
  "wallet",
  "cod",
  "other",
] as const;

export type RevenueChannelCode = (typeof REVENUE_CHANNELS)[number];

// Thai labels for the dropdown + pivot headers.
export const REVENUE_CHANNEL_LABELS: Record<RevenueChannelCode, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  card: "บัตรเครดิต/เดบิต",
  qr: "QR / พร้อมเพย์",
  wallet: "วอลเล็ต (TrueMoney ฯลฯ)",
  cod: "เก็บเงินปลายทาง",
  other: "อื่น ๆ",
};

export function isRevenueChannel(v: unknown): v is RevenueChannelCode {
  return typeof v === "string" && (REVENUE_CHANNELS as readonly string[]).includes(v);
}

/**
 * Map any raw channel string into the canonical enum.
 *
 * Same patterns as the SQL backfill in 20260613001000_ledger_revenue_gl.sql —
 * keep the two in sync (one place to extend). Returns null when the input is
 * empty or unrecognized (caller leaves channel_code NULL = "ไม่ระบุ").
 */
export function normalizeChannel(raw: string | null | undefined): RevenueChannelCode | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // Already canonical?
  if (isRevenueChannel(s)) return s;

  if (/(cash|เงินสด|สด)/.test(s)) return "cash";
  if (/(qr|พร้อมเพย์|พร้อมเพ|promptpay|prompt\s*pay)/.test(s)) return "qr";
  if (/(card|บัตร|credit|debit|visa|master|edc)/.test(s)) return "card";
  if (/(transfer|โอน|bank|ธนาคาร)/.test(s)) return "transfer";
  if (/(wallet|truemoney|true\s*money|วอลเล)/.test(s)) return "wallet";
  if (/(cod|ปลายทาง)/.test(s)) return "cod";
  return null;
}

// LedgerLine — LINE flex message builder for the "บันทึกแล้ว — ยืนยัน/แก้ไข" card.
//
// After a staff member drops a receipt photo into the central LINE group, the
// webhook (Partition B · app/api/webhooks/ledger/line/[channelId]/route.ts)
// stores the image, runs ai-parse, creates a DRAFT expense (NEVER auto-post),
// then replies with this flex bubble so the front-line person sees what the AI
// read at a glance — amount, vendor, date, category, per-field confidence — and
// can tap "ยืนยัน" (confirm) or "แก้ไข" (open the web review pane to edit).
//
// This file is a PURE builder: no React, no server imports. It returns a plain
// object that the webhook drops straight into the LINE Reply/Push API
// `messages: [...]` array (same shape ChairOps/Inbox push to LINE today). Keeping
// it pure means tsc stays green even though Partition B's route isn't built yet.
//
// Confidence colours follow the Pool palette used in the web review pane so the
// LINE card and the desktop ConfidenceTag agree: ≥0.85 green · ≥0.6 amber · low rose.

/** Per-field OCR confidence (0–1) returned by ai-parse (jsonb on ledger_expense). */
export interface LedgerOcrConfidence {
  vendor?: number;
  doc_date?: number;
  total?: number;
  [field: string]: number | undefined;
}

/** Minimal draft-expense shape needed to render the LINE confirm card. */
export interface LedgerConfirmCardInput {
  /** ledger_expense.id — used to build the confirm/edit deep-links. */
  expenseId: string;
  /** ledger_expense.doc_code (EXP-YYYYMM-NNNN). */
  docCode: string;
  /** Vendor name as read by OCR (null until confirmed). */
  vendor?: string | null;
  /** ISO date string (YYYY-MM-DD) or null. */
  docDate?: string | null;
  /** Grand total in THB. */
  total: number;
  /** VAT amount in THB (optional, shown only when present). */
  vat?: number | null;
  /** Human-readable category name (suggested by AI), or null. */
  categoryName?: string | null;
  /** Per-field confidence — drives the low-confidence warning + colour. */
  confidence?: LedgerOcrConfidence | null;
  /** True when Recheck flagged a math/format mismatch (subtotal+vat≠total, bad taxid…). */
  needsReview?: boolean;
  /**
   * Base URL of the deploy (e.g. https://pooilgroup.vercel.app) so the buttons
   * deep-link into the web review pane. Defaults to relative when omitted (LINE
   * requires absolute https URIs, so the webhook should always pass this).
   */
  baseUrl?: string;
}

// ── LINE flex primitives (the subset we emit) ───────────────────────────────
// Typed locally so we don't depend on @line/bot-sdk; matches LINE's documented
// flex JSON schema. The webhook only needs these to satisfy `messages: unknown[]`.
type FlexText = {
  type: "text";
  text: string;
  size?: string;
  weight?: "regular" | "bold";
  color?: string;
  flex?: number;
  align?: "start" | "end" | "center";
  wrap?: boolean;
  margin?: string;
};
type FlexBox = {
  type: "box";
  layout: "vertical" | "horizontal" | "baseline";
  contents: FlexComponent[];
  spacing?: string;
  margin?: string;
  paddingAll?: string;
  cornerRadius?: string;
  backgroundColor?: string;
};
type FlexButton = {
  type: "button";
  style: "primary" | "secondary" | "link";
  height?: "sm" | "md";
  color?: string;
  action: { type: "uri"; label: string; uri: string };
};
type FlexSeparator = { type: "separator"; margin?: string; color?: string };
type FlexComponent = FlexText | FlexBox | FlexButton | FlexSeparator;

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: {
    type: "bubble";
    size?: "nano" | "micro" | "kilo" | "mega" | "giga";
    header?: FlexBox;
    body: FlexBox;
    footer?: FlexBox;
  };
}

const COLOR = {
  ink: "#18181B",
  sub: "#71717A",
  brand: "#2563EB",
  good: "#16A34A",
  warn: "#D97706",
  bad: "#DC2626",
  line: "#E4E4E7",
  warnBg: "#FEF3C7",
} as const;

function confidenceColor(c?: number): string {
  if (c == null) return COLOR.sub;
  if (c >= 0.85) return COLOR.good;
  if (c >= 0.6) return COLOR.warn;
  return COLOR.bad;
}

function fmtTHB(n: number): string {
  return `฿${(Number.isFinite(n) ? n : 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  // Show as DD/MM/YYYY (Thai-friendly); fall back to the raw string if unparsable.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** One "label · value" row, with the value tinted by its confidence. */
function fieldRow(label: string, value: string, conf?: number): FlexBox {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: COLOR.sub, flex: 2 },
      {
        type: "text",
        text: value || "—",
        size: "sm",
        color: confidenceColor(conf),
        weight: "bold",
        flex: 4,
        wrap: true,
      },
    ],
  };
}

/**
 * Build the "บันทึกแล้ว — ยืนยัน/แก้ไข" flex message.
 *
 * Returns a plain object ready for LINE `messages: [...]`. The webhook (Partition
 * B) is responsible for pushing it. Deep-links target the web review pane:
 *   ยืนยัน → /ledger/expenses?confirm=<id>   (accountant taps; never auto-posts)
 *   แก้ไข  → /ledger/expenses?edit=<id>
 * (Per the golden rule, even the "ยืนยัน" button only OPENS the confirm flow —
 *  a human still presses confirm in the review pane.)
 */
export function buildLineConfirmCard(input: LedgerConfirmCardInput): LineFlexMessage {
  const {
    expenseId,
    docCode,
    vendor,
    docDate,
    total,
    vat,
    categoryName,
    confidence,
    needsReview,
    baseUrl = "",
  } = input;

  const base = baseUrl.replace(/\/+$/, "");
  const confirmUri = `${base}/ledger/expenses?confirm=${encodeURIComponent(expenseId)}`;
  const editUri = `${base}/ledger/expenses?edit=${encodeURIComponent(expenseId)}`;

  const bodyContents: FlexComponent[] = [
    // Big amount line.
    {
      type: "box",
      layout: "vertical",
      spacing: "none",
      contents: [
        { type: "text", text: "ยอดที่อ่านได้", size: "xs", color: COLOR.sub },
        {
          type: "text",
          text: fmtTHB(total),
          size: "xxl",
          weight: "bold",
          color: confidenceColor(confidence?.total),
        },
      ],
    },
    { type: "separator", margin: "lg", color: COLOR.line },
    // Detail rows.
    {
      type: "box",
      layout: "vertical",
      margin: "lg",
      spacing: "sm",
      contents: [
        fieldRow("ร้านค้า", vendor ?? "—", confidence?.vendor),
        fieldRow("วันที่", fmtDate(docDate), confidence?.doc_date),
        fieldRow("หมวด", categoryName ?? "ยังไม่จัดหมวด"),
        ...(vat != null && vat > 0 ? [fieldRow("VAT", fmtTHB(vat))] : []),
      ],
    },
  ];

  // Recheck / low-confidence banner.
  if (needsReview) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "lg",
      paddingAll: "10px",
      cornerRadius: "8px",
      backgroundColor: COLOR.warnBg,
      contents: [
        {
          type: "text",
          text: "⚠️ ตรวจเลขก่อนยืนยัน — ยอดอาจไม่ตรง",
          size: "sm",
          weight: "bold",
          color: COLOR.warn,
          wrap: true,
        },
      ],
    });
  }

  return {
    type: "flex",
    altText: `บันทึกแล้ว ${docCode} · ${fmtTHB(total)} — กดยืนยัน/แก้ไข`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "บันทึกค่าใช้จ่ายแล้ว (ฉบับร่าง)",
            size: "sm",
            weight: "bold",
            color: COLOR.ink,
          },
          { type: "text", text: docCode, size: "xs", color: COLOR.sub, margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.brand,
            action: { type: "uri", label: "ยืนยัน", uri: confirmUri },
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "uri", label: "แก้ไข", uri: editUri },
          },
        ],
      },
    },
  };
}

export default buildLineConfirmCard;

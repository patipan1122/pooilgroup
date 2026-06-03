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
  /**
   * company_id the expense belongs to. Carried into the deep-link as ?company=
   * so the web expenses page opens the RIGHT company. Without it the page
   * defaults to the org's FIRST company (resolveScope), and a receipt belonging
   * to any other company returns "ไม่พบรายการ". Required for multi-company orgs
   * (JP Link runs 2 companies). The webhook knows it as channel.companyId.
   */
  companyId: string;
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
  /** Branch name the expense is filed under (optional). */
  branchName?: string | null;
  /** Payment method as read (cash|transfer|qr|credit_card|other), optional. */
  paymentMethod?: string | null;
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
  /**
   * LedgerLine's OWN LIFF id (NEXT_PUBLIC_LEDGER_LIFF_ID). When set, the buttons
   * open the web review pane THROUGH the LIFF (liff.line.me/<id>?next=…) so the
   * staffer logs in inside LINE via LedgerLine's own channel and avoids the iOS
   * in-app-browser cookie-drop. When omitted, falls back to a plain web deep-link.
   */
  liffId?: string;
  /**
   * When true, the buttons emit LINE *postback* actions instead of URI links, so
   * the staffer can act without leaving LINE. The webhook (Partition B) handles
   * the postback data `ledger:confirm:<id>` / `ledger:edit:<id>`.
   *
   * GOLDEN RULE preserved: a "ยืนยัน" postback only marks the field-staff
   * acknowledgement and routes to the accountant confirm flow — it never
   * auto-posts the expense. Defaults to false (URI deep-links into the web pane).
   */
  usePostback?: boolean;
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
  alignItems?: "flex-start" | "center" | "flex-end";
  flex?: number;
};
type FlexImage = {
  type: "image";
  url: string;
  size?: string;
  aspectMode?: "cover" | "fit";
  aspectRatio?: string;
  flex?: number;
  align?: "start" | "end" | "center";
};
type FlexAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText?: string };
type FlexButton = {
  type: "button";
  style: "primary" | "secondary" | "link";
  height?: "sm" | "md";
  color?: string;
  action: FlexAction;
};
type FlexSeparator = { type: "separator"; margin?: string; color?: string };
type FlexComponent = FlexText | FlexBox | FlexButton | FlexSeparator | FlexImage;

// Brand art lives in public/ledger/brand/ (CEO-swappable). LINE needs ABSOLUTE
// https URLs for flex images, so we build them from the webhook's baseUrl and
// only show the mascot/logo when we have one (relative URLs would silently fail
// to render in LINE). SVG is fine for LINE flex `image`.
const BRAND_PATH = {
  mascot: "/ledger/brand/mascot.svg",
  logo: "/ledger/brand/logo.svg",
} as const;

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

const PAYMENT_LABEL: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  qr: "QR พร้อมเพย์",
  credit_card: "บัตรเครดิต",
  other: "อื่น ๆ",
};
function fmtPayment(m?: string | null): string | null {
  if (!m) return null;
  return PAYMENT_LABEL[m] ?? m;
}

/** Lowest confidence across the key fields → drives the "ตรวจ" nudge on the card. */
function lowestConfidence(c?: LedgerOcrConfidence | null): number | null {
  if (!c) return null;
  const scores = [c.total, c.vendor, c.doc_date].filter(
    (v): v is number => typeof v === "number",
  );
  if (!scores.length) return null;
  return Math.min(...scores);
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
 * B) is responsible for pushing it.
 *
 * Two action modes (set `usePostback`):
 *   • URI (default) → deep-link the web review pane (single ?selected= param)
 *       ยืนยัน → /ledger/expenses?selected=<id>
 *       แก้ไข  → /ledger/expenses?selected=<id>
 *   • postback → act inside LINE (webhook handles `ledger:confirm:<id>` /
 *       `ledger:edit:<id>`), for when the field staff shouldn't leave the chat.
 *
 * Per the GOLDEN RULE, even the "ยืนยัน" action only OPENS / routes the confirm
 * flow to an accountant — it never auto-posts the expense.
 */
export function buildLineConfirmCard(input: LedgerConfirmCardInput): LineFlexMessage {
  const {
    expenseId,
    companyId,
    docCode,
    vendor,
    docDate,
    total,
    vat,
    categoryName,
    branchName,
    paymentMethod,
    confidence,
    needsReview,
    baseUrl = "",
    liffId,
    usePostback = false,
  } = input;

  const base = baseUrl.replace(/\/+$/, "");
  const payment = fmtPayment(paymentMethod);
  // The web review pane path (pin the company so a multi-company org opens the
  // right one, then select the expense).
  const webPath = `/ledger/expenses?${
    companyId ? `company=${encodeURIComponent(companyId)}&` : ""
  }selected=${encodeURIComponent(expenseId)}`;
  // Prefer opening THROUGH LedgerLine's own LIFF (login inside LINE, no iOS
  // cookie-drop): liff.line.me/<id>?next=<webPath> — the LIFF bootstrap reads
  // ?next and redirects there after auth. Falls back to a plain web deep-link.
  const deepLink = liffId
    ? `https://liff.line.me/${liffId}?next=${encodeURIComponent(webPath)}`
    : `${base}${webPath}`;
  // Absolute brand URLs (LINE flex images must be https). Only when baseUrl set.
  const mascotUrl = base ? `${base}${BRAND_PATH.mascot}` : null;

  // Button actions: postback (act inside LINE) or URI (open the web review pane).
  // Either way confirm is an explicit human tap that routes to the accountant
  // confirm flow — NEVER an auto-post (golden rule).
  // URI deep-links use ?selected=<id> — the SINGLE param the expenses page reads
  // (app/(admin)/ledger/expenses/page.tsx). Both buttons open the same review
  // pane (where the accountant confirms/edits); ?confirm/?edit were dead params
  // that left the user on an empty list. GOLDEN RULE intact: opening the pane is
  // not an auto-post — the accountant still taps confirm in the pane.
  const confirmAction: FlexAction = usePostback
    ? {
        type: "postback",
        label: "ยืนยัน",
        data: `ledger:confirm:${expenseId}`,
        displayText: "ยืนยันใบเสร็จนี้",
      }
    : { type: "uri", label: "ยืนยัน", uri: deepLink };
  const editAction: FlexAction = usePostback
    ? {
        type: "postback",
        label: "แก้ไข",
        data: `ledger:edit:${expenseId}`,
        displayText: "ขอแก้ไขใบเสร็จนี้",
      }
    : { type: "uri", label: "แก้ไข", uri: deepLink };

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
        fieldRow("หมวด", categoryName ?? "ยังไม่จัดหมวด", confidence?.category),
        ...(branchName ? [fieldRow("สาขา", branchName)] : []),
        ...(payment ? [fieldRow("ชำระโดย", payment, confidence?.payment_method)] : []),
        ...(vat != null && vat > 0 ? [fieldRow("VAT", fmtTHB(vat))] : []),
      ],
    },
  ];

  // Recheck / low-confidence banner.
  const lowConf = lowestConfidence(confidence);
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
  } else if (lowConf != null && lowConf < 0.6) {
    // No math error, but AI was unsure on a key field → soft nudge to eyeball it.
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
          text: "👀 AI ไม่ค่อยมั่นใจบางช่อง — ลองตรวจก่อนยืนยัน",
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
      // Friendly header — น้องใบเสร็จ (mascot avatar) greets the staffer next to
      // the title, Bainy-style. Mascot only renders when we have an absolute URL
      // (baseUrl); otherwise we degrade to the clean text-only header (no broken
      // image in LINE).
      header: {
        type: "box",
        layout: "horizontal",
        paddingAll: "16px",
        spacing: "md",
        alignItems: "center",
        backgroundColor: "#EFF4FF",
        contents: [
          ...(mascotUrl
            ? ([
                {
                  type: "image",
                  url: mascotUrl,
                  size: "xs",
                  aspectMode: "fit",
                  aspectRatio: "1:1",
                  flex: 0,
                } as FlexImage,
              ] as FlexComponent[])
            : []),
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            spacing: "none",
            contents: [
              {
                type: "text",
                text: "บันทึกให้แล้ว — ช่วยเช็กให้หน่อยนะ",
                size: "sm",
                weight: "bold",
                color: COLOR.ink,
                wrap: true,
              },
              {
                type: "text",
                text: `ฉบับร่าง · ${docCode}`,
                size: "xs",
                color: COLOR.sub,
                margin: "xs",
              },
            ],
          },
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
            action: confirmAction,
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: editAction,
          },
        ],
      },
    },
  };
}

export default buildLineConfirmCard;

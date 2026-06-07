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

import type { ExpenseDocType } from "@/lib/ledger/types";

/** Per-field OCR confidence (0–1) returned by ai-parse (jsonb on ledger_expense). */
export interface LedgerOcrConfidence {
  vendor?: number;
  doc_date?: number;
  total?: number;
  [field: string]: number | undefined;
}

/** Minimal line-item shape the card renders (a lenient subset of ExpenseItem). */
export interface ConfirmCardItem {
  description: string;
  qty?: number;
  amount?: number;
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
  // — Bainy-parity fields (all optional; each renders its row only when present) —
  /** ประเภทเอกสาร (AI-classified). Shows a "ประเภท" row when present. */
  docType?: ExpenseDocType | null;
  /** เลขที่เอกสารของผู้ขาย (invoice/receipt no.) — shown as a รายละเอียด row. */
  vendorDocNumber?: string | null;
  /** ที่อยู่ผู้ขาย (ย่อ) — shown as a wrapped รายละเอียด row. */
  vendorAddress?: string | null;
  /** ส่วนลดระดับเอกสาร (THB). Shows a "ส่วนลด" row only when > 0. */
  discount?: number | null;
  /** วันที่บันทึก (capture/record date, ISO) — the 2nd date beside docDate (วันที่บิล). */
  recordedDate?: string | null;
  /** Free-text detail (note) — e.g. the "จด …" text or a dup warning. */
  note?: string | null;
  /** Line items read off the receipt — rendered as a compact list block. */
  items?: ConfirmCardItem[] | null;
  /** Per-field confidence — drives the low-confidence warning + colour. */
  confidence?: LedgerOcrConfidence | null;
  /** True when Recheck flagged a math/format mismatch (subtotal+vat≠total, bad taxid…). */
  needsReview?: boolean;
  /**
   * True when the AI/Gemini OCR step failed entirely (parsed = null). The card still
   * saves the image as a draft but all numeric fields are zero. Show a distinct
   * message so staff know to fill in the amount manually — ฿0.00 must not look real.
   */
  ocrFailed?: boolean;
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
  | { type: "postback"; label: string; data: string; displayText?: string }
  | { type: "message"; label: string; text: string };
type FlexButton = {
  type: "button";
  style: "primary" | "secondary" | "link";
  height?: "sm" | "md";
  color?: string;
  action: FlexAction;
};
type FlexSeparator = { type: "separator"; margin?: string; color?: string };
type FlexComponent = FlexText | FlexBox | FlexButton | FlexSeparator | FlexImage;

// Brand art lives in public/ledger/brand/mascot/ (CEO-swappable). LINE needs
// ABSOLUTE https URLs for flex images, built from the webhook's baseUrl; we only
// show the mascot when we have one (relative URLs silently fail to render in
// LINE). Mascot "JP" (น้องใบเสร็จ) ships ~10 emotion poses (sticker-style) —
// the card picks the pose that matches the result, like a LINE sticker reacting:
//   • needs review / low confidence → "confused" (raised brow)
//   • all good                      → "celebrate" (thumbs up / OK)
//   • multi-receipt summary         → "money" (juggling receipts)
const MASCOT_DIR = "/ledger/brand/mascot";
type MascotPose =
  | "receipt" | "celebrate" | "confused" | "alert" | "money"
  | "camera" | "explain" | "welcome" | "typing" | "sleepy";
function mascotPath(pose: MascotPose): string {
  return `${MASCOT_DIR}/${pose}-sm.png`;
}
/** Pick the pose that matches a single card's state (sticker-like reaction). */
function poseForState(needsReview: boolean | undefined, lowConf: number | null): MascotPose {
  if (needsReview) return "confused";
  if (lowConf != null && lowConf < 0.6) return "alert";
  return "celebrate";
}

export interface FlexBubble {
  type: "bubble";
  size?: "nano" | "micro" | "kilo" | "mega" | "giga";
  header?: FlexBox;
  body: FlexBox;
  footer?: FlexBox;
}
export interface FlexCarousel {
  type: "carousel";
  contents: FlexBubble[];
}
export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: FlexBubble | FlexCarousel;
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

const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice: "ใบกำกับภาษี",
  receipt: "ใบเสร็จรับเงิน",
  cash_bill: "บิลเงินสด",
  delivery_note: "ใบส่งของ",
  other: "อื่น ๆ",
};
function fmtDocType(t?: string | null): string | null {
  if (!t) return null;
  return DOC_TYPE_LABEL[t] ?? t;
}

// LINE flex truncates long values badly; keep a wrapped detail (address/note)
// readable but bounded so the bubble doesn't balloon.
function clip(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const MAX_CARD_ITEMS = 5; // keep the bubble short; overflow noted as "+ อีก N"
/** A compact "รายการสินค้า" block (header + up to N line items + overflow). */
function itemsBlock(items: ConfirmCardItem[]): FlexBox {
  const shown = items.slice(0, MAX_CARD_ITEMS);
  const overflow = items.length - shown.length;
  const lines: FlexComponent[] = shown.map((it) => {
    const qtyTxt = it.qty != null && it.qty !== 1 ? ` ×${it.qty}` : "";
    return {
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: `• ${clip(it.description, 40)}${qtyTxt}`,
          size: "xs",
          color: COLOR.ink,
          flex: 5,
          wrap: true,
        },
        {
          type: "text",
          text: it.amount != null ? fmtTHB(it.amount) : "—",
          size: "xs",
          color: COLOR.sub,
          align: "end",
          flex: 3,
        },
      ],
    };
  });
  if (overflow > 0) {
    lines.push({
      type: "text",
      text: `+ อีก ${overflow} รายการ`,
      size: "xs",
      color: COLOR.sub,
      margin: "xs",
    });
  }
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    spacing: "xs",
    contents: [
      { type: "text", text: "รายการสินค้า", size: "xs", color: COLOR.sub, weight: "bold" },
      ...lines,
    ],
  };
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
/**
 * Build a single confirm BUBBLE (used standalone by buildLineConfirmCard or as
 * one slide of a multi-receipt carousel).
 */
export function buildConfirmBubble(input: LedgerConfirmCardInput): FlexBubble {
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
    docType,
    vendorDocNumber,
    vendorAddress,
    discount,
    recordedDate,
    note,
    items,
    confidence,
    needsReview,
    ocrFailed,
    baseUrl = "",
    liffId,
    usePostback = false,
  } = input;

  const base = baseUrl.replace(/\/+$/, "");
  const payment = fmtPayment(paymentMethod);
  const docTypeLabel = fmtDocType(docType);
  const lowConf = lowestConfidence(confidence);
  // Web (no-LIFF) fallback → the desktop review pane (pin the company so a multi-
  // company org opens the right one, then select the expense).
  const webPath = `/ledger/expenses?${
    companyId ? `company=${encodeURIComponent(companyId)}&` : ""
  }selected=${encodeURIComponent(expenseId)}`;
  // In-LIFF target → a FULL Bainy-style mobile edit form (reuses ExpenseReviewPane),
  // opened INSIDE LINE so the capturer edits without bouncing to the desktop pane
  // (which is admin-gated + cramped on phones). This is what Bainy does.
  const liffEditPath = `/liff/ledger/expense/${encodeURIComponent(expenseId)}${
    companyId ? `?company=${encodeURIComponent(companyId)}` : ""
  }`;
  // Open THROUGH LedgerLine's own LIFF (login inside LINE, no iOS cookie-drop):
  // liff.line.me/<id>/ledger?next=<liffEditPath>. LiffBootstrap reads ?next (top-
  // level OR buried in ?liff.state) and redirects there after auth — robust to
  // BOTH LIFF endpoint configs (/liff and /liff/ledger). Falls back to the plain
  // web pane when no LIFF id is configured.
  const deepLink = liffId
    ? `https://liff.line.me/${liffId}/ledger?next=${encodeURIComponent(liffEditPath)}`
    : `${base}${webPath}`;
  // Absolute brand URLs (LINE flex images must be https). Only when baseUrl set.
  // Pose reacts to the result like a sticker — celebrate / alert / confused.
  const mascotUrl = base ? `${base}${mascotPath(poseForState(needsReview, lowConf))}` : null;

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
        { type: "text", text: ocrFailed ? "ยอด (อ่านไม่ได้)" : "ยอดที่อ่านได้", size: "xs", color: ocrFailed ? COLOR.bad : COLOR.sub },
        {
          type: "text",
          text: ocrFailed ? "? — กรอกเอง" : fmtTHB(total),
          size: "xxl",
          weight: "bold",
          color: ocrFailed ? COLOR.bad : confidenceColor(confidence?.total),
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
        ...(docTypeLabel ? [fieldRow("ประเภท", docTypeLabel)] : []),
        fieldRow("ร้านค้า", vendor ?? "—", confidence?.vendor),
        ...(vendorDocNumber ? [fieldRow("เลขที่เอกสาร", vendorDocNumber)] : []),
        fieldRow("วันที่บิล", fmtDate(docDate), confidence?.doc_date),
        ...(recordedDate ? [fieldRow("วันที่บันทึก", fmtDate(recordedDate))] : []),
        fieldRow("หมวด", categoryName ?? "ยังไม่จัดหมวด", confidence?.category),
        ...(branchName ? [fieldRow("สาขา", branchName)] : []),
        ...(payment ? [fieldRow("ชำระโดย", payment, confidence?.payment_method)] : []),
        ...(discount != null && discount > 0
          ? [fieldRow("ส่วนลด", `−${fmtTHB(discount)}`)]
          : []),
        ...(vat != null && vat > 0 ? [fieldRow("VAT", fmtTHB(vat))] : []),
        ...(vendorAddress ? [fieldRow("ที่อยู่", clip(vendorAddress))] : []),
        ...(note ? [fieldRow("รายละเอียด", clip(note))] : []),
      ],
    },
    // รายการสินค้า (line items) — own block; only when the receipt had any.
    ...(items && items.length > 0 ? [itemsBlock(items)] : []),
  ];

  // Recheck / low-confidence / OCR-failure banner.
  if (ocrFailed) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      margin: "lg",
      paddingAll: "10px",
      cornerRadius: "8px",
      backgroundColor: "#FEE2E2",
      contents: [
        {
          type: "text",
          text: "📷 อ่านภาพใบเสร็จไม่ได้ — รูปบันทึกแล้ว กด \"แก้ไข\" แล้วกรอกยอดเองนะครับ",
          size: "sm",
          weight: "bold",
          color: COLOR.bad,
          wrap: true,
        },
      ],
    });
  } else if (needsReview) {
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
  };
}

/**
 * Build the "บันทึกแล้ว — ยืนยัน/แก้ไข" flex MESSAGE (single receipt). Wraps one
 * bubble. See buildConfirmBubble for the per-field logic.
 */
export function buildLineConfirmCard(input: LedgerConfirmCardInput): LineFlexMessage {
  return {
    type: "flex",
    altText: `บันทึกแล้ว ${input.docCode} · ${fmtTHB(input.total)} — กดยืนยัน/แก้ไข`,
    contents: buildConfirmBubble(input),
  };
}

/**
 * Build a multi-receipt CAROUSEL — used when a staffer drops several photos in
 * one burst. A leading "summary" bubble shows the count + combined total (น้อง
 * ใบเสร็จ celebrating), followed by ONE bubble per receipt (each independently
 * editable via its own ยืนยัน/แก้ไข buttons). LINE caps a carousel at 12 bubbles,
 * so with ≥12 receipts we keep the summary + the first 11 (the rest are still
 * saved as drafts and visible on the web pane; the summary notes the overflow).
 *
 * A single-card input returns the same as buildLineConfirmCard (no summary
 * bubble) so the common 1-receipt path stays clean.
 *
 * `opts.skipFirstBubble` — the first receipt of a burst already got an inline
 * single-card reply (fast feedback), so the carousel omits its per-receipt
 * bubble to avoid showing it twice; the SUMMARY still counts/sums ALL receipts.
 */
export function buildLineConfirmCarousel(
  cards: LedgerConfirmCardInput[],
  opts: { skipFirstBubble?: boolean } = {},
): LineFlexMessage {
  if (cards.length <= 1) {
    return buildLineConfirmCard(
      cards[0] ?? ({ expenseId: "", companyId: "", docCode: "-", total: 0 } as LedgerConfirmCardInput),
    );
  }

  const baseUrl = (cards[0]?.baseUrl ?? "").replace(/\/+$/, "");
  // Summary stats span ALL receipts; per-receipt bubbles may skip the inline-replied first.
  const combined = cards.reduce((s, c) => s + (Number.isFinite(c.total) ? c.total : 0), 0);
  const flagged = cards.filter((c) => c.needsReview).length;
  const bubbleCards = opts.skipFirstBubble ? cards.slice(1) : cards;
  const MAX = 12; // LINE carousel cap (incl. summary bubble)
  const shown = bubbleCards.slice(0, MAX - 1);
  const overflow = bubbleCards.length - shown.length;

  const summaryMascot = baseUrl ? `${baseUrl}${mascotPath("money")}` : null;
  const summaryBubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "horizontal",
      paddingAll: "16px",
      spacing: "md",
      alignItems: "center",
      backgroundColor: "#EFF4FF",
      contents: [
        ...(summaryMascot
          ? ([{ type: "image", url: summaryMascot, size: "sm", aspectMode: "fit", aspectRatio: "1:1", flex: 0 } as FlexImage] as FlexComponent[])
          : []),
        {
          type: "box",
          layout: "vertical",
          flex: 1,
          spacing: "none",
          contents: [
            { type: "text", text: `บันทึกให้ ${cards.length} ใบ`, size: "md", weight: "bold", color: COLOR.ink, wrap: true },
            { type: "text", text: "ปัดดูแต่ละใบ แล้วกดแก้ไขได้เลย →", size: "xs", color: COLOR.sub, margin: "xs" },
          ],
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: [
        { type: "text", text: "ยอดรวมทั้งหมด", size: "xs", color: COLOR.sub },
        { type: "text", text: fmtTHB(combined), size: "xxl", weight: "bold", color: COLOR.ink },
        { type: "separator", margin: "lg", color: COLOR.line },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            fieldRow("จำนวนใบเสร็จ", `${cards.length} ใบ`),
            ...(flagged > 0 ? [fieldRow("ต้องตรวจ", `${flagged} ใบ`)] : []),
            ...(overflow > 0 ? [fieldRow("เกินที่แสดง", `อีก ${overflow} ใบ (ดูบนเว็บ)`)] : []),
          ],
        },
        ...(flagged > 0
          ? ([{
              type: "box",
              layout: "vertical",
              margin: "lg",
              paddingAll: "10px",
              cornerRadius: "8px",
              backgroundColor: COLOR.warnBg,
              contents: [{ type: "text", text: `⚠️ มี ${flagged} ใบที่ควรตรวจเลขก่อนยืนยัน`, size: "sm", weight: "bold", color: COLOR.warn, wrap: true }],
            }] as FlexComponent[])
          : []),
      ],
    },
  };

  return {
    type: "flex",
    altText: `บันทึกให้ ${cards.length} ใบ · รวม ${fmtTHB(combined)} — ปัดดูแล้วกดแก้ไขได้`,
    contents: {
      type: "carousel",
      contents: [summaryBubble, ...shown.map(buildConfirmBubble)],
    },
  };
}

/** One "emoji · how-to" line in the welcome card. */
function howtoLine(emoji: string, text: string): FlexBox {
  return {
    type: "box",
    layout: "baseline",
    spacing: "md",
    contents: [
      { type: "text", text: emoji, size: "sm", flex: 0 },
      { type: "text", text, size: "sm", color: COLOR.ink, flex: 8, wrap: true },
    ],
  };
}

/**
 * Build the WELCOME flex card the bot replies with when it's added to a LINE
 * group (event `join`) or followed in a 1:1 chat (event `follow`). Bainy-style:
 * น้องใบเสร็จ greets the team, shows the 3 ways to use it (photo / "จด" text /
 * ask), reassures that nothing auto-posts, and offers two working buttons —
 * "วิธีใช้" (sends /help) and "ผูกกลุ่มกับสาขา" (sends /setting, admin-gated).
 *
 * Pure builder (no imports) like the confirm card — the webhook drops it into
 * messages: [...]. Buttons use `message` actions so the staffer never leaves LINE
 * (they post /help · /setting, which lib/ledger/line-commands.ts answers).
 */
export function buildLedgerWelcomeCard(opts: { baseUrl?: string } = {}): LineFlexMessage {
  const base = (opts.baseUrl ?? "").replace(/\/+$/, "");
  const mascotUrl = base ? `${base}${mascotPath("welcome")}` : null;

  const bubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
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
                size: "sm",
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
              text: "สวัสดีครับ ผมน้องใบเสร็จ 🧾",
              size: "md",
              weight: "bold",
              color: COLOR.ink,
              wrap: true,
            },
            {
              type: "text",
              text: "ผู้ช่วยบันทึกค่าใช้จ่ายของกลุ่มนี้",
              size: "xs",
              color: COLOR.sub,
              margin: "xs",
              wrap: true,
            },
          ],
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        { type: "text", text: "ใช้งานง่าย ๆ 3 วิธี", size: "xs", color: COLOR.sub, weight: "bold" },
        howtoLine("📷", "ส่งรูปใบเสร็จ/บิล — ผมอ่านยอด ร้าน วันที่ ให้อัตโนมัติ"),
        howtoLine("✏️", 'พิมพ์ "จด ค่ากาแฟ 45" — บันทึกเร็ว ไม่ต้องมีรูป'),
        howtoLine("💬", 'ถาม "สรุปเดือนนี้" — ดูยอดรวมในกลุ่มได้เลย'),
        { type: "separator", margin: "lg", color: COLOR.line },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          paddingAll: "10px",
          cornerRadius: "8px",
          backgroundColor: "#F4F4F5",
          contents: [
            {
              type: "text",
              text: "ทุกใบที่บันทึกเป็น “ฉบับร่าง” — ฝ่ายบัญชีตรวจและยืนยันบนเว็บอีกที ไม่โพสต์อัตโนมัติ ✅",
              size: "xs",
              color: COLOR.sub,
              wrap: true,
            },
          ],
        },
        {
          type: "text",
          text: "แอดมิน: พิมพ์ /setting เพื่อผูกกลุ่มนี้กับสาขา",
          size: "xs",
          color: COLOR.brand,
          margin: "md",
          wrap: true,
        },
      ],
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
          action: { type: "message", label: "📖 วิธีใช้ทั้งหมด", text: "/help" },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "🔗 ผูกกลุ่มกับสาขา", text: "/setting" },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "📁 ไฟล์ใน Google Drive", text: "/drive" },
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: "สวัสดีครับ ผมน้องใบเสร็จ — ส่งรูปใบเสร็จ หรือพิมพ์ “จด ค่ากาแฟ 45” ได้เลย",
    contents: bubble,
  };
}

export default buildLineConfirmCard;

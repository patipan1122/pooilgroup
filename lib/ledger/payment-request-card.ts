// LedgerLine — the "ขอโอนเงิน" flex card pushed to the executive (slip-intake) group.
//
// D8 (CEO) UPDATED 2026-06-09: LINE *does* support a clipboard action (Messaging API
// since Feb 2024) — so the account number / PromptPay id now has a real "📋 คัดลอก"
// button (one tap → on the clipboard) instead of the old long-press-to-select hint.
// The bank is still a NAME (no logo image: licensing + slop risk per the workshop).
// CEO chose copy + QR only (NOT bank-app deep-links — undocumented & break on app
// updates). The exec copies the number, transfers from their bank app, and drops the
// slip back in the same group → matchSlipToRequest closes every bill.
import type {
  FlexBubble,
  FlexComponent,
  FlexImage,
  LineFlexMessage,
} from "@/components/ledger/LineConfirmCard";

const COLOR = {
  ink: "#18181B",
  sub: "#71717A",
  brand: "#2563EB",
  good: "#16A34A",
  goodBg: "#F0FDF4",
  goodChipBg: "#DCFCE7",
  goodInk: "#166534",
  warn: "#D97706",
  bad: "#DC2626",
  badBg: "#FEF2F2",
  line: "#E4E4E7",
  amtBg: "#EFF4FF",
} as const;

/** Common Thai bank codes → name (shown as text; no logo image). */
const BANK_NAMES: Record<string, string> = {
  "002": "กรุงเทพ (BBL)",
  "004": "กสิกรไทย (KBANK)",
  "006": "กรุงไทย (KTB)",
  "011": "ทหารไทยธนชาต (ttb)",
  "014": "ไทยพาณิชย์ (SCB)",
  "017": "ซิตี้แบงก์",
  "020": "สแตนดาร์ดชาร์เตอร์ด",
  "022": "ซีไอเอ็มบี ไทย (CIMB)",
  "024": "ยูโอบี (UOB)",
  "025": "กรุงศรีอยุธยา (BAY)",
  "030": "ออมสิน (GSB)",
  "033": "อาคารสงเคราะห์ (GHB)",
  "034": "ธ.ก.ส. (BAAC)",
  "066": "อิสลามแห่งประเทศไทย",
  "067": "ทิสโก้ (TISCO)",
  "069": "เกียรตินาคินภัทร (KKP)",
  "070": "ไอซีบีซี (ICBC)",
  "071": "ไทยเครดิต",
  "073": "แลนด์ แอนด์ เฮ้าส์ (LH)",
};

export function bankName(code: string | null | undefined): string | null {
  if (!code) return null;
  return BANK_NAMES[code] ?? `ธนาคาร (รหัส ${code})`;
}

function fmtTHB(n: number): string {
  return `฿${(Number.isFinite(n) ? n : 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface PaymentRequestCardInput {
  vendor: string | null;
  billsGross: number;
  whtTotal: number;
  expectedTransfer: number;
  payee: {
    acctName?: string | null;
    bankCode?: string | null;
    acctNo?: string | null;
    promptpay?: string | null;
    /** Uploaded QR image (R2) — shown in the card so the exec scans to pay. */
    qrImageUrl?: string | null;
  };
  /** the bills in this request (docCode + amount) — shown compact. */
  bills: { docCode: string; amount: number }[];
  /** LIFF deep-link to the request detail page (ดูรายละเอียด/จ่าย). */
  detailUrl?: string | null;
  /**
   * เว็บลิงก์ตรงไปหน้า "แนบสลิป · จ่าย" ของคำขอนี้ (CEO 2026-07-26) — อยู่ในโปรแกรม
   * (AdminShell · เมนูครบ · กดไปหน้าอื่นได้) พร้อมปุ่มอัปสลิปในหน้าเดียว. เป็นปุ่มหลัก
   * ของการ์ดตอนไม่ได้ตั้ง LIFF (detailUrl = null). พลิก URL ธรรมดา ไม่ใช่ deep-link LIFF.
   */
  attachUrl?: string | null;
  /**
   * Direct URL to the attached receipt/quotation image of the (first) bill — the
   * "ดูรูปที่แนบ" button. A plain R2 https URL (NOT a LIFF link) so it just opens in
   * the in-app browser — no deep-link concatenation. The exec eyeballs what they're
   * paying for before transferring; the slip comes back naturally (no send-slip button).
   */
  receiptUrl?: string | null;
}

const MAX_BILLS_ON_CARD = 4;

/** Build the request card. Pushed to the executive group on "ขอโอนเงิน". */
export function buildPaymentRequestCard(input: PaymentRequestCardInput): LineFlexMessage {
  const { vendor, billsGross, whtTotal, expectedTransfer, payee, bills, detailUrl, attachUrl, receiptUrl } = input;
  const shown = bills.slice(0, MAX_BILLS_ON_CARD);
  const overflow = bills.length - shown.length;

  // Footer actions (CEO 2026-06-09): NO "ส่งสลิป" button — the slip comes back in the
  // chat naturally after transfer. Instead give the exec two view buttons: see the
  // attached receipt image (what am I paying for?) + open the full detail page (pay).
  const footerButtons: FlexComponent[] = [];
  if (receiptUrl) {
    footerButtons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "uri", label: "🧾 ดูรูปที่แนบ", uri: receiptUrl },
    });
  }
  if (detailUrl) {
    footerButtons.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: COLOR.brand,
      action: { type: "uri", label: "📄 ดูรายละเอียด · จ่าย", uri: detailUrl },
    });
  }
  // ปุ่มหลัก (CEO 2026-07-26): เข้าโปรแกรมหน้า "แนบสลิป · จ่าย" ของคำขอนี้ — โอนแล้วอัปสลิป
  // ในหน้าเดียว ระบบปิดบิล+ออก PV ให้ · เมนูโปรแกรมครบ กดไปหน้าอื่นได้ (ไม่ใช่หน้าตัน).
  if (attachUrl) {
    footerButtons.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: COLOR.brand,
      action: { type: "uri", label: "📎 แนบสลิป · จ่าย", uri: attachUrl },
    });
  }

  const payeeLines: FlexComponent[] = [];
  if (payee.acctName) {
    payeeLines.push({ type: "text", text: payee.acctName, size: "sm", weight: "bold", color: COLOR.ink, wrap: true });
  }
  const bank = bankName(payee.bankCode);
  if (bank) {
    payeeLines.push({ type: "text", text: bank, size: "xs", color: COLOR.sub, wrap: true });
  }
  if (payee.acctNo) {
    // Number on its OWN line (label above) + a real "คัดลอก" button (LINE clipboard
    // action) so the exec copies clean digits in one tap, then pastes in their bank app.
    payeeLines.push({ type: "text", text: "เลขบัญชี", size: "xs", color: COLOR.sub, margin: "xs" });
    payeeLines.push({ type: "text", text: payee.acctNo, size: "lg", weight: "bold", color: COLOR.brand, wrap: true });
    payeeLines.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "clipboard", label: "📋 คัดลอกเลขบัญชี", clipboardText: payee.acctNo },
    });
  }
  if (payee.promptpay) {
    payeeLines.push({ type: "text", text: "พร้อมเพย์", size: "xs", color: COLOR.sub, margin: "xs" });
    payeeLines.push({ type: "text", text: payee.promptpay, size: "md", weight: "bold", color: COLOR.brand, wrap: true });
    payeeLines.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "clipboard", label: "📋 คัดลอกพร้อมเพย์", clipboardText: payee.promptpay },
    });
  }
  if (payeeLines.length === 0) {
    payeeLines.push({ type: "text", text: "— ยังไม่ระบุบัญชีผู้รับ —", size: "xs", color: COLOR.sub, wrap: true });
  }

  const billLines: FlexComponent[] = shown.map((b) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: b.docCode, size: "xs", color: COLOR.sub, flex: 3, wrap: true },
      { type: "text", text: fmtTHB(b.amount), size: "xs", color: COLOR.ink, align: "end", flex: 2 },
    ],
  }));
  if (overflow > 0) {
    billLines.push({ type: "text", text: `และอีก ${overflow} ใบ`, size: "xs", color: COLOR.sub });
  }

  const bubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: COLOR.amtBg,
      spacing: "none",
      contents: [
        { type: "text", text: "💸 คำขอโอนเงิน", size: "sm", weight: "bold", color: COLOR.brand },
        { type: "text", text: vendor || "ไม่ระบุผู้ขาย", size: "md", weight: "bold", color: COLOR.ink, wrap: true, margin: "xs" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        // Amount to transfer (the NET — what the executive actually pays).
        { type: "text", text: "ยอดที่ต้องโอน", size: "xs", color: COLOR.sub },
        { type: "text", text: fmtTHB(expectedTransfer), size: "xxl", weight: "bold", color: COLOR.ink },
        ...(whtTotal > 0
          ? ([
              {
                type: "text",
                text: `(ยอดบิลรวม ${fmtTHB(billsGross)} − หัก ณ ที่จ่าย ${fmtTHB(whtTotal)})`,
                size: "xs",
                color: COLOR.warn,
                wrap: true,
              },
            ] as FlexComponent[])
          : []),
        // QR image (uploaded) — exec scans straight from the card to pay.
        ...(payee.qrImageUrl
          ? ([
              { type: "separator", margin: "md", color: COLOR.line },
              { type: "text", text: "สแกน QR เพื่อจ่าย", size: "xs", color: COLOR.sub, margin: "sm" },
              {
                type: "image",
                url: payee.qrImageUrl,
                size: "full",
                aspectRatio: "1:1",
                aspectMode: "fit",
                margin: "sm",
                backgroundColor: "#ffffff",
              } as FlexImage,
            ] as FlexComponent[])
          : []),
        { type: "separator", margin: "md", color: COLOR.line },
        // Payee (selectable account no.).
        { type: "text", text: "โอนเข้าบัญชี", size: "xs", color: COLOR.sub, margin: "sm" },
        ...payeeLines,
        { type: "separator", margin: "md", color: COLOR.line },
        // Bills.
        { type: "text", text: `รายการบิล (${bills.length} ใบ)`, size: "xs", color: COLOR.sub, margin: "sm" },
        ...billLines,
        { type: "separator", margin: "md", color: COLOR.line },
        {
          type: "text",
          text: "โอนแล้ว → ส่งสลิปกลับกลุ่มนี้ ระบบจับคู่+ปิดบิลให้อัตโนมัติ ✅",
          size: "xs",
          color: COLOR.good,
          wrap: true,
          margin: "sm",
        },
      ],
    },
    // Footer: 🧾 ดูรูปที่แนบ (receipt image, direct) + 📄 ดูรายละเอียด · จ่าย (LIFF detail
    // page: full bills + receipt images + payee copy + QR).
    ...(footerButtons.length > 0
      ? ({
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            spacing: "sm",
            contents: footerButtons,
          },
        } as Pick<FlexBubble, "footer">)
      : {}),
  };

  return {
    type: "flex",
    altText: `คำขอโอนเงิน ${vendor || ""} ${fmtTHB(expectedTransfer)}`.trim(),
    contents: bubble,
  };
}

export interface SlipMismatchCardInput {
  /** over = โอนเกิน · under = โอนขาด · payee = บัญชี/ชื่อผู้รับไม่ตรง. */
  kind: "over" | "under" | "payee";
  vendor: string | null;
  expected: number;
  slipAmount: number;
  /** slip − expected (signed). */
  diff: number;
  payeeName: string | null;
  payeeAcct: string | null;
  slipRecipientName: string | null;
  slipRecipientAcct: string | null;
  /** link to the slip image (ปุ่ม "ดูสลิป"). */
  slipUrl?: string | null;
}

/**
 * Warning card replied INTO the group when a slip hit a request but didn't verify
 * (CEO 2026-06-07): amount off → "โอนเกิน/โอนขาด X ฿", payee off → "บัญชีผู้รับไม่ตรง".
 * The slip is kept as a floating payment; the bill is NOT closed. Sent via reply
 * (not push) so it costs nothing.
 */
export function buildSlipMismatchCard(input: SlipMismatchCardInput): LineFlexMessage {
  const { kind, vendor, expected, slipAmount, diff, payeeName, payeeAcct, slipRecipientName, slipRecipientAcct, slipUrl } = input;
  const isPayee = kind === "payee";
  const title = isPayee ? "⚠️ บัญชีผู้รับไม่ตรง" : "⚠️ ยอดโอนไม่ตรง";
  const absDiff = Math.abs(diff);

  const rows: FlexComponent[] = [];
  const kv = (label: string, value: string, valueColor: string = COLOR.ink): FlexComponent => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "xs", color: COLOR.sub, flex: 4, wrap: true },
      { type: "text", text: value, size: "xs", color: valueColor, align: "end", flex: 6, wrap: true },
    ],
  });

  if (isPayee) {
    rows.push(kv("สลิปโอนเข้า", slipRecipientName || slipRecipientAcct || "— อ่านไม่ได้ —", COLOR.bad));
    rows.push(kv("คำขอให้โอนเข้า", payeeName || payeeAcct || "—", COLOR.ink));
    rows.push(kv("ยอดที่ต้องโอน", fmtTHB(expected)));
  } else {
    rows.push(kv("ยอดในสลิป", fmtTHB(slipAmount), COLOR.ink));
    rows.push(kv("ยอดที่ต้องโอน", fmtTHB(expected), COLOR.ink));
  }

  const badge: FlexComponent = isPayee
    ? {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.badBg,
        cornerRadius: "md",
        paddingAll: "10px",
        margin: "md",
        contents: [
          { type: "text", text: "โอนเข้าบัญชีไม่ตรงกับที่ขอ", size: "sm", weight: "bold", color: COLOR.bad, align: "center", wrap: true },
        ],
      }
    : {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.badBg,
        cornerRadius: "md",
        paddingAll: "10px",
        margin: "md",
        contents: [
          {
            type: "text",
            text: `${kind === "over" ? "โอนเกิน" : "โอนขาด"} ${fmtTHB(absDiff)}`,
            size: "lg",
            weight: "bold",
            color: COLOR.bad,
            align: "center",
          },
        ],
      };

  const bubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: COLOR.badBg,
      contents: [
        { type: "text", text: title, size: "sm", weight: "bold", color: COLOR.bad },
        { type: "text", text: vendor || "ไม่ระบุผู้ขาย", size: "md", weight: "bold", color: COLOR.ink, wrap: true, margin: "xs" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        ...rows,
        badge,
        { type: "separator", margin: "md", color: COLOR.line },
        {
          type: "text",
          text: "เก็บสลิปไว้แล้ว · ยังไม่ปิดบิล — บัญชีจะตรวจ/กระทบยอดอีกที",
          size: "xs",
          color: COLOR.sub,
          wrap: true,
          margin: "sm",
        },
      ],
    },
    ...(slipUrl
      ? ({
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            contents: [
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "uri", label: "ดูสลิป", uri: slipUrl },
              },
            ],
          },
        } as Pick<FlexBubble, "footer">)
      : {}),
  };

  return {
    type: "flex",
    altText: isPayee
      ? `บัญชีผู้รับไม่ตรง ${vendor || ""}`.trim()
      : `${kind === "over" ? "โอนเกิน" : "โอนขาด"} ${fmtTHB(absDiff)} ${vendor || ""}`.trim(),
    contents: bubble,
  };
}

export interface PaymentPaidCardInput {
  vendor: string | null;
  billCount: number;
  amount: number;
  /** the matched slip image (R2) — shown inline + "ดูสลิป / ดึงสลิป". */
  slipUrl?: string | null;
  /** LIFF deep-link to the (now closed) request detail. */
  detailUrl?: string | null;
}

/**
 * Green "โอนแล้ว · ปิดบิลแล้ว" card replied INTO the group when a slip matches a request
 * (CEO 2026-06-09: "ถ้ามียอดแมชแล้วก็ให้โชว์อีกแบบ" — the design's paid state). A match
 * means the slip verified EXACT to the baht, so it's always "ยอดตรง" here; over/under and
 * wrong-account go to buildSlipMismatchCard instead. Shows the slip inline + a button to
 * open/forward it (D10: the requester forwards the slip to the supplier). Replied (free).
 */
export function buildPaymentPaidCard(input: PaymentPaidCardInput): LineFlexMessage {
  const { vendor, billCount, amount, slipUrl, detailUrl } = input;

  const footerButtons: FlexComponent[] = [];
  if (slipUrl) {
    footerButtons.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: COLOR.good,
      action: { type: "uri", label: "📎 ดูสลิป / ดึงสลิป", uri: slipUrl },
    });
  }
  if (detailUrl) {
    footerButtons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "uri", label: "ดูรายละเอียด", uri: detailUrl },
    });
  }

  const bubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: COLOR.goodBg,
      contents: [
        { type: "text", text: "✅ โอนแล้ว · ปิดบิลแล้ว", size: "sm", weight: "bold", color: COLOR.good },
        { type: "text", text: vendor || "ไม่ระบุผู้ขาย", size: "md", weight: "bold", color: COLOR.ink, wrap: true, margin: "xs" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        { type: "text", text: "ยอดที่โอน", size: "xs", color: COLOR.sub },
        { type: "text", text: fmtTHB(amount), size: "xxl", weight: "bold", color: COLOR.ink },
        // ยอดตรง — a match is exact-to-the-baht (mismatches never reach this card).
        {
          type: "box",
          layout: "vertical",
          backgroundColor: COLOR.goodChipBg,
          cornerRadius: "md",
          paddingAll: "8px",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: `✓ ยอดตรง · ปิดบิล ${billCount} ใบ`,
              size: "sm",
              weight: "bold",
              color: COLOR.goodInk,
              align: "center",
            },
          ],
        },
        // The matched slip inline (the design's "📎 สลิปที่แนบ").
        ...(slipUrl
          ? ([
              { type: "separator", margin: "md", color: COLOR.line },
              { type: "text", text: "📎 สลิปที่แนบ (ระบบสแกนแล้ว)", size: "xs", color: COLOR.sub, margin: "sm" },
              {
                type: "image",
                url: slipUrl,
                size: "full",
                aspectRatio: "9:13",
                aspectMode: "fit",
                margin: "sm",
                backgroundColor: "#ffffff",
              } as FlexImage,
            ] as FlexComponent[])
          : []),
        { type: "separator", margin: "md", color: COLOR.line },
        {
          type: "text",
          text: "สลิปอยู่ในกลุ่มนี้แล้ว — ฝ่ายที่ขอโอนเอาไปส่งต่อผู้ขายได้เลย",
          size: "xs",
          color: COLOR.sub,
          wrap: true,
          margin: "sm",
        },
      ],
    },
    ...(footerButtons.length > 0
      ? ({
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            spacing: "sm",
            contents: footerButtons,
          },
        } as Pick<FlexBubble, "footer">)
      : {}),
  };

  return {
    type: "flex",
    altText: `โอนแล้ว ${vendor || ""} ${fmtTHB(amount)} · ปิดบิล ${billCount} ใบ ยอดตรง`.trim(),
    contents: bubble,
  };
}

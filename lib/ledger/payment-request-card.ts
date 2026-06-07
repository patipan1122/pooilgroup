// LedgerLine — the "ขอโอนเงิน" flex card pushed to the executive (slip-intake) group.
//
// D8 (CEO): LINE Flex has NO clipboard action — so the account number is a big
// SELECTABLE text line (long-press → copy in LINE) and the bank is shown as a NAME
// (no logo image: licensing + slop risk per the workshop). The executive copies the
// number / PromptPay id, transfers from their bank app, and drops the slip back in
// the same group → matchSlipToRequest closes every bill.
import type {
  FlexBubble,
  FlexComponent,
  LineFlexMessage,
} from "@/components/ledger/LineConfirmCard";

const COLOR = {
  ink: "#18181B",
  sub: "#71717A",
  brand: "#2563EB",
  good: "#16A34A",
  warn: "#D97706",
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
  };
  /** the bills in this request (docCode + amount) — shown compact. */
  bills: { docCode: string; amount: number }[];
  /** LIFF deep-link to the request detail page (ดูรายละเอียด/จ่าย). */
  detailUrl?: string | null;
}

const MAX_BILLS_ON_CARD = 4;

/** Build the request card. Pushed to the executive group on "ขอโอนเงิน". */
export function buildPaymentRequestCard(input: PaymentRequestCardInput): LineFlexMessage {
  const { vendor, billsGross, whtTotal, expectedTransfer, payee, bills, detailUrl } = input;
  const shown = bills.slice(0, MAX_BILLS_ON_CARD);
  const overflow = bills.length - shown.length;

  const payeeLines: FlexComponent[] = [];
  if (payee.acctName) {
    payeeLines.push({ type: "text", text: payee.acctName, size: "sm", weight: "bold", color: COLOR.ink, wrap: true });
  }
  const bank = bankName(payee.bankCode);
  if (bank) {
    payeeLines.push({ type: "text", text: bank, size: "xs", color: COLOR.sub, wrap: true });
  }
  if (payee.acctNo) {
    // Audit P1 — number on its OWN line (label above) so long-press selects clean
    // digits, not "เลขบัญชี 123…". Selectable = copy (LINE flex has no copy button).
    payeeLines.push({ type: "text", text: "เลขบัญชี", size: "xs", color: COLOR.sub, margin: "xs" });
    payeeLines.push({ type: "text", text: payee.acctNo, size: "lg", weight: "bold", color: COLOR.brand, wrap: true });
  }
  if (payee.promptpay) {
    payeeLines.push({ type: "text", text: "พร้อมเพย์", size: "xs", color: COLOR.sub, margin: "xs" });
    payeeLines.push({ type: "text", text: payee.promptpay, size: "md", weight: "bold", color: COLOR.brand, wrap: true });
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
    // "ดูรายละเอียด / จ่าย" — opens the LIFF detail page (full bills + payee copy + QR).
    ...(detailUrl
      ? ({
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                color: COLOR.brand,
                action: { type: "uri", label: "ดูรายละเอียด / จ่าย", uri: detailUrl },
              },
            ],
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

/** Group notice after a slip closes a request (D10 — requester forwards the slip). */
export function paymentRequestPaidText(opts: {
  vendor: string | null;
  billCount: number;
  amount: number;
}): string {
  const v = opts.vendor ? ` ${opts.vendor}` : "";
  return (
    `✅ รับสลิปแล้ว · ปิดบิล ${opts.billCount} ใบ${v} ยอด ${fmtTHB(opts.amount)}\n` +
    `สลิปแนบในกลุ่มนี้แล้ว — ฝ่ายที่ขอโอนเอาไปส่งต่อผู้ขายได้เลย`
  );
}

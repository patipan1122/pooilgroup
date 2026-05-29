// Lightweight, free keyword classifier for incoming customer messages.
// Maps a message to one of the ChairOps support topics + escalation flags.
// Deterministic — no AI cost. Priority: money_lost (paid, dead machine) first.
//
// Complaint guard (audit P0-4): a message with negative/complaint words is
// NEVER routed to "buy" (an angry "เครื่องราคาเท่าไหร่ ทำไมห่วย" must not get a
// cheerful lead reply). Complaints route to feedback + needsHuman.

export type InboxTopic =
  | "money_lost"
  | "scan_fail"
  | "strong"
  | "buy"
  | "feedback"
  | "other";

export interface Classification {
  topic: InboxTopic;
  isUrgent: boolean;
  isLead: boolean;
  needsHuman: boolean;
  isComplaint: boolean;
}

const MONEY_LOST = [
  "หยอดเงิน", "หยอดแล้ว", "หยอดไป", "เหรียญ", "เงินหาย", "เงินหด",
  "กินเงิน", "กินตัง", "เสียเงิน", "จ่ายเงินแล้ว", "จ่ายแล้ว", "โอนแล้ว",
  "เครื่องไม่ทำงาน", "เครื่องไม่ทํางาน", "เครื่องไม่ติด", "เครื่องดับ",
  "เครื่องค้าง", "ไม่คืนเงิน", "เงินไม่คืน", "จ่ายไปแล้ว", "เครื่องเสีย",
];
const SCAN_FAIL = [
  "สแกนไม่ได้", "สแกนแล้วใช้ไม่ได้", "สแกนไม่ติด", "สแกนไม่ผ่าน", "สแกน",
  "แสกน", "scan", "qr", "คิวอาร์", "จ่ายไม่ได้", "จ่ายไม่ผ่าน",
  "พร้อมเพย์ไม่ได้", "โอนไม่ได้", "สแกนจ่าย",
];
const STRONG = ["แรงเกิน", "แรงไป", "นวดแรง", "แรงมาก", "เจ็บ", "ปรับความแรง", "เบาลง", "นวดเบา"];
const BUY = [
  "สนใจซื้อ", "อยากซื้อ", "ซื้อเครื่อง", "ราคาเครื่อง", "ลงทุน", "ร่วมลงทุน",
  "เป็นตัวแทน", "ตัวแทนจำหน่าย", "อยากได้เครื่อง", "วางเครื่อง", "แฟรนไชส์",
  "เปิดร้าน", "อยากขาย",
];
const FEEDBACK = [
  "แนะนำ", "ติชม", "ชมเชย", "บริการดี", "ประทับใจ", "ความเห็น", "feedback",
  "ดีมาก", "ขอบคุณ",
];
// Negative / complaint signals — block "buy", force feedback + human follow-up.
const NEGATIVE = [
  "ห่วย", "แย่", "แย่มาก", "โกง", "ขี้โกง", "หลอก", "ไม่พอใจ", "เฮงซวย",
  "โมโห", "หงุดหงิด", "ผิดหวัง", "บริการแย่", "ร้องเรียน", "ไม่ดี",
  "เสียความรู้สึก", "งี่เง่า", "โคตร", "ด่า",
];

const has = (text: string, arr: string[]) =>
  arr.some((k) => text.includes(k.toLowerCase()));

export function classify(textRaw: string): Classification {
  const text = (textRaw ?? "").toLowerCase();
  const isComplaint = has(text, NEGATIVE);

  let topic: InboxTopic = "other";
  if (has(text, MONEY_LOST)) topic = "money_lost";
  else if (has(text, SCAN_FAIL)) topic = "scan_fail";
  else if (has(text, STRONG)) topic = "strong";
  else if (has(text, BUY) && !isComplaint) topic = "buy"; // complaint never = buy
  else if (has(text, FEEDBACK) || isComplaint) topic = "feedback";

  const isUrgent = topic === "money_lost" || topic === "scan_fail";
  const isLead = topic === "buy";
  // Sensitive topics + any complaint need a human to follow up.
  const needsHuman = isUrgent || (topic === "feedback" && isComplaint);

  return { topic, isUrgent, isLead, needsHuman, isComplaint };
}

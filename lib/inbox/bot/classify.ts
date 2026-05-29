// Lightweight, free keyword classifier for incoming customer messages.
// Maps a message to one of the ChairOps support topics + escalation flags.
// Deterministic — no AI cost. Priority order matters: money_lost (paid, dead
// machine) is the most urgent, checked first.

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
}

const KEYWORDS: { topic: InboxTopic; kw: string[] }[] = [
  {
    topic: "money_lost",
    kw: [
      "หยอดเงิน", "หยอดแล้ว", "หยอดไป", "เหรียญ", "เงินหาย", "เงินหด",
      "กินเงิน", "กินตัง", "เสียเงิน", "จ่ายเงินแล้ว", "จ่ายแล้ว", "โอนแล้ว",
      "เครื่องไม่ทำงาน", "เครื่องไม่ทํางาน", "เครื่องไม่ติด", "เครื่องดับ",
      "เครื่องค้าง", "ไม่คืนเงิน", "เงินไม่คืน", "จ่ายไปแล้ว", "เครื่องเสีย",
    ],
  },
  {
    topic: "scan_fail",
    kw: [
      "สแกนไม่ได้", "สแกนแล้วใช้ไม่ได้", "สแกนไม่ติด", "สแกนไม่ผ่าน", "สแกน",
      "แสกน", "scan", "qr", "คิวอาร์", "จ่ายไม่ได้", "จ่ายไม่ผ่าน",
      "พร้อมเพย์ไม่ได้", "โอนไม่ได้", "สแกนจ่าย",
    ],
  },
  {
    topic: "strong",
    kw: ["แรงเกิน", "แรงไป", "นวดแรง", "แรงมาก", "เจ็บ", "ปรับความแรง", "เบาลง", "นวดเบา"],
  },
  {
    topic: "buy",
    kw: [
      "สนใจซื้อ", "อยากซื้อ", "ซื้อเครื่อง", "ราคาเครื่อง", "ลงทุน", "ร่วมลงทุน",
      "เป็นตัวแทน", "ตัวแทนจำหน่าย", "อยากได้เครื่อง", "วางเครื่อง", "แฟรนไชส์",
      "เปิดร้าน", "อยากขาย",
    ],
  },
  {
    topic: "feedback",
    kw: [
      "แนะนำ", "ติชม", "ชมเชย", "บริการดี", "ประทับใจ", "ความเห็น", "feedback",
      "ร้องเรียน", "ไม่พอใจ", "บริการแย่", "แย่มาก", "ดีมาก", "ขอบคุณ",
    ],
  },
];

export function classify(textRaw: string): Classification {
  const text = (textRaw ?? "").toLowerCase();
  let topic: InboxTopic = "other";
  for (const rule of KEYWORDS) {
    if (rule.kw.some((k) => text.includes(k.toLowerCase()))) {
      topic = rule.topic;
      break;
    }
  }

  return {
    topic,
    isUrgent: topic === "money_lost" || topic === "scan_fail",
    isLead: topic === "buy",
    // Sensitive topics always need a human to follow up (call back / activate machine).
    needsHuman: topic === "money_lost" || topic === "scan_fail",
  };
}

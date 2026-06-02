// Canned chairops topic reply templates — shared source of truth.
//
// Both the live engine (lib/inbox/bot/engine.ts) and the trainer's preview
// (lib/inbox/bot/trainer-actions.ts) read from here so the preview never
// drifts out of sync with what real customers receive (audit BOT-003).

import type { InboxTopic } from "./classify";
import type { BotSettings, ReplyTemplateKey } from "./settings";

// Built-in default reply text per flow — the SOURCE OF TRUTH for wording the
// CEO hasn't overridden in /inbox/bot.  Rules baked in per CEO 2026-06-02:
//   • NEVER say "หากเร่งด่วน" (the bot isn't the one who decides what's urgent)
//   • NEVER promise "ติดต่อกลับ" — the team does not call customers back;
//     the customer calls IN instead
//   • try to HELP / gather info first, then offer the phone as a way to reach
//     the team — don't open by shoving the customer at the phone
// Use the literal "{phone}" placeholder; it's filled from settings at render.
export const DEFAULT_REPLY_TEMPLATES: Record<ReplyTemplateKey, string> = {
  money_lost:
    `ขออภัยมากๆ เลยนะคะ 🙏 เดี๋ยวทีมงานช่วยดูแลให้นะคะ\n` +
    `รบกวนแจ้งข้อมูลนิดนึงค่ะ:\n` +
    `• เครื่อง "กินเหรียญ" หรือ "กินแบงค์" คะ\n` +
    `• สาขา + จังหวัด\n` +
    `• เลขเครื่อง (มุมซ้ายบนของหน้าจอ เช่น G0310416)\n` +
    `ทีมงานจะกดเปิด/แก้ออนไลน์ให้ได้เลยค่ะ · หรือโทรหาทีมงานที่ {phone} ได้เลยค่ะ`,
  scan_fail:
    `ขออภัยค่ะ 🙏 เดี๋ยวช่วยเช็คให้นะคะ\n` +
    `รบกวนแจ้ง "สาขา + เลขเครื่อง" (มุมซ้ายบนของหน้าจอ เช่น G0310416) ค่ะ\n` +
    `ทีมงานจะช่วยแก้ออนไลน์ให้ได้เลย · หรือโทรหาทีมงานที่ {phone} ได้เลยค่ะ`,
  strong:
    `ขอโทษด้วยนะคะ 🙏 รบกวนเล่าให้ฟังนิดนึง จะได้แนะนำการปรับให้พอดีกับคุณค่ะ\n` +
    `1) นวดแรงตรงไหนคะ (แขน / ขา / หลัง / ทั่ว ๆ)\n` +
    `2) ระดับความเจ็บเต็ม 10 ประมาณกี่คะแนน\n` +
    `เครื่องปรับความแรงได้ระดับ 1–6 (เริ่มต้นที่ระดับ 3) · ลองกดลดระดับที่แผงควบคุมข้างที่นั่งดูนะคะ`,
  buy:
    `ขอบคุณที่สนใจค่ะ 😊 ขอข้อมูลสั้นๆ จะได้แนะนำให้ตรงความต้องการนะคะ\n` +
    `1) สนใจไว้ใช้ที่บ้าน หรือเปิดร้าน/หยอดเหรียญคะ\n` +
    `2) งบประมาณคร่าวๆ (เครื่องเดียว / หลายเครื่อง)\n` +
    `สอบถามรายละเอียดเพิ่มเติม โทรได้เลยที่ {phone} ค่ะ`,
  feedback: `ขอบคุณสำหรับคำติชมนะคะ 🙏 เรารับไว้ปรับปรุงและดูแลให้ดีขึ้นแน่นอนค่ะ`,
  feedback_complaint:
    `ขออภัยจริงๆ นะคะ 🙏 รบกวนเล่าเพิ่มได้ไหมคะว่าติดปัญหาเรื่องอะไร (สาขา/เลขเครื่องถ้ามี) เดี๋ยวทีมงานรีบดูแลให้ค่ะ`,
  non_text_ack:
    `ได้รับข้อความ/รูปแล้วนะคะ 🙏 เดี๋ยวทีมงานช่วยดูแลให้ค่ะ · สอบถามเพิ่มเติมโทรได้ที่ {phone} ค่ะ`,
};

// Replace the {phone} placeholder.  When no phone is configured, drop any
// "·"-separated clause that mentions it so we never render "โทรได้ที่  ค่ะ".
function fillPhone(text: string, phone: string | null): string {
  if (phone && phone.trim()) return text.split("{phone}").join(phone.trim());
  return text
    .split("\n")
    .map((line) =>
      line
        .split("·")
        .filter((seg) => !seg.includes("{phone}"))
        .join("·")
        .replace(/·\s*$/, "")
        .trimEnd(),
    )
    .join("\n");
}

// Resolve the effective reply for a key: CEO override (if any) else default,
// then fill the phone placeholder.
function resolveReply(key: ReplyTemplateKey, s: BotSettings): string {
  const raw = s.replyTemplates[key]?.trim() || DEFAULT_REPLY_TEMPLATES[key];
  return fillPhone(raw, s.contactPhone);
}

export function renderChairopsTemplate(
  topic: InboxTopic,
  s: BotSettings,
  isComplaint: boolean,
): string {
  switch (topic) {
    case "money_lost":
      return resolveReply("money_lost", s);
    case "scan_fail":
      return resolveReply("scan_fail", s);
    case "strong":
      return resolveReply("strong", s);
    case "buy":
      return resolveReply("buy", s);
    case "feedback":
      return resolveReply(isComplaint ? "feedback_complaint" : "feedback", s);
    default:
      return s.fallbackText;
  }
}

// Acknowledgement sent when a customer's message is non-text (image / sticker
// / audio).  Used by the live engine (handleNonTextInbound) + the trainer
// preview so both stay identical and obey the CEO's "no หากเร่งด่วน" rule.
export function renderNonTextAck(s: BotSettings): string {
  return resolveReply("non_text_ack", s);
}

// ─────────────────────────────────────────────────────────────────────────
// Hotel template — Mix Hotel + future hotel tenants.
// Every reply ends with a booking CTA + URL so the customer can jump
// straight into the web booking flow (CEO goal: "Facebook กดให้ไปจอง
// บนเว็บ"). Specific intents get polished short replies; "other" falls
// back to greeting + CTA so we never leave a customer hanging.
// botUrl comes from BotSettings if set; otherwise hardcoded Mix Hotel URL.
// ─────────────────────────────────────────────────────────────────────────
export type HotelIntent =
  | "greeting"
  | "price"
  | "availability"
  | "location"
  | "checkin"
  | "amenities"
  | "payment"
  | "other";

const HOTEL_KEYWORDS: Array<{ intent: HotelIntent; words: string[] }> = [
  { intent: "price", words: ["ราคา", "เท่าไหร่", "เท่าไร", "price", "rate", "บาท", "ค่าห้อง"] },
  { intent: "availability", words: ["ว่าง", "ห้องว่าง", "available", "จองได้", "ห้องเหลือ"] },
  { intent: "location", words: ["ที่ไหน", "ที่อยู่", "อยู่ไหน", "แผนที่", "map", "location", "พิกัด", "ไปยังไง", "ใกล้"] },
  { intent: "checkin", words: ["เช็คอิน", "เช็คเอ้า", "check in", "check-in", "checkout", "เช็คเอาท์"] },
  { intent: "amenities", words: ["wifi", "ไวไฟ", "tv", "ทีวี", "ตู้เย็น", "อาหารเช้า", "breakfast", "จอดรถ"] },
  { intent: "payment", words: ["จ่าย", "ชำระ", "โอน", "qr", "เงินสด", "บัตร", "มัดจำ"] },
];

export function classifyHotelIntent(text: string): HotelIntent {
  const t = text.toLowerCase();
  for (const rule of HOTEL_KEYWORDS) {
    if (rule.words.some((w) => t.includes(w))) return rule.intent;
  }
  if (/(สวัสดี|hello|hi|ทักทาย|hey)/i.test(text)) return "greeting";
  return "other";
}

export function renderHotelTemplate(
  intent: HotelIntent,
  s: BotSettings,
  botUrl?: string | null,
): string {
  const url = botUrl?.trim() || "https://pooilgroup.vercel.app/hotel/mix-hotel";
  const phone = s.contactPhone || "044-244-700";
  const cta = `\n\n📅 จองออนไลน์: ${url}\n📞 หรือโทร ${phone}`;

  switch (intent) {
    case "greeting":
      return `สวัสดีค่ะ ยินดีต้อนรับสู่ Mix Hotel 🏨\nโรงแรมบัดเจท 3 ดาว · เปิด 24 ชั่วโมง · ราคาเริ่มต้น 300 บาท/คืน` + cta;
    case "price":
      return (
        `ห้องของเรามี 5 แบบ ราคาเท่ากันทุกวันค่ะ:\n` +
        `🛏 Standard Compact 300 บาท (ไม่มีตู้เย็น)\n` +
        `🛏 Standard Single 400 บาท ⭐ (ยอดนิยม)\n` +
        `🛏 Standard Double / Large 450 บาท\n` +
        `🛏 VIP Family 550 บาท (มีอ่างอาบน้ำ)` + cta
      );
    case "availability":
      return `ขอเช็คให้นะคะ · รบกวนเลือกวันเช็คอิน-เช็คเอาท์และห้องที่ต้องการในระบบจองเลยค่ะ ✨` + cta;
    case "location":
      return (
        `Mix Hotel อยู่ที่นี่ค่ะ 📍\nhttps://maps.app.goo.gl/q2YVKwu6cjsGrjVK6\n\n` +
        `ใกล้ๆ มี 7-11 + ร้านกาแฟ · Grab Food ส่งถึงห้องได้ค่ะ` + cta
      );
    case "checkin":
      return `เช็คอิน หลังเที่ยง · เช็คเอาท์ ก่อนเที่ยงค่ะ · เปิดบริการ 24 ชั่วโมง ทุกวันค่ะ` + cta;
    case "amenities":
      return (
        `ในห้องมีครบเลยค่ะ ✨\n` +
        `✅ Wi-Fi · ✅ TV · ✅ ตู้เย็น · ✅ AC\n` +
        `🪒 เครื่องเป่าผม ขอยืมที่ reception ได้ค่ะ\n` +
        `🍳 อาหารเช้า ไม่มี แต่สั่งให้ได้ (Grab Food ส่งถึงห้อง)` + cta
      );
    case "payment":
      return `รับชำระทุกแบบเลยค่ะ 💰\n💵 เงินสด · 🏦 โอน · 📱 QR PromptPay\nจ่ายตอนเช็คอินที่ reception ค่ะ` + cta;
    default:
      return `ขอบคุณที่ติดต่อ Mix Hotel นะคะ 🏨\nสนใจห้องไหน · วันไหน · แจ้งได้เลยค่ะ` + cta;
  }
}

/** Append booking CTA to an AI-generated answer (used when AI fallback runs). */
export function appendHotelCta(answer: string, botUrl?: string | null): string {
  const url = botUrl?.trim() || "https://pooilgroup.vercel.app/hotel/mix-hotel";
  if (answer.includes(url) || answer.includes("/hotel/mix-hotel")) return answer;
  return `${answer}\n\n📅 จองห้องออนไลน์: ${url}`;
}

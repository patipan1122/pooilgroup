// Canned chairops topic reply templates — shared source of truth.
//
// Both the live engine (lib/inbox/bot/engine.ts) and the trainer's preview
// (lib/inbox/bot/trainer-actions.ts) read from here so the preview never
// drifts out of sync with what real customers receive (audit BOT-003).

import type { InboxTopic } from "./classify";
import type { BotSettings } from "./settings";

export function renderChairopsTemplate(
  topic: InboxTopic,
  s: BotSettings,
  isComplaint: boolean,
): string {
  // Lead with the "just call us, we fix it online in 30 seconds" line so the
  // customer dials first; everything else is bonus context.  Matches the
  // CEO's intent: a tech flips the machine back on remotely, faster than
  // chasing the customer for full details.
  const phone = s.contactPhone || "ทีมงาน";
  switch (topic) {
    case "money_lost":
      return (
        `ขออภัยมากๆ เลยนะคะ 🙏 รบกวน**โทร ${phone} ทันที**นะคะ ` +
        `ทีมงานจะกดเปิดเครื่อง/แก้ออนไลน์ให้ภายใน 30 วินาทีค่ะ\n\n` +
        `ระหว่างเดินไปโทร ถ้าสะดวกแจ้งข้อมูลนี้ไว้ก่อนได้นะคะ (ไม่จำเป็นต้องครบ):\n` +
        `• เครื่อง "กินเหรียญ" หรือ "กินแบงค์" คะ\n` +
        `• สาขา + จังหวัด\n` +
        `• เลขเครื่อง (มุมซ้ายบนของหน้าจอ เช่น G0310416)\n` +
        `   _หาไม่เจอไม่เป็นไรค่ะ โทรเข้ามาก่อนได้เลย_`
      );
    case "scan_fail":
      return (
        `ขออภัยค่ะ 🙏 รบกวน**โทร ${phone} ทันที**นะคะ ` +
        `ทีมงานจะช่วยเช็ค/แก้ออนไลน์ให้ภายใน 30 วินาทีค่ะ\n\n` +
        `ถ้ามีเวลา ขอ "สาขา + เลขเครื่อง" (มุมซ้ายบนของหน้าจอ เช่น G0310416) ไว้ก่อนได้นะคะ ` +
        `_หาเลขไม่เจอก็ไม่เป็นไรค่ะ_`
      );
    case "strong":
      return (
        `ขอโทษด้วยนะคะ 🙏 รบกวนเล่าให้ฟังนิดนึง จะได้แนะนำการปรับให้พอดีกับคุณค่ะ\n` +
        `1) นวดแรงตรงไหนคะ (แขน / ขา / หลัง / ทั่ว ๆ)\n` +
        `2) ระดับความเจ็บเต็ม 10 ประมาณกี่คะแนน\n` +
        `3) คุณเป็นชาย/หญิง อายุประมาณเท่าไรคะ\n\n` +
        `เครื่องปรับความแรงได้ระดับ 1–6 (เริ่มต้นที่ระดับ 3) ค่ะ ` +
        `พอได้รายละเอียดเดี๋ยวแนะนำต่อให้นะคะ`
      );
    case "buy":
      return (
        `ขอบคุณที่สนใจค่ะ 😊 ขอข้อมูลสั้นๆ จะได้แนะนำให้ตรงความต้องการนะคะ\n` +
        `1) สนใจไว้ใช้ที่บ้าน หรือเปิดร้าน/หยอดเหรียญคะ\n` +
        `2) งบประมาณคร่าวๆ (เป็นเครื่องเดียว / หลายเครื่อง)\n` +
        `3) ฝาก "ชื่อ + เบอร์ติดต่อ" ไว้นะคะ เดี๋ยวทีมงานโทรกลับไปคุยรายละเอียด`
      );
    case "feedback":
      return isComplaint
        ? `ขออภัยจริงๆ นะคะ 🙏 รบกวนเล่าเพิ่มได้ไหมคะว่าติดปัญหาเรื่องอะไร (สาขา/เลขเครื่องถ้ามี) เดี๋ยวทีมงานรีบดูแลให้ค่ะ`
        : `ขอบคุณสำหรับคำติชมนะคะ 🙏 เรารับไว้ปรับปรุงและดูแลให้ดีขึ้นแน่นอนค่ะ`;
    default:
      return s.fallbackText;
  }
}

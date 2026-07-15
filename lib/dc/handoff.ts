// DC · "ตะกร้าฝาก" (handoff) — หน้าสินค้า/ใบ PO เลือกของไว้ → เด้งไปหน้า "เบิก · โอน · ย้ายที่" แล้ว prefill ให้
//
// ★ ทำไมต้องมี intent: เดิม payload ไม่ได้บอกว่าคนกดปุ่ม "เบิก" หรือ "โอน" → หน้าปลายทางเดาเอาว่าโอนเสมอ
//   เบิก = ของออกจากคลังถาวร · โอน = ของไปโผล่อีกคลัง → เดาผิด = ของออกผิดทางแบบเงียบ ๆ
//   ตอนนี้ทุก payload ต้องปั๊ม intent มาด้วย แล้วหน้าปลายทางเปิดแท็บตามเจตนาจริง
//
// ★ ทำไมต้องมี TTL: handoff อยู่ใน sessionStorage = อยู่ยาวทั้งอายุแท็บเบราว์เซอร์
//   ถ้าเขียนไว้แล้วปลายทางไม่ได้ mount (เช่น ยังไม่ได้เลือกคลัง → หน้าโชว์การ์ด "ยังไม่มีคลัง") ของจะค้าง
//   แล้วไป prefill ใส่งานอื่นทีหลังแบบไม่มีใครคาดคิด → หมดอายุทิ้งดีกว่า
//
// prefill = ค่าเริ่มต้นให้สะดวกเท่านั้น · server re-resolve ของจริงทุกครั้ง (house rule money-preview-must-match-server)

export const PO_HANDOFF_KEY = "dc.pohandoff";
export const PRODUCT_HANDOFF_KEY = "dc.producthandoff";

/** งานที่คนกดตั้งใจจะทำกับของที่ฝากมา */
export type HandoffIntent = "issue" | "transfer";

/** เก่ากว่านี้ = ทิ้ง (คนคงเปลี่ยนใจ/เดินไปทำอย่างอื่นแล้ว) */
const HANDOFF_TTL_MS = 10 * 60 * 1000;

type HandoffEnvelope = { intent?: HandoffIntent; ts?: number };

function removeKey(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* private mode — ช่างมัน */
  }
}

/**
 * อ่าน + parse + คัดของที่ใช้ไม่ได้ทิ้ง · คืน null ถ้าไม่มี/พัง/หมดอายุ/ไม่มีตราประทับ
 * ★ ไม่มี intent หรือไม่มี ts (= payload รุ่นเก่าที่เขียนก่อน deploy นี้) → ถือว่าใช้ไม่ได้ ลบทิ้ง
 *   ยอมให้ลิสต์ว่างช่วงสั้น ๆ ตอน deploy ดีกว่าปล่อยของที่ไม่รู้เจตนาไปลงงานผิดประเภท
 */
function readEnvelope(key: string): (HandoffEnvelope & Record<string, unknown>) | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HandoffEnvelope & Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.intent || typeof parsed.ts !== "number") {
      removeKey(key); // รุ่นเก่า/ของปลอม — ไม่รู้เจตนา = ไม่เดา
      return null;
    }
    if (Date.now() - parsed.ts > HANDOFF_TTL_MS) {
      removeKey(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** หน้าสินค้า/ใบ PO เรียกตอนกด "เบิก" หรือ "โอน" — ปั๊ม intent + เวลาไว้เสมอ */
export function writeDcHandoff(key: string, payload: object, intent: HandoffIntent): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ...payload, intent, ts: Date.now() }));
  } catch {
    /* quota / private mode — ปล่อยผ่าน (หน้าปลายทางจะเปิดเปล่า) */
  }
}

/**
 * หน้าปลายทางเรียกตอน mount — คืน payload เฉพาะที่ "ฝากมาให้งานนี้" เท่านั้น
 * intent ไม่ตรง → คืน null และ **ไม่ลบ** (ปล่อยให้แท็บที่ถูกต้องมากินเอง · ถ้าไม่มีใครกิน TTL จัดการ)
 */
export function readDcHandoff<T>(key: string, forIntent: HandoffIntent): T | null {
  const env = readEnvelope(key);
  if (!env) return null;
  if (env.intent !== forIntent) return null; // readEnvelope การันตีว่ามี intent เสมอ → ไม่ตรง = ไม่ใช่ของงานนี้
  return env as unknown as T;
}

/** กินของแล้ว → ล้างทิ้งทั้งคู่ (กันเศษค้างไป prefill งานอื่นทีหลัง) */
export function clearDcHandoffs(): void {
  if (typeof window === "undefined") return;
  removeKey(PO_HANDOFF_KEY);
  removeKey(PRODUCT_HANDOFF_KEY);
}

// หมายเหตุ: ตั้งใจ "ไม่มี" ฟังก์ชันแอบดูของฝากเพื่อเด้งแท็บอัตโนมัติ
//   แท็บต้องมาจาก ?tab= บน URL เท่านั้น (หน้าสินค้า push ?tab= ตามปุ่มที่กดอยู่แล้ว)
//   ถ้าเด้งตามของฝาก → ของที่ค้างอยู่จะทับแท็บที่ผู้ใช้เพิ่งกดเลือกเอง = ของออกผิดทาง

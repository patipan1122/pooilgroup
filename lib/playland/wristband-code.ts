// รหัสสายรัด = "PW-" + (เลข 10 หลักแบบใหม่ หรือ 9 ตัวอักษรแบบเก่า) · ไฟล์นี้เป็นเจ้าของกฎเดียว (ตัวสร้างรหัส + ตัวแปลงรหัสที่สแกนได้ใช้ร่วมกัน ห้ามก๊อปไปที่อื่น)
//
// บาร์โค้ดบนสายรัดพิมพ์เฉพาะ 9 ตัวท้าย (สั้นลง 20% → สแกนง่ายบนข้อมือเด็กที่โค้ง)
// ตัวสแกน/พนักงานพิมพ์มาแบบไหนก็ได้ ("PW-ABC..." หรือ "ABC...") → แปลงเป็นรหัสเต็มก่อนค้นหาเสมอ
// ไฟล์นี้ต้องเป็น pure module (ห้าม "use server") เพราะ client (offline-db, ตัววาดสายรัด) ก็ import ใช้

export const WRISTBAND_PREFIX = "PW-";
export const WRISTBAND_CODE_ALPHABET = "ACDEFHJKLMNPQRTUVWXY3479"; // ไม่มี 0/O 1/I ที่สับสนง่าย
export const WRISTBAND_SUFFIX_LENGTH = 9;

const LETTER_SUFFIX_RE = new RegExp(`^[${WRISTBAND_CODE_ALPHABET}]{${WRISTBAND_SUFFIX_LENGTH}}$`);

// รหัสแบบใหม่ = เลข 10 หลักล้วน (เครื่องสแกนหน้าประตูอ่านบาร์โค้ดจาก USB เป็น "เลขบัตร" รับเฉพาะตัวเลข · ยืนยันกับเครื่องจริง 2026-10-01)
// ช่วง 1,000,000,000 – 4,294,967,295 = ไม่ขึ้นต้นด้วย 0 และไม่เกิน 32 บิต (กันเครื่องตัดเลขนำหน้า/ล้นช่วงเลขบัตร)
export const WRISTBAND_NUMERIC_MIN = 1_000_000_000;
export const WRISTBAND_NUMERIC_MAX = 4_294_967_295;
const NUMERIC_SUFFIX_RE = /^[1-9]\d{9}$/;

function isNumericSuffix(s: string): boolean {
  return NUMERIC_SUFFIX_RE.test(s) && Number(s) <= WRISTBAND_NUMERIC_MAX;
}

function isValidSuffix(s: string): boolean {
  return LETTER_SUFFIX_RE.test(s) || isNumericSuffix(s);
}

/** เลขบัตรที่ใช้ลงรายชื่อเครื่องประตู (icno) · null = รหัสแบบเก่า (ตัวอักษร) ที่ประตูไม่รองรับ */
export function wristbandGateNumber(fullCode: string): string | null {
  const up = fullCode.trim().toUpperCase();
  if (!up.startsWith(WRISTBAND_PREFIX)) return null;
  const suffix = up.slice(WRISTBAND_PREFIX.length);
  return isNumericSuffix(suffix) ? suffix : null;
}

export function normalizeWristbandCode(raw: string): string {
  const up = raw.trim().toUpperCase().replace(/\s/g, "");
  return isValidSuffix(up) ? WRISTBAND_PREFIX + up : up;
}

// ข้อมูลที่จะเข้ารหัสเป็นบาร์โค้ด: ตัด "PW-" ออกเฉพาะรหัสที่ตัวท้ายอยู่ใน alphabet จริง
// (รหัสเดโม/รหัสเก่านอก alphabet คงรหัสเต็มไว้ ไม่งั้นตอนสแกนกลับมาระบบเติม PW- คืนให้ไม่ได้)
export function wristbandBarcodeData(fullCode: string): string {
  const up = fullCode.trim().toUpperCase();
  if (up.startsWith(WRISTBAND_PREFIX) && isValidSuffix(up.slice(WRISTBAND_PREFIX.length))) {
    return up.slice(WRISTBAND_PREFIX.length);
  }
  return up;
}

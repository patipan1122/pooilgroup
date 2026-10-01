// รหัสสายรัด = "PW-" + 9 ตัวอักษร · ไฟล์นี้เป็นเจ้าของกฎเดียว (ตัวสร้างรหัส + ตัวแปลงรหัสที่สแกนได้ใช้ร่วมกัน ห้ามก๊อปไปที่อื่น)
//
// บาร์โค้ดบนสายรัดพิมพ์เฉพาะ 9 ตัวท้าย (สั้นลง 20% → สแกนง่ายบนข้อมือเด็กที่โค้ง)
// ตัวสแกน/พนักงานพิมพ์มาแบบไหนก็ได้ ("PW-ABC..." หรือ "ABC...") → แปลงเป็นรหัสเต็มก่อนค้นหาเสมอ
// ไฟล์นี้ต้องเป็น pure module (ห้าม "use server") เพราะ client (offline-db, ตัววาดสายรัด) ก็ import ใช้

export const WRISTBAND_PREFIX = "PW-";
export const WRISTBAND_CODE_ALPHABET = "ACDEFHJKLMNPQRTUVWXY3479"; // ไม่มี 0/O 1/I ที่สับสนง่าย
export const WRISTBAND_SUFFIX_LENGTH = 9;

const SUFFIX_RE = new RegExp(`^[${WRISTBAND_CODE_ALPHABET}]{${WRISTBAND_SUFFIX_LENGTH}}$`);

export function normalizeWristbandCode(raw: string): string {
  const up = raw.trim().toUpperCase().replace(/\s/g, "");
  return SUFFIX_RE.test(up) ? WRISTBAND_PREFIX + up : up;
}

// ข้อมูลที่จะเข้ารหัสเป็นบาร์โค้ด: ตัด "PW-" ออกเฉพาะรหัสที่ตัวท้ายอยู่ใน alphabet จริง
// (รหัสเดโม/รหัสเก่านอก alphabet คงรหัสเต็มไว้ ไม่งั้นตอนสแกนกลับมาระบบเติม PW- คืนให้ไม่ได้)
export function wristbandBarcodeData(fullCode: string): string {
  const up = fullCode.trim().toUpperCase();
  if (up.startsWith(WRISTBAND_PREFIX) && SUFFIX_RE.test(up.slice(WRISTBAND_PREFIX.length))) {
    return up.slice(WRISTBAND_PREFIX.length);
  }
  return up;
}

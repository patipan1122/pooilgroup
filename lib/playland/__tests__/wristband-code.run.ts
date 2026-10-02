// รัน: npx tsx lib/playland/__tests__/wristband-code.run.ts
import assert from "node:assert/strict";
import { normalizeWristbandCode, wristbandBarcodeData, wristbandGateNumber, WRISTBAND_CODE_ALPHABET, WRISTBAND_PREFIX, WRISTBAND_NUMERIC_MIN, WRISTBAND_NUMERIC_MAX } from "../wristband-code";

// สแกน/พิมพ์มาแบบไหน → ได้รหัสเต็มเหมือนกัน
for (const raw of ["PW-A3F7K9M4Q", "pw-a3f7k9m4q", "A3F7K9M4Q", " a3f7 k9m4q \n"]) {
  assert.equal(normalizeWristbandCode(raw), "PW-A3F7K9M4Q", `raw=${JSON.stringify(raw)}`);
}

// ไม่แตะรหัสที่ไม่ใช่สายรัด/ไม่ตรงกฎ (ห้ามเติม PW- มั่ว)
assert.equal(normalizeWristbandCode("TEST-PRINT"), "TEST-PRINT");
assert.equal(normalizeWristbandCode("OOOOOOOOO"), "OOOOOOOOO"); // O ไม่อยู่ใน alphabet
assert.equal(normalizeWristbandCode("A3F7K9M2Q"), "A3F7K9M2Q"); // มีเลข 2 ซึ่งระบบไม่เคยสร้าง → ไม่เติม PW-
assert.equal(normalizeWristbandCode("A3F7K9M4"), "A3F7K9M4"); // 8 ตัว
assert.equal(normalizeWristbandCode("A3F7K9M4QX"), "A3F7K9M4QX"); // 10 ตัว
assert.equal(normalizeWristbandCode("PL-2569-0001"), "PL-2569-0001"); // รหัสสมาชิก

// บาร์โค้ด: ตัด PW- เฉพาะรหัสจริง · รหัสนอก alphabet คงรหัสเต็ม
assert.equal(wristbandBarcodeData("PW-A3F7K9M4Q"), "A3F7K9M4Q");
assert.equal(wristbandBarcodeData("pw-a3f7k9m4q"), "A3F7K9M4Q");
assert.equal(wristbandBarcodeData("PW-0OOOO1111"), "PW-0OOOO1111");
assert.equal(wristbandBarcodeData("TEST-PRINT"), "TEST-PRINT");

// round-trip: รหัสที่ระบบสร้างจริง → พิมพ์เป็นบาร์โค้ด → สแกนกลับ → ได้รหัสเดิมเสมอ
for (let n = 0; n < 5000; n++) {
  let code = WRISTBAND_PREFIX;
  for (let i = 0; i < 9; i++) code += WRISTBAND_CODE_ALPHABET[Math.floor(Math.random() * WRISTBAND_CODE_ALPHABET.length)];
  assert.equal(normalizeWristbandCode(wristbandBarcodeData(code)), code);
}

// รหัสเลข 10 หลัก (แบบใหม่ · เครื่องประตูอ่านเป็นเลขบัตร)
for (const raw of ["PW-1258881673", "pw-1258881673", "1258881673", " 1258 881673 \n"]) {
  assert.equal(normalizeWristbandCode(raw), "PW-1258881673", `numeric raw=${JSON.stringify(raw)}`);
}
assert.equal(wristbandBarcodeData("PW-1258881673"), "1258881673");
assert.equal(wristbandGateNumber("PW-1258881673"), "1258881673");
assert.equal(wristbandGateNumber("pw-4294967295"), "4294967295");
assert.equal(wristbandGateNumber("PW-A3F7K9M4Q"), null); // รหัสตัวอักษรแบบเก่า → ประตูไม่รองรับ
assert.equal(wristbandGateNumber("1258881673"), null); // ต้องมี PW- (รหัสเต็มเท่านั้น)
// ขอบเขต: ขึ้นต้นด้วย 0 / เกิน 32 บิต / ความยาวไม่ใช่ 10 → ไม่ใช่รหัสสายรัด ห้ามเติม PW-
assert.equal(normalizeWristbandCode("0258881673"), "0258881673");
assert.equal(normalizeWristbandCode("4294967296"), "4294967296");
assert.equal(normalizeWristbandCode("999999998"), "999999998");
assert.equal(normalizeWristbandCode("12588816731"), "12588816731");
assert.equal(wristbandBarcodeData("PW-4294967296"), "PW-4294967296");
assert.equal(wristbandGateNumber("PW-4294967296"), null);
assert.equal(WRISTBAND_NUMERIC_MIN, 1_000_000_000);
assert.equal(WRISTBAND_NUMERIC_MAX, 4_294_967_295);
for (let n = 0; n < 5000; n++) {
  const num = String(WRISTBAND_NUMERIC_MIN + Math.floor(Math.random() * (WRISTBAND_NUMERIC_MAX - WRISTBAND_NUMERIC_MIN + 1)));
  const code = WRISTBAND_PREFIX + num;
  assert.equal(wristbandBarcodeData(code), num);
  assert.equal(normalizeWristbandCode(wristbandBarcodeData(code)), code);
  assert.equal(wristbandGateNumber(code), num);
}
console.log("wristband-code: all checks passed ✓");

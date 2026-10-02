// รัน: npx tsx lib/playland/__tests__/code128.run.ts
// ค่าคาดหวังสร้างจาก python-barcode (Code128) ของจริง ไม่ใช่เขียนเอง
import assert from "node:assert/strict";
import { encodeCode128B, encodeCode128C, encodeCode128 } from "../code128";

const EXPECTED: Record<string, string> = {
  "A3F7K9M2Q": "11010010000101000110001100101110010001100010111011011101011000111011100101100101110110001100111001011010001110111010111101100011101011",
  "PW-A3F7K9M2Q": "11010010000111011101101110100011010011011100101000110001100101110010001100010111011011101011000111011100101100101110110001100111001011010001110100011011101100011101011",
  "TEST-PRINT": "1101001000011011100010100011010001101110100011011100010100110111001110111011011000101110110001000101011100011011011100010100111101001100011101011",
  "ABC": "11010010000101000110001000101100010001000110110011011001100011101011",
  "PW-ACDEFHJKL": "11010010000111011101101110100011010011011100101000110001000100011010110001000100011010001000110001011000101000101101110001011000111010001101110110000101001100011101011",
};

for (const [text, modules] of Object.entries(EXPECTED)) {
  assert.equal(encodeCode128B(text), modules, `mismatch for ${text}`);
}
assert.equal(encodeCode128B("A3F7K9M2Q").length, 134, "9-char code must be 134 modules");
assert.throws(() => encodeCode128B(""), /empty/);
assert.throws(() => encodeCode128B("ก"), /unsupported/);
console.log("code128: all", Object.keys(EXPECTED).length, "vectors match python-barcode ✓");

// ---- subset C (ตัวเลขล้วน) ----
// ตัวอ้างอิงอิสระ = jsbarcode (ไลบรารีที่ติดตั้งในโปรเจ็กต์อยู่แล้ว · CODE128_AUTO เลือก subset C เองกับเลขล้วน)
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const CODE128AUTO = req("jsbarcode/src/barcodes/CODE128/CODE128_AUTO.js").default ?? req("jsbarcode/src/barcodes/CODE128/CODE128_AUTO.js");
const ref = (data: string): string => new CODE128AUTO(data, {}).encode().data;

// คำนวณมือ: "1258881673" = 12,58,88,16,73 → checksum = (105 + 12*1 + 58*2 + 88*3 + 16*4 + 73*5) % 103 = 926 % 103 = 102
const c1 = encodeCode128C("1258881673");
assert.equal(c1.length, 90, "10-digit numeric = 90 modules");
assert.equal(c1, ref("1258881673"), "must equal jsbarcode output");
for (let n = 0; n < 3000; n++) {
  const d = String(1_000_000_000 + Math.floor(Math.random() * 3_294_967_295));
  assert.equal(encodeCode128C(d), ref(d), `mismatch for ${d}`);
}
// ทุกคู่เลข 00-99 ถูกใช้จริง (รวม 95-99 ที่ subset B ไม่ครอบคลุม)
for (let v = 0; v <= 99; v++) {
  const d = String(v).padStart(2, "0") + "00";
  assert.equal(encodeCode128C(d), ref(d), `pair ${d}`);
}
// ตัวเลือกอัตโนมัติ: เลขคู่ ≥4 หลัก → C · นอกนั้น → B
assert.equal(encodeCode128("1258881673"), c1);
assert.equal(encodeCode128("A3F7K9M2Q"), EXPECTED["A3F7K9M2Q"]);
assert.equal(encodeCode128("123"), encodeCode128B("123")); // จำนวนคี่ → B
assert.equal(encodeCode128("PW-1258881673"), encodeCode128B("PW-1258881673"));
assert.throws(() => encodeCode128C("123"), /ตัวเลขล้วน/);
assert.throws(() => encodeCode128C("12A4"), /ตัวเลขล้วน/);
console.log("code128 subset C: 3,100 vectors match jsbarcode ✓ (+ hand-computed checksum)");

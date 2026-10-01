// พิสูจน์ว่าตัวบีบอัดแถวถอดกลับได้ภาพเดิมเป๊ะ: node test-encode.js [ไฟล์ .bin ...]
import assert from "node:assert/strict";
import fs from "node:fs";
import { encodeRows, ROWS, BYTES_PER_ROW, BITMAP_BYTES } from "./k2.js";

function decode(packets) {
  const out = Buffer.alloc(BITMAP_BYTES);
  let next = 0;
  for (const { frame: f } of packets) {
    assert.equal(f[0], 0x55); assert.equal(f[1], 0x55);
    const type = f[2], len = f[3], d = f.subarray(4, 4 + len);
    let chk = type ^ len; for (const b of d) chk ^= b; assert.equal(f[4 + len], chk, "checksum");
    const y = (d[0] << 8) | d[1];
    assert.equal(y, next, "rows must be contiguous (position == rows so far)");
    if (type === 0x84) {
      const n = d[2]; assert.ok(n >= 1 && n <= 255);
      next += n;                                   // แถวว่าง: buffer เป็น 0 อยู่แล้ว
    } else {
      assert.equal(type, 0x85);
      const n = d[5]; assert.ok(n >= 1 && n <= 255);
      const row = d.subarray(6, 6 + BYTES_PER_ROW); assert.equal(row.length, BYTES_PER_ROW);
      for (let k = 0; k < n; k++) row.copy(out, (y + k) * BYTES_PER_ROW);
      next += n;
    }
  }
  assert.equal(next, ROWS, "all rows covered");
  return out;
}

const cases = [];
for (const f of process.argv.slice(2)) cases.push([f, fs.readFileSync(f)]);
cases.push(["blank", Buffer.alloc(BITMAP_BYTES)]);
cases.push(["all black", Buffer.alloc(BITMAP_BYTES, 0xff)]);
const alt = Buffer.alloc(BITMAP_BYTES); for (let y = 0; y < ROWS; y += 2) alt.fill(0xaa, y * BYTES_PER_ROW, (y + 1) * BYTES_PER_ROW);
cases.push(["alternating rows (worst case)", alt]);
for (let i = 0; i < 20; i++) { const r = Buffer.alloc(BITMAP_BYTES); for (let y = 0; y < ROWS; y++) { if (Math.random() < 0.5) { const v = Math.floor(Math.random() * 256); r.fill(v, y * BYTES_PER_ROW, (y + 1) * BYTES_PER_ROW); } } cases.push([`random ${i}`, r]); }

for (const [name, bmp] of cases) {
  const packets = encodeRows(bmp);
  const back = decode(packets);
  assert.ok(back.equals(bmp), `round-trip mismatch: ${name}`);
  const bytes = packets.reduce((a, p) => a + p.frame.length, 0);
  console.log(`✓ ${name.padEnd(34)} ${String(packets.length).padStart(5)} packets · ${String(bytes).padStart(6)} bytes (was ${ROWS} packets · ${ROWS * 38} bytes)`);
}
console.log("all round-trips identical ✓");

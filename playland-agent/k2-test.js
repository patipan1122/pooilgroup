// ทดสอบเครื่อง K2 ตรงๆ (ไม่ผ่านเว็บ/คิว): node k2-test.js <ไฟล์บิตแมป .bin 41,200 ไบต์> [พอร์ต]
import fs from "node:fs";
import { printWristbandBitmap, detectK2Path } from "./k2.js";

const [, , file, serialPath] = process.argv;
if (!file) {
  console.error("ใช้: node k2-test.js <bitmap.bin> [/dev/cu.usbmodem...]");
  process.exit(1);
}
console.log("พอร์ตที่พบ:", serialPath || (await detectK2Path()));
const t0 = Date.now();
try {
  await printWristbandBitmap(fs.readFileSync(file), { serialPath, log: (m) => console.log(" ", m) });
  console.log(`✅ พิมพ์สำเร็จใน ${((Date.now() - t0) / 1000).toFixed(1)} วิ`);
} catch (e) {
  console.error(`❌ ${e.name}: ${e.message}`);
  process.exit(2);
}

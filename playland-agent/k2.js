// Playland agent · ตัวขับเครื่องพิมพ์สายรัด NIIMBOT K2 (USB serial)
//
// สูตรที่ใช้ได้จริง (ทดสอบกับเครื่องจริง 2026-10-01): โปรโตคอลรุ่น 5 แบบ D110M v4 —
//   SetLabelType 2 (แถบดำหลังแผ่นรอง) → SetDensity 4 → PrintStart(9 ไบต์: จำนวนหน้ารวม) → SetPageSize(13 ไบต์: แถว,คอลัมน์,...)
//   → ส่งทีละแถว (0x85) หน่วง 15 มิลลิวินาที → PageEnd → ถามสถานะจนเครื่องบอกจบหน้า → PrintEnd
// ข้อควรระวังที่เจอมา: ห้ามใช้ชนิดกระดาษ 1 (แบบมีช่องว่าง) — เครื่องจะเดินกระดาษไม่หยุดแล้วไฟแดง · ห้ามส่ง PageStart (0x03)
// บิตแมป = 1648 แถว x 25 ไบต์ (1 บิตต่อจุด, MSB ก่อน, 1 = จุดดำ) ตรงกับ lib/playland/wristband-bitmap-spec.ts ฝั่งเว็บ

import { SerialPort } from "serialport";

export const ROWS = 1648;
export const COLS = 200;
export const BYTES_PER_ROW = COLS / 8;
export const BITMAP_BYTES = ROWS * BYTES_PER_ROW;

const LABEL_TYPE = 2;
const DENSITY = 4;
const ROW_PACING_MS = Number(process.env.K2_ROW_PACING_MS || 15); // หน่วงหลังส่งแพ็กเก็ตแถวมีข้อมูล (ยังไม่พิสูจน์ว่าลดได้ ห้ามลดโดยไม่พิมพ์ทดสอบจริง)
// K2_RLE=1 → ส่งแบบบีบอัด (เร็วกว่าราว 3 เท่า) · ปิดไว้จนกว่าจะพิมพ์ทดสอบจริงยืนยันว่าภาพเหมือนเดิมเป๊ะ
const USE_RLE = process.env.K2_RLE === "1";
const BLANK_PACING_MS = 2; // แพ็กเก็ตแถวว่างเล็กมาก
const PAGE_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// รหัสผิดพลาดที่เครื่องรายงาน (PrinterErrorCode) → ข้อความไทยสำหรับแคชเชียร์
const ERROR_TH = {
  1: "ฝาเครื่องพิมพ์เปิดอยู่",
  2: "กระดาษหมด",
  3: "แบตเตอรี่ต่ำ",
  6: "ข้อมูลที่ส่งไปเครื่องพิมพ์ผิดพลาด",
  7: "หัวพิมพ์ร้อนเกินไป รอสักครู่",
  8: "หาตำแหน่งสายรัดไม่เจอ / กระดาษหมด (ไฟแดง) — เปิด-ปิดฝาแล้วเตรียมเครื่องใหม่",
  9: "เครื่องพิมพ์ไม่ว่าง",
  28: "ตรวจกระดาษไม่ผ่าน",
};

export class K2Error extends Error {
  constructor(message, code) {
    super(message);
    this.name = "K2Error";
    this.code = code;
  }
}

const describeError = (code) => `${ERROR_TH[code] ?? `เครื่องพิมพ์รายงานรหัสผิดพลาด ${code}`} (รหัส ${code})`;

function frame(type, data = []) {
  let chk = type ^ data.length;
  for (const b of data) chk ^= b;
  return Buffer.from([0x55, 0x55, type, data.length, ...data, chk, 0xaa, 0xaa]);
}

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];

// บีบอัดแบบเดียวกับไลบรารีต้นแบบ (niimbluelib): แถวติดกันที่เหมือนกัน → แพ็กเก็ตเดียว + จำนวนซ้ำ (≤255)
// แถวว่างทั้งแถว → แพ็กเก็ตแถวว่าง 0x84 [ตำแหน่ง, จำนวนซ้ำ] · แถวมีจุด → 0x85 [ตำแหน่ง, 0,0,0, จำนวนซ้ำ, ข้อมูล 25 ไบต์]
// สายรัดส่วนใหญ่ (ฟ้าล้วน ~2/3 ของความยาว) เป็นแถวว่าง และแท่งบาร์โค้ด/ตัวอักษรมีแถวซ้ำเยอะ → ส่งน้อยลงมาก ไม่ต้องรอหน่วงทีละ 1,648 แถว
// วิธีเดิม (พิสูจน์แล้วว่าพิมพ์ถูก): ส่งทุกแถวทีละแถว · ใช้เมื่อ K2_RLE ไม่ได้เปิด
export function encodeRowsPlain(bitmap) {
  const packets = [];
  for (let y = 0; y < ROWS; y++) {
    const row = bitmap.subarray(y * BYTES_PER_ROW, (y + 1) * BYTES_PER_ROW);
    packets.push({ blank: false, rows: 1, frame: frame(0x85, [...u16(y), 0, 0, 0, 1, ...row]) });
  }
  return packets;
}

export function encodeRows(bitmap) {
  const packets = [];
  let y = 0;
  while (y < ROWS) {
    const row = bitmap.subarray(y * BYTES_PER_ROW, (y + 1) * BYTES_PER_ROW);
    let n = 1;
    while (y + n < ROWS && n < 255 && row.equals(bitmap.subarray((y + n) * BYTES_PER_ROW, (y + n + 1) * BYTES_PER_ROW))) n++;
    const blank = row.every((b) => b === 0);
    packets.push({ blank, rows: n, frame: blank ? frame(0x84, [...u16(y), n]) : frame(0x85, [...u16(y), 0, 0, 0, n, ...row]) });
    y += n;
  }
  return packets;
}

// อ่านกรอบข้อมูลจากสาย (อาจมาเป็นชิ้นๆ / มีขยะนำหน้า)
class Link {
  constructor(port) {
    this.port = port;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    port.on("data", (d) => this.#onData(d));
  }

  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const i = this.buf.indexOf(Buffer.from([0x55, 0x55]));
      if (i < 0) {
        this.buf = this.buf.subarray(Math.max(0, this.buf.length - 1));
        return;
      }
      if (i > 0) this.buf = this.buf.subarray(i);
      if (this.buf.length < 4) return;
      const total = this.buf[3] + 7;
      if (this.buf.length < total) return;
      const f = this.buf.subarray(0, total);
      this.buf = this.buf.subarray(total);
      if (f[total - 1] !== 0xaa || f[total - 2] !== 0xaa) continue;
      this.queue.push({ type: f[2], data: Buffer.from(f.subarray(4, 4 + f[3])) });
    }
  }

  send(buf) {
    return new Promise((resolve, reject) => this.port.write(buf, (e) => (e ? reject(e) : resolve())));
  }

  // type 219 (0xDB) = เครื่องส่ง PrintError กลับมา (ไบต์แรก = รหัส)
  throwIfPrintError() {
    const bad = this.queue.find((p) => p.type === 219);
    if (bad) throw new K2Error(describeError(bad.data[0]), bad.data[0]);
  }

  async txrx(buf, respType, label, timeoutMs = 3000) {
    await this.send(buf);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      this.throwIfPrintError();
      const idx = this.queue.findIndex((p) => p.type === respType);
      if (idx >= 0) return this.queue.splice(idx, 1)[0].data;
      await sleep(20);
    }
    throw new K2Error(`เครื่องพิมพ์ไม่ตอบ (${label})`);
  }

  // สถานะงานพิมพ์: {page, print%, feed%, errorByte}
  async printStatus(timeoutMs = 800) {
    await this.send(frame(0xa3, [1]));
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      this.throwIfPrintError();
      const idx = this.queue.findIndex((p) => p.type === 0xb3 && p.data.length >= 4);
      if (idx >= 0) {
        const d = this.queue.splice(idx, 1)[0].data;
        return { page: (d[0] << 8) | d[1], print: d[2], feed: d[3], error: d.length === 10 ? d[6] : 0 };
      }
      await sleep(20);
    }
    return null;
  }
}

// หาพอร์ต USB ของ K2 อัตโนมัติ (ผู้ผลิต NIIMBOT / ชื่อพอร์ต usbmodemK2…)
export async function detectK2Path() {
  const ports = await SerialPort.list();
  const hit = ports.find((p) => /niimbot/i.test(p.manufacturer ?? "") || /K2/i.test(p.path) || /K2/i.test(p.serialNumber ?? ""));
  // macOS: /dev/tty.* รอสัญญาณ carrier ได้ ใช้ /dev/cu.* ที่เป็นของฝั่งโปรแกรมแทน
  return hit ? hit.path.replace("/dev/tty.", "/dev/cu.") : null;
}

export async function printWristbandBitmap(bitmap, { serialPath, log = () => {} } = {}) {
  if (!Buffer.isBuffer(bitmap) || bitmap.length !== BITMAP_BYTES) {
    throw new K2Error(`บิตแมปขนาดไม่ถูกต้อง (${bitmap?.length} ไบต์ ต้อง ${BITMAP_BYTES})`);
  }
  const path = serialPath || (await detectK2Path());
  if (!path) throw new K2Error("ไม่พบเครื่องพิมพ์ K2 (ยังไม่เสียบ USB หรือปิดเครื่องอยู่)");

  const port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
  try {
    await new Promise((resolve, reject) => port.open((e) => (e ? reject(e) : resolve())));
  } catch (e) {
    throw new K2Error(`เปิดพอร์ตเครื่องพิมพ์ไม่ได้ (${path}): ${e.message}`);
  }

  const link = new Link(port);
  try {
    await sleep(60);
    link.queue.length = 0;

    await link.txrx(frame(0x23, [LABEL_TYPE]), 0x33, "ชนิดกระดาษ");
    await link.txrx(frame(0x21, [DENSITY]), 0x31, "ความเข้ม");
    await link.txrx(frame(0x01, [...u16(1), 0, 0, 0, 0, 0, 0, 0]), 0x02, "เริ่มงานพิมพ์");
    await link.send(frame(0xa3, [1])); // ตามขั้นตอนรุ่นใหม่: ถามสถานะ 1 ครั้งแบบไม่รอคำตอบ
    await sleep(200);
    link.queue.length = 0;
    await link.txrx(frame(0x13, [...u16(ROWS), ...u16(COLS), ...u16(1), ...u16(0), 0, 0, 0, ...u16(0)]), 0x14, "ขนาดหน้า");

    const started = Date.now();
    const packets = USE_RLE ? encodeRows(bitmap) : encodeRowsPlain(bitmap);
    for (let i = 0; i < packets.length; i++) {
      await link.send(packets[i].frame);
      await sleep(packets[i].blank ? BLANK_PACING_MS : ROW_PACING_MS);
      if (i % 50 === 49) {
        link.throwIfPrintError();
        link.queue.length = 0; // ทิ้ง check-line ที่เครื่องส่งมาระหว่างทาง
      }
    }
    log(`ส่งข้อมูล ${ROWS} แถว (${packets.length} แพ็กเก็ตหลังบีบอัด) ใน ${((Date.now() - started) / 1000).toFixed(1)} วิ`);

    await link.txrx(frame(0xe3, [1]), 0xe4, "จบหน้า");

    const deadline = Date.now() + PAGE_TIMEOUT_MS;
    let done = false;
    while (Date.now() < deadline) {
      const st = await link.printStatus();
      if (st && st.error) throw new K2Error(describeError(st.error), st.error);
      if (st && st.page >= 1) {
        done = true;
        break;
      }
      await sleep(250);
    }
    if (!done) throw new K2Error("เครื่องพิมพ์ใช้เวลานานผิดปกติ (ไม่รายงานว่าพิมพ์เสร็จ)");

    for (let i = 0; i < 30; i++) {
      const d = await link.txrx(frame(0xf3, [1]), 0xf4, "ปิดงานพิมพ์", 1500).catch(() => null);
      if (d && d[0] === 1) break;
      await sleep(300);
    }
    await link.send(frame(0xdc, [1])).catch(() => {});
    await sleep(120);
  } finally {
    await new Promise((resolve) => port.close(() => resolve()));
  }
}

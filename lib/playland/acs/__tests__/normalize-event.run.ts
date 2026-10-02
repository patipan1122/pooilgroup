// รัน: npx tsx lib/playland/acs/__tests__/normalize-event.run.ts
// payload ด้านล่างคัดจากเหตุการณ์จริงที่เครื่อง ACS-F606 ส่งมา (2026-10-01) · ตัดรูปหน้าออกให้สั้น
import assert from "node:assert/strict";
import { acsAutoAdapter } from "../acs-auto-adapter";

const base = {
  Mac_addr: "0A:0C:E8:66:30:1F", SN: "T77QR6301FZS", devicename: "Terminal", face_base64: "/9j/4AAQ", inout: 1,
  time: "2026-10-01 21:44:16", temperature: "0.00", templatePhoto: "", name: "", userid: "", QRcode: "",
};

// 1) สแกนบาร์โค้ดเลข 1258881673 ตอนยังไม่อยู่ในรายชื่อเครื่อง → ถูกปฏิเสธ ต้องไม่ถูกนับเป็น "คนแปลกหน้า"
const denied = acsAutoAdapter.normalizeEvent({ ...base, id: "1790862256", IdentifyType: "3", icNum: "1258881673", employee_number: "", resultStatus: 0 })!;
assert.equal(denied.type, "unrecognized");
assert.equal(denied.cardNo, "1258881673");
assert.equal(denied.faceId, null);
assert.equal(denied.direction, "in");

// 2) อยู่ในรายชื่อแล้ว (employee_number = id สมาชิก) → ผ่าน
const memberId = "5770fa16-3d68-45e1-b0b9-466fec332a05";
const ok = acsAutoAdapter.normalizeEvent({ ...base, id: "1790862318", IdentifyType: "3", icNum: "1258881673", employee_number: memberId, resultStatus: 1 })!;
assert.equal(ok.type, "recognized");
assert.equal(ok.cardNo, "1258881673");
assert.equal(ok.faceId, memberId);

// 3) ทางออก (inout 0)
const out = acsAutoAdapter.normalizeEvent({ ...base, id: "1790862400", IdentifyType: "3", icNum: "1258881673", employee_number: memberId, resultStatus: 1, inout: 0 })!;
assert.equal(out.direction, "out");

// 4) หน้าคนแปลกหน้า: ช่อง QRcode (Q ใหญ่ c เล็ก) ของเครื่องมีค่าได้ แต่ห้ามถูกตีเป็น qr_scan / เลขบัตร
const stranger = acsAutoAdapter.normalizeEvent({ ...base, id: "1790853873", IdentifyType: "0", icNum: "", employee_number: "", resultStatus: 0, QRcode: "675f0068c40b4a41a6f917e794148f7c" })!;
assert.equal(stranger.type, "stranger");
assert.equal(stranger.cardNo, null);
assert.equal(stranger.qrCode, null);

// 5) จำหน้าได้ → recognized ไม่มี cardNo
const face = acsAutoAdapter.normalizeEvent({ ...base, id: "1790853999", IdentifyType: "0", icNum: "", employee_number: memberId, resultStatus: 1 })!;
assert.equal(face.type, "recognized");
assert.equal(face.faceId, memberId);
assert.equal(face.cardNo, null);

// 6) เลขที่ไม่ใช่ตัวเลขล้วน/ยาวเกิน → ไม่ใช่เลขบัตร
const weird = acsAutoAdapter.normalizeEvent({ ...base, id: "1790854000", IdentifyType: "3", icNum: "12A4", employee_number: "", resultStatus: 0 })!;
assert.equal(weird.cardNo, null);

console.log("normalize-event: real device payloads parsed correctly ✓");

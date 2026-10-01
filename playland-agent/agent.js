// Playland local agent — สะพานเชื่อมเครื่องอ่านหน้า (LAN) เข้ากับระบบ pooilgroup-web จริง
//
// ทำไมต้องมีตัวนี้: เครื่อง ACS-F606 คุยได้แค่ HTTP ธรรมดา (ไม่รองรับ HTTPS) และอยู่หลัง
// router ร้าน (private IP) — เว็บที่ Vercel (HTTPS อย่างเดียว) เรียกเข้าเครื่องตรงๆ ไม่ได้
// ตัว agent นี้รันบนคอมร้าน (วง LAN เดียวกับเครื่อง) เลยคุยกับเครื่องได้ตรง (HTTP) แล้ว
// ส่งต่อเข้าเว็บจริงแบบ HTTPS ได้ (agent เป็นโปรแกรมทั่วไป ไม่ใช่ firmware เครื่อง)
//
// ทำ 2 หน้าที่:
//   1) รับ log สแกนจากเครื่อง (LAN, HTTP) → ส่งต่อ webhook จริงที่มีอยู่แล้ว
//      (/api/playland/acs/event) แบบ HTTPS → ส่งคำตอบจากเว็บกลับไปที่เครื่อง
//   2) ถามคิว "ต้องเพิ่ม/ลบหน้าใครไหม" ทุก N วินาที (/api/playland/acs/agent/face-sync)
//      แล้วไปทำที่เครื่องจริงผ่าน LAN จากนั้นรายงานผลกลับ//   3) (ถ้าตั้ง PRINTERS) ถามคิว "มีสายรัดให้พิมพ์ไหม" (/api/playland/print/agent/jobs)
//      แล้วสั่งเครื่องพิมพ์ NIIMBOT K2 ที่ต่อ USB กับเครื่องนี้ จากนั้นรายงานผล (/print/agent/result)
//
// รัน: node --env-file=.env agent.js   (ต้องมี .env — ดู .env.example)

import http from "node:http";
import os from "node:os";

const env = process.env;
const CLOUD_BASE_URL = (env.CLOUD_BASE_URL || "https://pooilgroup.vercel.app").replace(/\/$/, "");
const AGENT_PORT = Number(env.AGENT_PORT || 8080);
const POLL_INTERVAL_MS = Number(env.POLL_INTERVAL_MS || 5000);
const REBIND_INTERVAL_MS = Number(env.REBIND_INTERVAL_MS || 10 * 60_000); // กันเครื่อง reboot แล้วลืม callback
const DEVICE_PORT = Number(env.DEVICE_PORT || 8091);

function myLanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "127.0.0.1";
}
const AGENT_IP = env.AGENT_IP || myLanIp();

// DEVICES="T77QR6301FZS:192.168.1.10:123456:<secret>,T77QR6305CZS:192.168.1.11:123456:<secret>"
const DEVICES = (env.DEVICES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [deviceCode, ip, password, secret] = s.split(":");
    return { deviceCode, ip, password: password || "123456", secret };
  });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PRINTERS="K2-TEST-01:<รหัสลับ>"  (รหัสเครื่อง:รหัสลับ ตรงกับตาราง playland.printers ใน DB)
const PRINTERS = (env.PRINTERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [code, secret] = s.split(":");
    return { code, secret };
  });
const PRINT_POLL_INTERVAL_MS = Number(env.PRINT_POLL_INTERVAL_MS || 1000);
const K2_SERIAL_PATH = env.K2_SERIAL_PATH || undefined; // ไม่ใส่ = หาพอร์ต K2 เอง

if (DEVICES.length === 0) {
  console.error("❌ ไม่พบ DEVICES ใน .env — ดู .env.example");
  process.exit(1);
}

// ---------- คุยกับเครื่องบน LAN ----------
async function deviceCall(device, path, body = {}) {
  const res = await fetch(`http://${device.ip}:${DEVICE_PORT}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: device.password, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.json();
}

// ---------- ตั้งให้เครื่องส่ง log มาที่ agent นี้ ----------
async function bindCallback(device) {
  const platformIp = `http://${AGENT_IP}:${AGENT_PORT}/relay/${device.deviceCode}`;
  try {
    await deviceCall(device, "deviceLogin");
    const r = await deviceCall(device, "setIdentifyCallBck", { platformEnable: 1, platformIp });
    log(`🔗 [${device.deviceCode}] ผูก callback → ${platformIp}`, r.result === 0 ? "✅" : `❌ ${r.message}`);
  } catch (e) {
    log(`❌ [${device.deviceCode}] bindCallback ล้มเหลว (${device.ip}):`, e.message);
  }
}

// ---------- หน้าที่ 1: รับ log จากเครื่อง แล้วส่งต่อเข้า webhook จริง ----------
async function relayEvent(deviceCode, rawBody) {
  const device = DEVICES.find((d) => d.deviceCode === deviceCode);
  if (!device) return { result: 0, message: "unknown device (ack anyway)" };

  const url = `${CLOUD_BASE_URL}/api/playland/acs/event?device=${encodeURIComponent(deviceCode)}&secret=${encodeURIComponent(device.secret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    return json; // ส่งคำตอบจากเว็บจริงกลับไปที่เครื่องตรงๆ (รวม openGate ของ QR ด้วย)
  } catch (e) {
    log(`⚠️ [${deviceCode}] ส่ง log เข้าเว็บไม่สำเร็จ (จะให้เครื่องส่งซ้ำ):`, e.message);
    return { result: 1, message: "cloud unreachable — retry later" }; // 1 = เครื่องจะส่งซ้ำ ข้อมูลไม่หาย
  }
}

const server = http.createServer((req, res) => {
  const match = req.url.match(/^\/relay\/([^/?]+)/);
  if (req.method !== "POST" || !match) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "playland-agent" }));
  }
  const deviceCode = decodeURIComponent(match[1]);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const j = JSON.parse(body);
      const short = JSON.stringify(j, (_k, v) => (typeof v === "string" && v.length > 80 ? `${v.slice(0, 40)}…(${v.length} ตัวอักษร)` : v));
      log(`📥 [${deviceCode}] เหตุการณ์จากเครื่อง: ${short.slice(0, 700)}`);
    } catch {
      log(`📥 [${deviceCode}] เหตุการณ์จากเครื่อง (ไม่ใช่ JSON, ${body.length} ไบต์): ${body.slice(0, 200)}`);
    }
    const reply = await relayEvent(deviceCode, body);
    log(`📤 [${deviceCode}] เว็บตอบกลับ: ${JSON.stringify(reply).slice(0, 300)}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
});

// ---------- หน้าที่ 2: ถามคิว face-sync ทุก N วิ แล้วไปทำที่เครื่องจริง ----------
async function processFaceSyncQueue(device) {
  const pollUrl = `${CLOUD_BASE_URL}/api/playland/acs/agent/face-sync?device=${encodeURIComponent(device.deviceCode)}&secret=${encodeURIComponent(device.secret)}`;
  let jobs;
  try {
    const res = await fetch(pollUrl, { signal: AbortSignal.timeout(8_000) });
    ({ jobs } = await res.json());
  } catch (e) {
    log(`⚠️ [${device.deviceCode}] poll คิวไม่สำเร็จ:`, e.message);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  for (const job of jobs) {
    let ok = false;
    let error;
    try {
      if (job.type === "REGISTER") {
        if (!job.photoBase64) throw new Error("ไม่มีรูป (R2 อ่านไม่ได้)");
        const today = new Date().toLocaleDateString("sv-SE");
        const nextYear = new Date(Date.now() + 365 * 864e5).toLocaleDateString("sv-SE");
        const check = await deviceCall(device, "checkFacePicture", { data: { register_base64: job.photoBase64 } });
        if (check.result !== 0) throw new Error(`รูปไม่ผ่าน: ${check.message}`);
        const add = await deviceCall(device, "addDeviceWhiteList", {
          totalnum: 1,
          currentnum: 1,
          data: {
            usertype: "white",
            employee_number: job.memberId,
            name: job.name || job.memberId,
            peoplestartdate: today,
            peopleenddate: nextYear,
            passAlgo: false,
            TimeGroupId: 0,
            register_base64: job.photoBase64,
          },
        });
        if (add.result !== 0) throw new Error(add.message || "addDeviceWhiteList failed");
        ok = true;
      } else if (job.type === "DELETE") {
        const del = await deviceCall(device, "deleteDeviceWhiteList", {
          data: { employee_number: job.memberId, usertype: "white" },
        });
        if (del.result !== 0) throw new Error(del.message || "deleteDeviceWhiteList failed");
        ok = true;
      }
    } catch (e) {
      error = e.message;
    }

    log(
      ok ? `✅ [${device.deviceCode}] ${job.type} ${job.memberId} สำเร็จ` : `❌ [${device.deviceCode}] ${job.type} ${job.memberId} ล้มเหลว: ${error}`,
    );

    try {
      await fetch(`${CLOUD_BASE_URL}/api/playland/acs/agent/face-sync/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: device.deviceCode, secret: device.secret, jobId: job.jobId, type: job.type, ok, error }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (e) {
      log(`⚠️ [${device.deviceCode}] รายงานผล job ${job.jobId} ไม่สำเร็จ:`, e.message);
    }
  }
}

// ---------- หน้าที่ 3: คิวพิมพ์สายรัด (NIIMBOT K2 ต่อ USB กับเครื่องนี้) ----------
let printBusy = false;

function printerFetch(printer, path, init = {}) {
  return fetch(`${CLOUD_BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), "x-printer-code": printer.code, "x-printer-secret": printer.secret },
    signal: AbortSignal.timeout(8_000),
  });
}

async function processPrintQueue(printer, k2) {
  if (printBusy) {
    // กำลังพิมพ์อยู่: ไม่รับงานใหม่ แต่ยังบอกเว็บว่าออนไลน์ (ไม่งั้นแคชเชียร์เห็นเครื่องดับระหว่างพิมพ์ ~45 วิ)
    printerFetch(printer, "/api/playland/print/agent/jobs?heartbeat=1").catch(() => {});
    return;
  }
  printBusy = true;
  try {
    let job;
    try {
      const res = await printerFetch(printer, "/api/playland/print/agent/jobs");
      if (!res.ok) {
        log(`⚠️ [${printer.code}] poll คิวพิมพ์ไม่สำเร็จ HTTP ${res.status}`);
        return;
      }
      ({ job } = await res.json());
    } catch (e) {
      log(`⚠️ [${printer.code}] poll คิวพิมพ์ไม่สำเร็จ:`, e.message);
      return;
    }
    if (!job) return;

    log(`🖨️ [${printer.code}] รับงานพิมพ์ ${job.jobId} (ครั้งที่ ${job.attempt}) ${JSON.stringify(job.meta ?? {})}`);
    const beat = setInterval(() => printerFetch(printer, "/api/playland/print/agent/jobs?heartbeat=1").catch(() => {}), 5_000);
    let ok = false;
    let error;
    try {
      await k2.printWristbandBitmap(Buffer.from(job.bitmapBase64, "base64"), { serialPath: K2_SERIAL_PATH, log: (m) => log(`   ${m}`) });
      ok = true;
    } catch (e) {
      error = e.message;
    }
    clearInterval(beat);
    log(ok ? `✅ [${printer.code}] พิมพ์งาน ${job.jobId} สำเร็จ` : `❌ [${printer.code}] พิมพ์งาน ${job.jobId} ล้มเหลว: ${error}`);

    // รายงานผลให้ได้ (งานพิมพ์ออกไปแล้ว ถ้าลืมรายงาน จะถูกคิวส่งกลับมาพิมพ์ซ้ำ)
    for (let i = 0; i < 4; i++) {
      try {
        const r = await printerFetch(printer, "/api/playland/print/agent/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.jobId, ok, error }),
        });
        if (r.ok) break;
      } catch (e) {
        log(`⚠️ [${printer.code}] รายงานผลงาน ${job.jobId} ไม่สำเร็จ (ครั้งที่ ${i + 1}):`, e.message);
      }
      await sleep(2_000);
    }
  } finally {
    printBusy = false;
  }
}

// ---------- start ----------
server.listen(AGENT_PORT, () => log(`🚀 playland-agent ฟังอยู่ที่ http://${AGENT_IP}:${AGENT_PORT} (${DEVICES.length} เครื่อง)`));

for (const d of DEVICES) bindCallback(d);
setInterval(() => DEVICES.forEach(bindCallback), REBIND_INTERVAL_MS);
setInterval(() => DEVICES.forEach(processFaceSyncQueue), POLL_INTERVAL_MS);

if (PRINTERS.length > 0) {
  const k2 = await import("./k2.js"); // โหลด serialport เฉพาะเครื่องที่ตั้งเครื่องพิมพ์ไว้
  log(`🖨️ เปิดคิวพิมพ์สายรัด: ${PRINTERS.map((p) => p.code).join(", ")}`);
  setInterval(() => PRINTERS.forEach((p) => processPrintQueue(p, k2)), PRINT_POLL_INTERVAL_MS);
}

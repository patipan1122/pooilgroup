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
//      แล้วไปทำที่เครื่องจริงผ่าน LAN จากนั้นรายงานผลกลับ
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
    const reply = await relayEvent(deviceCode, body);
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

// ---------- start ----------
server.listen(AGENT_PORT, () => log(`🚀 playland-agent ฟังอยู่ที่ http://${AGENT_IP}:${AGENT_PORT} (${DEVICES.length} เครื่อง)`));

for (const d of DEVICES) bindCallback(d);
setInterval(() => DEVICES.forEach(bindCallback), REBIND_INTERVAL_MS);
setInterval(() => DEVICES.forEach(processFaceSyncQueue), POLL_INTERVAL_MS);

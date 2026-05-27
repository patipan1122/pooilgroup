#!/usr/bin/env node
// Mock ACS device · simulate face + QR scan webhooks against our handler.
// Run: node scripts/acs-mock-device.mjs <BASE_URL> <device_code> <secret> <kind> [arg]
//
// Examples:
//   node scripts/acs-mock-device.mjs http://localhost:3000 D-123 mysecret heartbeat
//   node scripts/acs-mock-device.mjs http://localhost:3000 D-123 mysecret qr PW-A3F9K2BC7
//   node scripts/acs-mock-device.mjs http://localhost:3000 D-123 mysecret face EMP-001
//   node scripts/acs-mock-device.mjs http://localhost:3000 D-123 mysecret qr PW-NOTREAL  # expect deny
//
// Useful before USD 239 device arrives · validates that:
//   • webhook handler accepts our payload shape (adjust if Lily ships different field names)
//   • QR-scan replies with {result:0, openGate:0|1, message:"..."}
//   • face/heartbeat events still ack as before

import { randomUUID } from "node:crypto";

const [baseUrl, deviceCode, secret, kind, arg] = process.argv.slice(2);
if (!baseUrl || !deviceCode || !secret || !kind) {
  console.error("usage: node scripts/acs-mock-device.mjs <BASE_URL> <device_code> <secret> <heartbeat|face|qr> [arg]");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/api/playland/acs/event?device=${encodeURIComponent(deviceCode)}&secret=${encodeURIComponent(secret)}`;
const now = new Date().toISOString().replace("T", " ").slice(0, 19);

let payload;
switch (kind) {
  case "heartbeat":
    payload = { id: randomUUID(), Mac_addr: deviceCode, time: now, resultStatus: 1, heartbeat: 1 };
    break;
  case "face":
    payload = {
      id: randomUUID(),
      Mac_addr: deviceCode,
      time: now,
      employee_number: arg ?? "EMP-001",
      name: "Mock Member",
      inout: 1,
      IdentifyType: 0,
      resultStatus: 1,
    };
    break;
  case "qr":
    if (!arg) { console.error("qr requires a code argument · e.g. PW-A3F9K2BC7"); process.exit(1); }
    // Field name `qrCode` is our stub guess · adapter accepts qrCode/qr/QRCode/barcode
    payload = {
      id: randomUUID(),
      Mac_addr: deviceCode,
      time: now,
      qrCode: arg,
      inout: 1,
      resultStatus: 1,
    };
    break;
  default:
    console.error(`unknown kind: ${kind} · use heartbeat|face|qr`);
    process.exit(1);
}

console.log(`→ POST ${url}`);
console.log(`→ payload`, JSON.stringify(payload, null, 2));

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const text = await res.text();
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }
console.log(`← ${res.status}`, parsed);

if (kind === "qr") {
  const opens = parsed && typeof parsed === "object" && (parsed.openGate === 1 || parsed.openGate === true);
  console.log(opens ? "✅ gate would OPEN" : "🚫 gate would STAY CLOSED");
}

process.exit(res.ok ? 0 : 1);

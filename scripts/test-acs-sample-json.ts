/**
 * Sample-JSON parser test for ACS device events — runs WITHOUT a real device,
 * a DB, or a running server. Feeds realistic doc-2 §2.6.1 payloads into the
 * adapter's normalizeEvent() and checks the decoded ACSEvent.
 *
 * Run:  npx tsx scripts/test-acs-sample-json.ts
 *
 * When Lily sends the real sample JSON, paste it into SAMPLES below and re-run
 * to confirm our parser handles the actual device output before hardware ships.
 */

import { acsAutoAdapter } from "@/lib/playland/acs/acs-auto-adapter";
import type { ACSEvent } from "@/lib/playland/acs/types";

type Expect = Partial<Pick<ACSEvent, "type" | "direction" | "faceId" | "qrCode">> & {
  shouldBeNull?: boolean;
};

interface Case {
  name: string;
  payload: unknown;
  expect: Expect;
}

const SAMPLES: Case[] = [
  {
    name: "Face match · member entering (doc-2 §2.6.1)",
    payload: {
      id: "evt-0001-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 14:23:45",
      devicename: "Front gate",
      location: "Lobby",
      inout: 1,
      employee_number: "member-abc-123",
      name: "คุณแม่ใจดี",
      IdentifyType: 0,
      resultStatus: 1,
      face_base64: "/9j/4AAQSkZJRg...",
      temperature: "36.5",
    },
    expect: { type: "recognized", direction: "in", faceId: "member-abc-123", qrCode: null },
  },
  {
    name: "Face match · member exiting (inout=0)",
    payload: {
      id: "evt-0002-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 16:10:00",
      inout: 0,
      employee_number: "member-abc-123",
      IdentifyType: 0,
      resultStatus: 1,
    },
    expect: { type: "recognized", direction: "out", faceId: "member-abc-123" },
  },
  {
    name: "Stranger · unregistered face (resultStatus=0)",
    payload: {
      id: "evt-0003-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 14:30:00",
      inout: 1,
      IdentifyType: 0,
      resultStatus: 0,
      face_base64: "/9j/4AAQSkZJRg...",
    },
    expect: { type: "stranger", direction: "in", faceId: null },
  },
  {
    name: "Blacklist hit (IdentifyType=1)",
    payload: {
      id: "evt-0004-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 14:31:00",
      inout: 1,
      IdentifyType: 1,
      resultStatus: 1,
    },
    expect: { type: "stranger", direction: "in" },
  },
  {
    name: "QR scan · visitor ticket (field: qrCode)",
    payload: {
      id: "evt-0005-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 14:35:00",
      inout: 1,
      qrCode: "PL-25-000123",
    },
    expect: { type: "qr_scan", direction: "in", qrCode: "PL-25-000123" },
  },
  {
    name: "QR scan · alternate field name (barcode)",
    payload: {
      id: "evt-0006-uuid",
      Mac_addr: "DA:8B:11:17:23:3B",
      time: "2026-05-27 14:36:00",
      inout: 1,
      barcode: "PL-25-000456",
    },
    expect: { type: "qr_scan", direction: "in", qrCode: "PL-25-000456" },
  },
  {
    name: "String-typed inout/resultStatus (device sends strings)",
    payload: {
      id: "evt-0007-uuid",
      time: "2026-05-27 14:40:00",
      inout: "1",
      employee_number: 99887766,
      IdentifyType: 0,
      resultStatus: "1",
    },
    expect: { type: "recognized", direction: "in", faceId: "99887766" },
  },
  {
    name: "Heartbeat / no id → must return null (route then acks)",
    payload: { currentTime: "2026-05-27 14:41:00", ip: "192.168.1.50", personCount: 12, SN: "C108LD-001" },
    expect: { shouldBeNull: true },
  },
  {
    name: "Garbage payload → null",
    payload: "not even an object",
    expect: { shouldBeNull: true },
  },
];

function check(c: Case): { pass: boolean; got: string } {
  const ev = acsAutoAdapter.normalizeEvent(c.payload);
  if (c.expect.shouldBeNull) {
    return { pass: ev === null, got: ev === null ? "null ✓" : JSON.stringify(ev) };
  }
  if (!ev) return { pass: false, got: "null (expected an event)" };

  const checks: boolean[] = [];
  if (c.expect.type !== undefined) checks.push(ev.type === c.expect.type);
  if (c.expect.direction !== undefined) checks.push(ev.direction === c.expect.direction);
  if (c.expect.faceId !== undefined) checks.push(ev.faceId === c.expect.faceId);
  if (c.expect.qrCode !== undefined) checks.push(ev.qrCode === c.expect.qrCode);

  const pass = checks.every(Boolean);
  const got = `type=${ev.type} dir=${ev.direction} faceId=${ev.faceId ?? "—"} qr=${ev.qrCode ?? "—"}`;
  return { pass, got };
}

let passed = 0;
let failed = 0;
console.log("\n=== ACS sample-JSON parser test (doc-2 §2.6.1) ===\n");
for (const c of SAMPLES) {
  const { pass, got } = check(c);
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  ${c.name}`);
  console.log(`         → ${got}`);
  if (!pass) {
    console.log(`         expected: ${JSON.stringify(c.expect)}`);
  }
}
console.log(`\n--- ${passed} passed · ${failed} failed · ${SAMPLES.length} total ---\n`);
process.exit(failed === 0 ? 0 : 1);

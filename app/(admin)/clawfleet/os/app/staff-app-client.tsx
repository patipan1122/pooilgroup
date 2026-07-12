"use client";
/**
 * ตู้คีบ OS — แอปพนักงาน (หน้าบ้าน) · the money-collection wizard.
 *
 * One <StaffApp/> rendered TWICE:
 *  - desktop (lg+): inside <PhoneFrame> on a radial-gradient bg + left explainer column.
 *  - mobile (<lg): bare, full-screen (fills viewport) so a real phone shows it edge-to-edge.
 *
 * REAL vs DEMO wiring (mirrors app/(admin)/clawfleet/v2/collect/collect-group-client.tsx):
 *  - REAL machine (id NOT starting "demo-"): startBranchSession({branchId}) →
 *    submitBranchEvent({sessionId, machineId, meters, stock, cash, 5 photo urls}) →
 *    closeBranchSession({sessionId}). The server runs the real 3-way anti-cheat.
 *  - DEMO machine (id "demo-…" or no DB data): simulate locally (optimistic), no server call.
 *
 * Money math here is CLIENT-SIDE DISPLAY ONLY (live reconcile preview). The authoritative
 * anti-cheat fires server-side in closeBranchSession.
 *
 * Photos are OPTIONAL (CEO 2026-06-29 "ถ่ายได้-ข้ามได้"): each photo slot uses the real
 * <PhotoCaptureButton> (1-tap camera → resize → upload R2 → returns a real url). Taking a
 * photo stores its R2 url in state; skipping leaves "". A missing photo NEVER blocks submit
 * — only a soft hint. The server schema now accepts url | "" | undefined, so on a REAL submit
 * we send the captured url (or "" when skipped). Backend column is String? (nullable).
 */

import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, ChevronRight, ChevronLeft, Inbox, Check, X, Camera, PackageOpen, ImageDown, History } from "lucide-react";
import { PhoneFrame, EmptyState } from "@/components/clawfleet/os/kit";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import {
  startBranchSession,
  submitBranchEvent,
  closeBranchSession,
  renameMachineNickname,
} from "@/lib/clawfleet/actions";
import { createRepairTicket } from "@/lib/clawfleet/repair-actions";
import { submitStockCount, confirmShipmentReceived, returnDollsToStock } from "@/lib/clawfleet/stock-actions";
import { confirmTransfer } from "@/lib/dc/transfer-actions";
import type { RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import type { CfReceivedDoc } from "@/lib/clawfleet/stock-queries";
// bigfeature — 4 mobile components (N1/N3/N5/R4) + goods-receipt (N6)
import { BaselineForm } from "@/components/clawfleet/BaselineForm";
import { MismatchGate } from "@/components/clawfleet/MismatchGate";
import { ProductCountCard } from "@/components/clawfleet/ProductCountCard";
import { BranchStockPicker } from "@/components/clawfleet/BranchStockPicker";
import type {
  GroupCollectBranch,
  CollectSku,
  GroupMachine,
} from "@/lib/clawfleet/group-data";

/* ─────────────────────────── bigfeature prop types (from page loaders) ─────────────────────────── */
// สินค้าในคลังสาขา (N3 นับสต๊อก · R4 picker เติม) — ตัดจาก CfStockProductRow เหลือที่ mobile ใช้
export type BranchStockProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  warehouse: number; // คงคลังสาขา (ไม่รวมในตู้)
};
// ใบกระจายขาเข้าที่ยังไม่รับ (N6 รับสินค้า) — mirror CfInboundDeliveryRow (+lineId สำหรับ confirm)
//   source = write path ที่ปุ่มกดรับต้อง route ไป (คนละ server action · คนละ idempotency guard):
//     "cf_delivery" → confirmShipmentReceived  ·  "dc_transfer" → confirmTransfer(transferId)
export type InboundSource = "cf_delivery" | "dc_transfer";
export type InboundDelivery = {
  id: string;
  status: string;
  itemsCount: number;
  unitsCount: number;
  // source ละไว้/undefined → ถือเป็น "cf_delivery" (พาธเดิม · เช่น LIFF ที่ surface แค่ cfDelivery) →
  //   ปุ่มกดรับ route ไป confirmShipmentReceived. "dc_transfer" เท่านั้นที่ route ไป confirmTransfer.
  source?: InboundSource;
  transferId?: string; // มีเฉพาะ source="dc_transfer" (ใบโอนจากคลังกลาง DC)
  // F1 · imageUrl ต่อบรรทัด (รูปสินค้า · URL เต็ม/null) → thumbnail บนการ์ดรับ
  lines: Array<{ lineId: string; productId: string; productName: string; qty: number; receivedQty: number; imageUrl?: string | null }>;
};
// WAVE-3b · คลัง (ห้องเก็บ) ของสาขา ที่ยัง active — ขับ picker เติม (R4) + นับสต๊อก (N3).
// picker โชว์เฉพาะเมื่อสาขามี >1 ห้อง (single-warehouse = ไม่มี picker · default คลังหลักเหมือนเดิม).
export type BranchWarehouse = { id: string; name: string; isMain: boolean };
// 🆕 ตุ๊กตาที่ "อยู่ในตู้ตอนนี้" (ราย SKU) — ขับ sheet คืนตุ๊กตาเข้าคลัง (return-dolls).
// qty มาจาก server ledger (|Σ machineId=ตู้|) = เลขที่ server จะ enforce ตอนคืน (ไม่ใช่ client เดา).
export type InMachineDoll = {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  qty: number; // ในตู้ตอนนี้ (ตัว)
};

// N3 · client idempotency key (crypto.randomUUID เมื่อมี · fallback timestamp+rand)
function genClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 🆕 2026-07-11 · เติมตุ๊กตา "หลาย SKU" ต่อตู้ (CEO: 1 ตู้มีได้หลายตัว · เลือกจากคลัง · ระบุกี่ตัว/ตัว).
// 1 ไลน์ = SKU 1 ตัว + จำนวน. server รับใน refillLines[] → หัก 1 แถว/ไลน์ · total = Σ qty.
type RefillLine = {
  productId: string; // UUID สินค้าคลังสาขา (BranchStockProduct.id)
  name: string; // ชื่อสินค้า (โชว์บนการ์ด · ไม่ส่ง server)
  qty: number; // จำนวนที่เติม (>0 เมื่อจะส่ง · 0 = ยังไม่ระบุ)
};

// N5 · payload ที่ส่งเข้า submitBranchEvent — เก็บไว้ resubmit พร้อม shortReason เมื่อ verdict=SHORT
type SubmitBranchEventArgs = {
  sessionId: string;
  machineId: string;
  coinMeterAfter: number;
  dollMeterAfter: number;
  cashCountedCents: number;
  stockBefore: number;
  refillQty: number;
  stockAfter: number;
  refillProductId?: string;
  // 🆕 เติมหลาย SKU — 1 แถว/ไลน์ · server ใช้ Σ qty เป็น total (แทน refillQty/refillProductId เดิม).
  refillLines?: { productId: string; qty: number; warehouseId?: string }[];
  // WAVE-3b · R4 · ห้องที่หยิบของมาเติม (null/undefined = คลังหลัก ตาม INVARIANT). ส่งเฉพาะสาขา >1 ห้อง.
  warehouseId?: string;
  photoCoinMeterUrl: string;
  photoPrizeMeterUrl: string;
  photoStockBeforeUrl: string;
  photoStockAfterUrl: string;
  photoCashUrl: string;
  shortReason?: string;
};

/* ─────────────────────────── demo fallback (no real DB) ────────────────────────── */
type AppMachine = {
  id: string;
  code: string;
  nickname: string | null;
  branch: string;
  zone: string;
  branchId: string;
  // last-round reference numbers (จากระบบ)
  lastStock: number;
  lastDollMeter: number;
  lastCoinMeter: number;
  product: string;
  // N1 · ตู้ยังไม่ตั้ง baseline (AWAITING_SETUP ⚪) → route ไปฟอร์มตั้งค่าครั้งแรกแทน wizard 6 ขั้น
  awaitingSetup: boolean;
};

const DEMO_BRANCH_ID = "demo-branch-rs";
const DEMO_SKUS: CollectSku[] = [
  { id: "demo-sku-1", sku: "KT-01", name: "ซานริโอ้ คิตตี้" },
  { id: "demo-sku-2", sku: "BR-01", name: "หมีบราวน์ L" },
  { id: "demo-sku-3", sku: "MJ-01", name: "โมจิหมีขาว" },
  { id: "demo-sku-4", sku: "KM-01", name: "คุมะ ไซส์ M" },
];

const DEMO_MACHINES: AppMachine[] = [
  { id: "demo-RS-03", code: "RS-03", nickname: null, branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 10, lastDollMeter: 105, lastCoinMeter: 210, product: "ซานริโอ้ คิตตี้", awaitingSetup: false },
  { id: "demo-RS-04", code: "RS-04", nickname: null, branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 12, lastDollMeter: 88, lastCoinMeter: 540, product: "โมจิหมีขาว", awaitingSetup: false },
  { id: "demo-RS-07", code: "RS-07", nickname: null, branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 9, lastDollMeter: 150, lastCoinMeter: 300, product: "หมีบราวน์ L", awaitingSetup: false },
  { id: "demo-RS-05", code: "RS-05", nickname: null, branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 11, lastDollMeter: 120, lastCoinMeter: 410, product: "คุมะ ไซส์ M", awaitingSetup: false },
  { id: "demo-BK-02", code: "BK-02", nickname: null, branch: "บางแค", zone: "โซน C", branchId: DEMO_BRANCH_ID, lastStock: 8, lastDollMeter: 212, lastCoinMeter: 880, product: "หมีน้ำตาล S", awaitingSetup: false },
  { id: "demo-LP-01", code: "LP-01", nickname: null, branch: "ลาดพร้าว", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 7, lastDollMeter: 64, lastCoinMeter: 150, product: "ซานริโอ้ คิตตี้", awaitingSetup: false },
];

/** flatten real Branch>Group>Claw → a flat machine route (CLAW only). */
function flattenReal(branches: GroupCollectBranch[], awaitingSetupIds: Set<string>): AppMachine[] {
  const out: AppMachine[] = [];
  for (const b of branches) {
    for (const g of b.groups) {
      for (const m of g.claws) {
        out.push({
          id: m.id,
          code: m.code,
          // GroupMachine.name = nickname ?? code → nickname จริงเมื่อ name ต่างจาก code
          nickname: m.name && m.name !== m.code ? m.name : null,
          branch: b.name,
          zone: g.name,
          branchId: b.id,
          lastStock: m.lastDollStock,
          lastDollMeter: m.lastDollMeter,
          lastCoinMeter: m.lastCoinMeter,
          product: "",
          awaitingSetup: awaitingSetupIds.has(m.id),
        });
      }
    }
  }
  return out;
}

const isDemo = (id: string) => id.startsWith("demo-");
const CASH_PER_PLAY = 10; // ฿/ครั้ง — ⚠️ สมมติ (ราคาจริงต่อตู้ยังไม่ส่งมาฝั่ง client) → preview ADVISORY

/* ─────────────────────────── draft offline persistence ───────────────────────────
 * ร่างที่นับ+ถ่ายรูปแล้ว รอกรอกมิเตอร์ ต้องรอด refresh / LINE ปิด webview / สลับแอป
 * (เดิมอยู่ใน React state อย่างเดียว → หาย → พนักงานต้องเดินกลับไปนับใหม่).
 * เก็บลง localStorage แยกตาม org + พนักงานที่ล็อกอิน (กันร่างของคนอื่นปน).
 */
const DRAFTS_NS = "clawos:staff-drafts";
function draftsKey(orgId: string, userName: string): string {
  // namespace ต่อ org + ผู้ใช้ (userName = ตัวระบุพนักงานที่ล็อกอิน · normalize ช่องว่าง)
  const who = (userName || "anon").trim() || "anon";
  return `${DRAFTS_NS}:${orgId || "org"}:${who}`;
}
function loadDrafts(key: string): Record<string, Draft> {
  if (typeof window === "undefined") return {}; // SSR guard
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, Draft>;
  } catch {
    return {}; // JSON เสีย/quota → เริ่มว่าง (ดีกว่า crash)
  }
}
function saveDrafts(key: string, drafts: Record<string, Draft>): void {
  if (typeof window === "undefined") return; // SSR guard
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    /* quota/private-mode → เงียบ (persistence เป็น best-effort · ไม่ให้ล้ม flow) */
  }
}

/* ─────────────────────────── WIP autosave (กันข้อมูลหายระหว่างกรอก) ───────────────────────────
 * TASK A · ระหว่างพนักงานเดิน wizard 4 ขั้น (นับ/เติม/มิเตอร์/เงินสด) ข้อมูลอยู่ใน React state อย่างเดียว.
 * submit ล้ม / สลับแอป / refresh → หายหมด. WIP = snapshot เบา ๆ ต่อ (session+machine) autosave ทุกครั้งที่เปลี่ยน.
 * ต่างจาก "drafts" (deferred meter · เก็บตอนกด "บันทึกค้าง") — WIP เป็น safety net อัตโนมัติ · draft ชนะเสมอถ้ามีทั้งคู่.
 * key = clawos:wip:v1:${sessionId}:${machineId} (แยกต่อรอบ+ตู้). ไม่ persist ตอน demo (ไม่มี sessionId). */
const WIP_NS = "clawos:wip:v1";
function wipKey(sessionId: string, machineId: string): string {
  return `${WIP_NS}:${sessionId}:${machineId}`;
}
// snapshot เบา: form ทั้งก้อน (รวม refillLines) + ขั้นปัจจุบัน. รูปเก็บใน form? ไม่ — รูปคือ Photos (แยก)
// แต่ url รูปเป็น R2 string อยู่ใน state.photos → เก็บด้วยเพื่อ resume ไม่ต้องถ่ายซ้ำ.
type WipSnapshot = { form: Form; photos: Photos; step: number };
function saveWip(sessionId: string | null, machineId: string, snap: WipSnapshot): void {
  if (typeof window === "undefined" || !sessionId) return; // SSR + demo guard
  try {
    window.localStorage.setItem(wipKey(sessionId, machineId), JSON.stringify(snap));
  } catch {
    /* quota/private-mode → เงียบ (best-effort) */
  }
}
function loadWip(sessionId: string | null, machineId: string): WipSnapshot | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const raw = window.localStorage.getItem(wipKey(sessionId, machineId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const snap = parsed as Partial<WipSnapshot>;
    if (!snap.form || typeof snap.form !== "object" || typeof snap.step !== "number") return null;
    // กัน snapshot เก่า (ก่อนมี refillLines) พังตอน hydrate → เติม default ให้ครบ
    const form: Form = { ...snap.form, refillLines: Array.isArray(snap.form.refillLines) ? snap.form.refillLines : [] };
    const photos: Photos = snap.photos && typeof snap.photos === "object" ? { ...blankPhotos, ...snap.photos } : { ...blankPhotos };
    return { form, photos, step: snap.step };
  } catch {
    return null; // JSON เสีย → ทิ้ง (ดีกว่า crash)
  }
}
function clearWip(sessionId: string | null, machineId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    window.localStorage.removeItem(wipKey(sessionId, machineId));
  } catch {
    /* เงียบ */
  }
}

// counted/อ่านมิเตอร์เอง: null = "ยังไม่กรอก" (กันค่า default หลอก anti-cheat).
// server ต้องการ number → ก่อนส่งต้องกรอกครบ (gating), เราจึง coerce ตอน submit.
type Counted = number | null;

/* ─────────────────────────── wizard state ─────────────────────────── */
type Form = {
  last: number; // ตุ๊กตารอบก่อน (ระบบ · reference)
  left: Counted; // คงเหลือก่อนเติม (นับจริง)
  refill: Counted; // เติมกี่ตัว (นับจริง · fallback เมื่อไม่มี refillLines — สาขาไม่มีสต๊อก)
  // 🆕 เติมหลาย SKU — 1 ไลน์/SKU (เลือกจากคลังสาขา + จำนวน). ว่าง [] = ใช้ f.refill ตัวเดียว (fallback).
  // total เติม (พรีวิว + payload) = Σ lines.qty เมื่อมีไลน์ · = f.refill เมื่อไม่มี. money-safe: จอ = server.
  refillLines: RefillLine[];
  product: string;
  // R4 · productId ที่เลือกจาก BranchStockPicker (คลังสาขาจริง · UUID) — null = ยังไม่เลือก/ใช้ dropdown เดิม.
  // ส่งเข้า submitBranchEvent.refillProductId (server ตัดสต๊อก + upsert loadout). demo = null.
  refillProductId: string | null;
  // WAVE-3b · R4 · ห้อง (warehouse) ที่หยิบของมาเติม — null = คลังหลัก (default · เมื่อสาขามี ≤1 ห้อง จะเป็น null เสมอ).
  // ส่งเข้า submitBranchEvent.warehouseId (server ตัดสต๊อกจากห้องที่เลือก). picker โผล่เฉพาะสาขา >1 ห้อง.
  refillWarehouseId: string | null;
  category: string;
  price: Counted; // ราคาขาย (กรอกเอง)
  // meters
  dollPrev: number; // รอบก่อน (ระบบ · reference)
  dollGear: Counted; // อ่านมิเตอร์เอง
  dollDigi: Counted;
  coinPrev: number; // รอบก่อน (ระบบ · reference)
  coinGear: Counted;
  coinDigi: Counted;
  cash: Counted; // นับเงินจริง
};

/** field ที่พนักงานต้องนับ/อ่านเอง (ไม่ใช่ค่าจากระบบ) */
const COUNTED_KEYS = ["left", "refill", "price", "dollGear", "dollDigi", "coinGear", "coinDigi", "cash"] as const;
type CountedKey = (typeof COUNTED_KEYS)[number];
/** ค่าที่ใช้คำนวณ: null → 0 (เฉพาะตอน "พรีวิว" เท่านั้น · submit จะ gate ไม่ให้ null หลุด) */
const n0 = (v: Counted): number => (v == null ? 0 : v);
const isFilled = (v: Counted): boolean => v != null;

// Each slot holds the R2 url returned by PhotoCaptureButton ("" = not taken / skipped).
type Photos = {
  before: string;
  after: string;
  dollGear: string;
  dollDigi: string;
  coinGear: string;
  coinDigi: string;
  cash: string;
};

type Draft = {
  machineId: string;
  code: string;
  branch: string;
  cash: number;
  dispensed: number;
  time: string;
  form: Form;
  photos: Photos; // เก็บ url รูปที่ถ่ายไว้ → resume แล้วไม่หาย (กันค้างเพราะถ่ายซ้ำไม่ได้)
  sessionId: string | null;
};

type WizardState = {
  step: number; // 0 = home, 1..6 = wizard steps
  machineId: string | null;
  form: Form;
  photos: Photos;
  // slot ที่ "ถ่ายแล้ว" (นับทันที · ยังไม่มี url เพราะ upload วิ่งเบื้องหลัง/retry).
  // ใช้ปลดล็อก gate photoRequired ทันทีที่ถ่าย — ไม่ให้ upload ล้มบล็อกพนักงานที่หน้างาน.
  photosCaptured: Photos;
  meterDeferred: boolean;
  resumed: boolean;
  configSent: boolean;
  // B1 · "รีบถ่ายรูปก่อน" — หน้ารวมช่องถ่ายรูปทุกช่องในที่เดียว (ถ่ายรัว ๆ) ก่อนกลับมากรอกเลข.
  // true = แสดง PhotoHubScreen แทน 6-step wizard (step ยังเก็บไว้ resume กลับได้). UI regroup อย่างเดียว.
  photoHub: boolean;
  sessionId: string | null; // real session id (null when demo / not started)
};

const blankPhotos: Photos = {
  before: "", after: "", dollGear: "", dollDigi: "",
  coinGear: "", coinDigi: "", cash: "",
};

// sentinel: "ถ่ายแล้วแต่ยังไม่มี url" (upload เบื้องหลัง/retry) — ใช้ใน photosCaptured เท่านั้น
// (photos จริงยังเก็บ url จาก R2). ปลดล็อก gate photoRequired ทันทีที่ถ่าย.
const CAPTURED_MARK = "captured";
/** map url ที่มีอยู่ → captured (ใช้ตอน resume ร่างที่มี url แล้ว) */
function markCaptured(p: Photos): Photos {
  const out = { ...blankPhotos };
  (Object.keys(p) as (keyof Photos)[]).forEach((k) => {
    out[k] = p[k] ? p[k] : "";
  });
  return out;
}

function formFor(m: AppMachine, skus: CollectSku[]): Form {
  const product = m.product || skus[0]?.name || "ตุ๊กตา";
  const demo = isDemo(m.id);
  // REAL: ช่องที่ต้องนับ/อ่านมิเตอร์เอง = ว่าง (null) → พนักงานต้องนับจริงก่อนไปต่อ.
  // DEMO: ใส่ค่าเดาไว้ให้เดิน flow ตัวอย่างได้ลื่น.
  return {
    last: m.lastStock,
    left: demo ? Math.max(0, m.lastStock - 5) : null,
    refill: demo ? 5 : null,
    refillLines: [], // 🆕 เริ่มว่าง — เพิ่มไลน์เมื่อสาขามีสต๊อก + ผู้ใช้เลือก SKU
    product,
    refillProductId: null,
    refillWarehouseId: null, // WAVE-3b · null = คลังหลัก (default) · ตั้งค่าเมื่อสาขา >1 ห้อง + ผู้ใช้เลือก
    category: "ลิขสิทธิ์",
    price: demo ? 250 : null,
    dollPrev: m.lastDollMeter,
    dollGear: demo ? m.lastDollMeter + 5 : null,
    dollDigi: demo ? m.lastDollMeter + 5 : null,
    coinPrev: m.lastCoinMeter,
    coinGear: demo ? m.lastCoinMeter + 30 : null,
    coinDigi: demo ? m.lastCoinMeter + 30 : null,
    cash: demo ? 300 : null,
  };
}

type Action =
  | { type: "open"; machine: AppMachine; skus: CollectSku[]; sessionId: string | null }
  | { type: "openPhotoHub"; machine: AppMachine; skus: CollectSku[]; sessionId: string | null } // B1 · เปิดตู้เข้าหน้า "ถ่ายรูปก่อน"
  | { type: "resume"; draft: Draft }
  // TASK A · คืน WIP snapshot ที่ autosave ไว้ (กันข้อมูลหายกลางคัน) — form+photos+step. draft ชนะ WIP.
  | { type: "hydrateWip"; snapshot: WipSnapshot }
  | { type: "next" }
  | { type: "back" }
  | { type: "home" }
  | { type: "skipMachine" } // ข้ามตู้เสีย 1 ตู้ · กลับหน้ารายการ แต่คง session สาขาไว้ (ตู้อื่นยังต้องเก็บ)
  | { type: "exitPhotoHub" } // B1 · จากหน้าถ่ายรูป → เข้า 6-step wizard ปกติ (กรอกเลขต่อ)
  | { type: "setForm"; key: keyof Form; value: number | string | null }
  // 🆕 เติมหลาย SKU — เพิ่ม/แก้จำนวน/ลบไลน์ · setRefillLines ใช้ตอน hydrate WIP (คืนทั้งชุด)
  | { type: "addRefillLine"; productId: string; name: string }
  | { type: "setRefillLineQty"; productId: string; qty: number }
  | { type: "removeRefillLine"; productId: string }
  | { type: "setRefillLines"; lines: RefillLine[] }
  | { type: "setPhoto"; key: keyof Photos; url: string }
  | { type: "capturePhoto"; key: keyof Photos } // ถ่ายแล้ว (นับทันที · ยังรอ url)
  | { type: "toggleDefer" }
  | { type: "fillMeterNow" }
  | { type: "sendConfig" }
  | { type: "setSession"; sessionId: string };

function reducer(s: WizardState, a: Action): WizardState {
  switch (a.type) {
    case "open":
      return {
        step: 1,
        machineId: a.machine.id,
        form: formFor(a.machine, a.skus),
        photos: { ...blankPhotos },
        photosCaptured: { ...blankPhotos },
        meterDeferred: false,
        resumed: false,
        configSent: false,
        photoHub: false,
        sessionId: a.sessionId,
      };
    case "openPhotoHub":
      // B1 · เปิดตู้เข้าหน้า "ถ่ายรูปก่อน" — เหมือน open แต่เริ่มที่ photoHub (ถ่ายรัว ๆ ก่อนกรอกเลข)
      return {
        step: 1,
        machineId: a.machine.id,
        form: formFor(a.machine, a.skus),
        photos: { ...blankPhotos },
        photosCaptured: { ...blankPhotos },
        meterDeferred: false,
        resumed: false,
        configSent: false,
        photoHub: true,
        sessionId: a.sessionId,
      };
    case "resume":
      return {
        step: 3,
        machineId: a.draft.machineId,
        form: { ...a.draft.form },
        // resumed: count already done · รูปที่ถ่ายไว้ถูกเก็บใน draft แล้ว → คืนกลับมา
        // (เดิมรูปหาย → ถ้านโยบายบังคับถ่ายจะ submit ไม่ได้ = ค้าง เพราะเดินจากตู้มาแล้ว)
        photos: { ...a.draft.photos },
        // มี url ในร่าง = ถือว่าถ่ายแล้ว (มาร์ค captured ให้ตรงกัน · กัน gate เด้งตอน resume)
        photosCaptured: markCaptured(a.draft.photos),
        meterDeferred: false,
        resumed: true,
        configSent: false,
        photoHub: false,
        sessionId: a.draft.sessionId,
      };
    case "hydrateWip":
      // TASK A · คืน WIP ที่ค้างไว้ทับ state ที่เพิ่ง open (คงตู้+session เดิม · แค่เติม form/photos/step กลับ).
      // step clamp 1..5 (ไม่คืนไป done/home · WIP เก็บเฉพาะระหว่างกรอก). photosCaptured มาร์คจาก url ที่มี.
      return {
        ...s,
        form: { ...a.snapshot.form },
        photos: { ...a.snapshot.photos },
        photosCaptured: markCaptured(a.snapshot.photos),
        step: Math.min(5, Math.max(1, a.snapshot.step)),
      };
    case "next":
      return { ...s, step: Math.min(6, s.step + 1) };
    case "back":
      return { ...s, step: s.step <= 1 ? 0 : s.step - 1 };
    case "home":
      return { ...s, step: 0, machineId: null, resumed: false, meterDeferred: false, photoHub: false, sessionId: null };
    case "exitPhotoHub":
      // B1 · จากหน้าถ่ายรูป → เข้า wizard ปกติที่ขั้น 1 (นับตุ๊กตา) · รูปที่ถ่ายไว้ยังอยู่ใน state
      return { ...s, photoHub: false, step: 1 };
    case "skipMachine":
      // ข้าม "ตู้เสียตู้เดียว" ≠ ปิดรอบสาขา: กลับหน้ารายการตู้ไปเก็บตู้ที่เหลือต่อ · คง sessionId
      // (backend session สาขายังเปิดค้างถูกต้อง · ตู้อื่นในสาขา reuse รอบเดิม · cron auto-close 24ชม
      //  ครอบเคสตู้สุดท้าย/รอบว่าง) — กัน orphan โดยไม่ null sessionId ทิ้งถ้ายังมีตู้อื่นต้องเก็บ.
      return { ...s, step: 0, machineId: null, resumed: false, meterDeferred: false, photoHub: false };
    case "setForm":
      return { ...s, form: { ...s.form, [a.key]: a.value } };
    case "addRefillLine": {
      // กัน SKU ซ้ำ — ถ้ามีไลน์ productId นี้แล้ว ไม่เพิ่มซ้ำ (merge = คงไลน์เดิม · ผู้ใช้ปรับ qty เอง)
      if (s.form.refillLines.some((l) => l.productId === a.productId)) return s;
      const line: RefillLine = { productId: a.productId, name: a.name, qty: 0 };
      return { ...s, form: { ...s.form, refillLines: [...s.form.refillLines, line] } };
    }
    case "setRefillLineQty":
      return {
        ...s,
        form: {
          ...s.form,
          refillLines: s.form.refillLines.map((l) =>
            l.productId === a.productId ? { ...l, qty: Math.max(0, a.qty) } : l,
          ),
        },
      };
    case "removeRefillLine":
      return {
        ...s,
        form: { ...s.form, refillLines: s.form.refillLines.filter((l) => l.productId !== a.productId) },
      };
    case "setRefillLines":
      return { ...s, form: { ...s.form, refillLines: a.lines } };
    case "setPhoto":
      // upload สำเร็จ → เก็บ url จริง + มาร์ค captured (เผื่อ setPhoto มาก่อน capture ในบางเส้นทาง)
      return { ...s, photos: { ...s.photos, [a.key]: a.url }, photosCaptured: { ...s.photosCaptured, [a.key]: a.url || s.photosCaptured[a.key] } };
    case "capturePhoto":
      // ถ่ายแล้ว (ยังไม่มี url) → มาร์ค captured เป็น sentinel "captured" เพื่อปลดล็อก gate ทันที
      return { ...s, photosCaptured: { ...s.photosCaptured, [a.key]: CAPTURED_MARK } };
    case "toggleDefer":
      return { ...s, meterDeferred: !s.meterDeferred };
    case "fillMeterNow":
      return { ...s, step: 3, meterDeferred: false };
    case "sendConfig":
      return { ...s, configSent: true };
    case "setSession":
      return { ...s, sessionId: a.sessionId };
    default:
      return s;
  }
}

const initialState: WizardState = {
  step: 0, machineId: null,
  form: formFor(DEMO_MACHINES[0], DEMO_SKUS),
  photos: { ...blankPhotos },
  photosCaptured: { ...blankPhotos },
  meterDeferred: false, resumed: false, configSent: false, photoHub: false, sessionId: null,
};

/* ─────────────────────────── public wrapper (renders twice) ─────────────────────────── */
// ประวัติการเก็บของฉัน (ของจริงจาก server · ดู page.tsx StaffHistoryRow)
// B3 · เพิ่ม branch/date/coinMeter → date picker ดูย้อนหลังได้ (เก็บที่ไหน · เลขมิเตอร์ที่กรอก).
// branch/date/coinMeter optional เพื่อ backward-compat (ถ้ามี caller เดิมส่งไม่ครบ ก็ไม่พัง).
export type StaffHistoryRow = {
  code: string;
  time: string;
  cashBaht: number;
  ok: boolean;
  branch?: string; // สาขาของตู้ (ช่วยจำว่าเก็บที่ไหน)
  date?: string; // YYYY-MM-DD ของรอบ (ตามเวลาไทย) — label เมื่อดูย้อนหลัง
  coinMeter?: number; // เลขมิเตอร์เหรียญที่บันทึกไว้ (หลักฐานตัวเลขที่กรอก)
};

type Props = {
  orgId: string;
  branches: GroupCollectBranch[];
  skus: CollectSku[];
  // นโยบายถ่ายรูป (จาก org settings) — true = บังคับถ่ายก่อนไปต่อ, false = ถ่ายได้-ข้ามได้
  photoRequired: boolean;
  // ชื่อพนักงานที่ล็อกอิน (โชว์ทักทาย) — "" = ไม่ทราบ → ใช้ default
  userName: string;
  // จำนวนตู้ที่ "ฉัน" เก็บเสร็จจริงวันนี้ (จาก cf_collection_events) → progress bar
  closedTodayCount: number;
  // ประวัติรอบที่ปิดจริง "ของวันที่เลือก" (ของฉัน) → panel "ประวัติของฉัน"
  history: StaffHistoryRow[];
  // B3 · วันที่ที่กำลังดูประวัติ (YYYY-MM-DD ตามเวลาไทย · default = วันนี้). ขับ date picker ในประวัติ.
  // optional default (วันนี้ client-side) กัน caller เดิมที่ยังไม่ส่ง.
  selectedDate?: string;
  // ตั๋วแจ้งซ่อมล่าสุดของฉัน (จาก listMyRecentRepairTickets) → โชว์ใน RepairPanel. optional default [] กัน build พัง.
  myRecentTickets?: RepairTicketRow[];
  // true = server กรอง route เหลือ "ตู้ที่มอบหมายให้ฉัน" แล้ว → โชว์หัวข้อ "ตู้ของฉันวันนี้ (N)".
  // false/ไม่ส่ง = แสดงทุกตู้ในสาขาเหมือนเดิม (จัดกลุ่มตามสาขา · Wave 2). optional default กัน build พัง.
  assignedOnly?: boolean;
  // N1 · id ตู้ที่ยังไม่ตั้ง baseline (AWAITING_SETUP) — HOME จะ route ตู้เหล่านี้ไปฟอร์มตั้งค่าครั้งแรก
  awaitingSetupIds?: string[];
  // N3/R4 · สินค้าคลังสาขา แยกตาม branchId (นับสต๊อก + picker เติม). optional default {} กัน build พัง.
  branchProducts?: Record<string, BranchStockProduct[]>;
  // N6 · ใบกระจายขาเข้าที่ยังไม่รับ แยกตาม branchId (หน้ารับสินค้า). optional default {}.
  inboundByBranch?: Record<string, InboundDelivery[]>;
  // F1 · ยอด "คลังตอนนี้" ต่อสินค้า แยกตาม branchId (productId → คงคลังสาขา) — โชว์ "คลังตอนนี้ N → หลังรับ N+x". optional default {}.
  onHandByBranch?: Record<string, Record<string, number>>;
  // F2 · ประวัติ "รับแล้ว" แยกตาม branchId (จาก ledger · READ-ONLY) — แท็บ "รับแล้ว" ในหน้ารับสินค้า. optional default {}.
  receivedByBranch?: Record<string, CfReceivedDoc[]>;
  // WAVE-3b · คลัง (ห้องเก็บ) active แยกตาม branchId — picker เติม (R4) + นับสต๊อก (N3).
  // สาขาที่มี >1 ห้อง → โชว์ picker · ≤1 ห้อง → ไม่โชว์ (default คลังหลัก). optional default {}.
  warehousesByBranch?: Record<string, BranchWarehouse[]>;
  // 🆕 ตุ๊กตาที่ "อยู่ในตู้ตอนนี้" แยกตาม machineId (ขับ sheet คืนตุ๊กตาเข้าคลัง). optional default {}.
  inMachineByMachine?: Record<string, InMachineDoll[]>;
  // 🆕 "ของว่างในคลัง" ต่อสินค้า แยกตาม branchId (คลัง − ในตู้) — โชว์ยอดคลังหลังคืน. optional default {}.
  netAvailableByBranch?: Record<string, Record<string, number>>;
};

// B3 · วันนี้ตามเวลาไทย (client-side fallback เมื่อ server ไม่ส่ง selectedDate) — YYYY-MM-DD
function clientTodayBangkokYmd(): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bkk.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function StaffAppClient({ orgId, branches, skus, photoRequired, userName, closedTodayCount, history, selectedDate, myRecentTickets = [], assignedOnly = false, awaitingSetupIds = [], branchProducts = {}, inboundByBranch = {}, warehousesByBranch = {}, onHandByBranch = {}, receivedByBranch = {}, inMachineByMachine = {}, netAvailableByBranch = {} }: Props) {
  // B3 · วันที่ที่ดูประวัติ (server default = วันนี้ · fallback client-side today)
  const viewDate = selectedDate || clientTodayBangkokYmd();
  const awaitingSet = useMemo(() => new Set(awaitingSetupIds), [awaitingSetupIds]);
  const realMachines = useMemo(() => flattenReal(branches, awaitingSet), [branches, awaitingSet]);
  const usingDemo = realMachines.length === 0;
  const machines = usingDemo ? DEMO_MACHINES : realMachines;
  const skuList = usingDemo || skus.length === 0 ? DEMO_SKUS : skus;
  // ในโหมด demo ไม่มี backend อัปโหลด → ปุ่มถ่ายถูก disable อยู่แล้ว, จึงไม่บังคับถ่าย (กันค้าง)
  const enforcePhoto = photoRequired && !usingDemo;

  // ONE StaffApp instance per render-slot. Each keeps its own local state, but the
  // desktop preview & mobile full-screen are different breakpoints — only one is
  // visible at a time, so independent state is fine (and avoids re-render coupling).
  const app = (
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} userName={userName} closedTodayCount={closedTodayCount} history={history} viewDate={viewDate} myRecentTickets={myRecentTickets} assignedOnly={assignedOnly} branchProducts={branchProducts} inboundByBranch={inboundByBranch} warehousesByBranch={warehousesByBranch} onHandByBranch={onHandByBranch} receivedByBranch={receivedByBranch} inMachineByMachine={inMachineByMachine} netAvailableByBranch={netAvailableByBranch} />
  );
  const appMobile = (
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} userName={userName} closedTodayCount={closedTodayCount} history={history} viewDate={viewDate} myRecentTickets={myRecentTickets} assignedOnly={assignedOnly} branchProducts={branchProducts} inboundByBranch={inboundByBranch} warehousesByBranch={warehousesByBranch} onHandByBranch={onHandByBranch} receivedByBranch={receivedByBranch} inMachineByMachine={inMachineByMachine} netAvailableByBranch={netAvailableByBranch} />
  );

  return (
    <div className="clawos-staffapp">
      {/* ── DESKTOP: explainer + phone frame on radial bg ── */}
      <div
        className="hidden lg:flex"
        style={{
          gap: 40,
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "20px 0",
          background: "radial-gradient(circle at 50% 0%, #ECEDF6 0%, #F5F6F8 60%)",
          borderRadius: 18,
          minHeight: 760,
        }}
      >
        <div style={{ maxWidth: 300, paddingTop: 60 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5", letterSpacing: 0.5, marginBottom: 10 }}>
            หน้าบ้าน · แอปพนักงาน
          </div>
          <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>
            พนักงานเก็บเงินหน้างาน
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#6B7280", margin: "0 0 18px" }}>
            หน้าจอนี้คือสิ่งที่พนักงานเห็นบนมือถือ ลองกดเลือกตู้แล้วเดินตามขั้นตอนเก็บเงินได้เลย —
            ระบบจะกระทบยอดมิเตอร์กับเงินสดอัตโนมัติ และเตือนทันทีถ้าตัวเลขไม่ตรง
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "นับตุ๊กตาก่อนเติม + ถ่ายรูปก่อนเติม",
              "เติม: ระบุสินค้า + จำนวน + ถ่ายรูปหลังเติม",
              "มิเตอร์ 4 ตัว (เฟือง+ดิจิตอล) ต้องขึ้นเท่ากัน — กันพลาด",
              "กรอกเงินสด → ระบบกระทบยอด — ตรง/ไม่ตรง",
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ width: 22, height: 22, flex: "0 0 22px", borderRadius: "50%", background: "#EEF0FE", color: "#4F46E5", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: "#454B54" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        <PhoneFrame>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>{app}</div>
        </PhoneFrame>
      </div>

      {/* ── MOBILE: same app, full-screen edge-to-edge ── */}
      <div
        className="lg:hidden"
        style={{ minHeight: "calc(100dvh - 56px)", display: "flex", flexDirection: "column", background: "#F5F6F8" }}
      >
        {appMobile}
      </div>
    </div>
  );
}

/* ─────────────────────────── inner app (defined once) ─────────────────────────── */
type StaffAppProps = {
  orgId: string;
  machines: AppMachine[];
  skus: CollectSku[];
  usingDemo: boolean;
  // true = บังคับถ่ายรูปก่อนกดถัดไป/ส่ง (org policy photoRequired)
  photoRequired: boolean;
  userName: string;
  closedTodayCount: number;
  history: StaffHistoryRow[];
  // B3 · วันที่ที่กำลังดูประวัติ (YYYY-MM-DD ตามเวลาไทย)
  viewDate: string;
  myRecentTickets: RepairTicketRow[];
  // true = route ถูกกรองเหลือ "ตู้ของฉัน" แล้ว (server) → HomeScreen โชว์หัวข้อ "ตู้ของฉันวันนี้"
  assignedOnly: boolean;
  // N3/R4 · สินค้าคลังสาขา แยกตาม branchId
  branchProducts: Record<string, BranchStockProduct[]>;
  // N6 · ใบกระจายขาเข้าที่ยังไม่รับ แยกตาม branchId
  inboundByBranch: Record<string, InboundDelivery[]>;
  // WAVE-3b · คลัง active แยกตาม branchId (picker เติม R4 + นับสต๊อก N3 · โชว์เมื่อ >1 ห้อง)
  warehousesByBranch: Record<string, BranchWarehouse[]>;
  // F1 · คลังตอนนี้ต่อสินค้า แยกตาม branchId · F2 · ประวัติรับแล้ว แยกตาม branchId
  onHandByBranch: Record<string, Record<string, number>>;
  receivedByBranch: Record<string, CfReceivedDoc[]>;
  // 🆕 ตุ๊กตาในตู้ตอนนี้ (แยกตาม machineId) + ของว่างในคลังต่อสินค้า (แยกตาม branchId) — sheet คืนตุ๊กตา
  inMachineByMachine: Record<string, InMachineDoll[]>;
  netAvailableByBranch: Record<string, Record<string, number>>;
};

// "stock" panel เดิม = นับสต๊อก (N3) · เพิ่ม "receive" (N6 รับสินค้า) เข้า quick-menu
type Panel = "history" | "repair" | "stock" | "receive" | "config" | "tour" | null;

function StaffApp({ orgId, machines, skus, usingDemo, photoRequired, userName, closedTodayCount, history, viewDate, myRecentTickets, assignedOnly, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch, inMachineByMachine, netAvailableByBranch }: StaffAppProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [panel, setPanel] = useState<Panel>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // ── offline persistence: ร่างต้องรอด refresh / LINE ปิด webview ──
  // demo ไม่บันทึกจริง → ไม่ persist (กันร่าง demo ค้างข้ามรอบ)
  const dkey = useMemo(() => draftsKey(orgId, userName), [orgId, userName]);
  const hydrated = useRef(false);
  // hydrate ครั้งเดียวตอน mount (SSR guard อยู่ใน loadDrafts) — คืนร่างที่ค้างไว้
  useEffect(() => {
    if (usingDemo) { hydrated.current = true; return; }
    setDrafts(loadDrafts(dkey));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dkey]);
  // persist ทุกครั้งที่ drafts เปลี่ยน (หลัง hydrate เสร็จ · กันเขียนทับด้วย {} ตอน mount)
  useEffect(() => {
    if (usingDemo || !hydrated.current) return;
    saveDrafts(dkey, drafts);
  }, [drafts, dkey, usingDemo]);
  // TASK A · WIP autosave — debounce timer (กันพิมพ์แล้วเขียนถี่) · เคลียร์ตอน unmount.
  const wipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (wipTimer.current) clearTimeout(wipTimer.current); }, []);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState(0);
  // ตู้ที่กำลังเปิดรอบ (กดแล้วรอ startBranchSession ~2-3 วิ) → โชว์สปินเนอร์บนตู้นั้น
  const [openingId, setOpeningId] = useState<string | null>(null);
  // ตู้ที่ "เสีย/อ่านมิเตอร์ไม่ได้ → แจ้งซ่อม & ข้าม" ในรอบนี้ (local เฉพาะเซสชันหน้าจอ · ไม่ persist)
  // ใช้ติดป้าย "แจ้งซ่อมแล้ว · ข้าม" ในรายการตู้ → พนักงานไม่วนกลับมาบังคับกรอกมิเตอร์ตู้ที่เสีย
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  // กำลังส่งแจ้งซ่อม-ข้าม (กดปุ่ม skip-broken ในขั้นมิเตอร์)
  const [skipPending, setSkipPending] = useState(false);
  // N1 · ตู้ที่กำลัง "ตั้งค่าครั้งแรก" (BaselineForm) — id หรือ null (ไม่อยู่ในโหมดตั้งค่า).
  // แยกจาก wizard state ปกติ (ตู้ awaitingSetup ข้าม 6-step ไปฟอร์ม baseline เลย).
  const [baselineMachineId, setBaselineMachineId] = useState<string | null>(null);
  // N5 · ด่านเงินไม่ตรง — เมื่อ submitBranchEvent คืน needsReason (verdict=SHORT) → เก็บ payload
  // เดิมไว้ resubmit พร้อม shortReason (ไม่ทำใหม่หมด · แค่เติมเหตุผล). null = ไม่มีด่าน.
  const [pendingShort, setPendingShort] = useState<SubmitBranchEventArgs | null>(null);
  // 🆕 คืนตุ๊กตาเข้าคลัง — ตู้ที่กำลังเปิด bottom-sheet คืน (null = ปิด). local เฉพาะหน้าจอ.
  const [returnMachineId, setReturnMachineId] = useState<string | null>(null);
  // FIX-1 · money-safe บันทึกค้าง: ถ้ากด "บันทึกค้าง" ก่อน upload รูปเสร็จ → ร่างจะเก็บรูปเป็น "" (หาย).
  // → กันไม่ให้ saveDraft ทำงานตราบใดที่ยังมีรูปอัปโหลดค้าง (photosCaptured มี แต่ photos ยังว่าง).
  // แต่ต้องมี "ทางออก": ถ้า upload ค้างนานเกิน (เน็ตตก/ล้ม) → หลัง ~8 วิ ปล่อยให้บันทึกได้ (offline-tolerant
  // ตามปรัชญา sentinel เดิม · ร่างจะเก็บ url ที่มาทันเท่านั้น · retry อัปโหลดวิ่งต่อเบื้องหลัง).
  const [allowSaveDespitePending, setAllowSaveDespitePending] = useState(false);

  const machine = useMemo(
    () => machines.find((m) => m.id === state.machineId) ?? null,
    [machines, state.machineId],
  );
  // N1 · ตู้ที่กำลังตั้งค่าครั้งแรก (lookup แยก · ไม่ผูก wizard state)
  const baselineMachine = useMemo(
    () => machines.find((m) => m.id === baselineMachineId) ?? null,
    [machines, baselineMachineId],
  );
  // R4 · สินค้าคลังของสาขา "ตู้ที่กำลังเก็บ" (สำหรับ picker เติม). ไม่มี → [] (picker โชว์ empty).
  const activeBranchProducts = useMemo(
    () => (machine ? branchProducts[machine.branchId] ?? [] : []),
    [branchProducts, machine],
  );
  // 🆕 net "ของบนชั้นจริง" ต่อสินค้า (คลัง − ในตู้) ของสาขาตู้ที่กำลังเก็บ — ให้ picker เติม clamp/โชว์ net
  // ให้ตรงกับที่ server enforce (guard เติม = net). ไม่มีใน map = ยังไม่เคยรับเข้า → 0.
  const activeRefillNet = useMemo(
    () => (machine ? netAvailableByBranch[machine.branchId] ?? {} : {}),
    [netAvailableByBranch, machine],
  );
  // WAVE-3b · R4 · คลัง (ห้อง) active ของสาขาตู้ที่กำลังเก็บ — ขับ picker "เติมจากคลัง".
  // picker โผล่เฉพาะเมื่อ >1 ห้อง (single-warehouse = ไม่มี picker · default คลังหลักเหมือนเดิม).
  const activeBranchWarehouses = useMemo(
    () => (machine ? warehousesByBranch[machine.branchId] ?? [] : []),
    [warehousesByBranch, machine],
  );
  // 🆕 คืนตุ๊กตา — ตู้ที่กำลังเปิด sheet + ตุ๊กตาในตู้ + "ของว่างในคลัง" ต่อสินค้าของสาขานั้น.
  const returnMachine = useMemo(
    () => machines.find((m) => m.id === returnMachineId) ?? null,
    [machines, returnMachineId],
  );
  const returnDolls = useMemo(
    () => (returnMachineId ? inMachineByMachine[returnMachineId] ?? [] : []),
    [inMachineByMachine, returnMachineId],
  );
  const returnNetAvailable = useMemo(
    () => (returnMachine ? netAvailableByBranch[returnMachine.branchId] ?? {} : {}),
    [netAvailableByBranch, returnMachine],
  );

  const f = state.form;

  /* ── TASK A · WIP autosave (debounce ~400ms) ──
   * เขียน snapshot form+photos+step ลง localStorage ทุกครั้งที่มีการเปลี่ยน ระหว่างอยู่ใน wizard (step 1-5).
   * ไม่ gate ด้วย upload-pending — เลข/ข้อความต้อง save ทันทีไม่ว่ารูปจะกำลังอัปหรือไม่ (url รูปที่มีแล้วก็ save ไปด้วย).
   * real machine + มี sessionId เท่านั้น (demo/ไม่มี session = ข้าม · saveWip guard ให้อยู่แล้ว). */
  useEffect(() => {
    if (usingDemo) return;
    const mid = state.machineId;
    const sid = state.sessionId;
    // เขียนเฉพาะระหว่างกรอก (1-5) · home(0)/done(6) ไม่ต้อง (submit สำเร็จจะเคลียร์ WIP เอง)
    if (!mid || !sid || state.step < 1 || state.step > 5) return;
    if (wipTimer.current) clearTimeout(wipTimer.current);
    const snap: WipSnapshot = { form: state.form, photos: state.photos, step: state.step };
    wipTimer.current = setTimeout(() => saveWip(sid, mid, snap), 400);
    return () => { if (wipTimer.current) clearTimeout(wipTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.form, state.photos, state.step, state.machineId, state.sessionId, usingDemo]);

  // 🆕 เติมหลาย SKU — ไลน์ที่มีจำนวน >0 (ที่จะส่งจริง) + ยอดรวมเติม.
  // MONEY-SAFE INVARIANT: total ที่โชว์บนจอ = ที่ server จะคิด (server: มี refillLines → Σ qty · ไม่มี → refillQty).
  // → มีไลน์: total = Σ lines.qty (ตรงกับ server) · ไม่มีไลน์ (fallback สาขาไม่มีสต๊อก): total = f.refill.
  const refillLinesActive = f.refillLines.filter((l) => l.qty > 0);
  const hasRefillLines = refillLinesActive.length > 0;
  const refillTotal = hasRefillLines
    ? refillLinesActive.reduce((sum, l) => sum + l.qty, 0)
    : n0(f.refill);
  // พรีวิวคำนวณด้วย n0() (null→0) แต่ "ตรง/ไม่ตรง" จะโชว์เฉพาะเมื่อ field ที่เกี่ยวกรอกครบ
  const dispensed = Math.max(0, f.last - n0(f.left));
  const afterFill = n0(f.left) + refillTotal;
  const dollDelta = n0(f.dollDigi) - f.dollPrev;
  const coinDelta = n0(f.coinDigi) - f.coinPrev;
  const expectedCash = coinDelta * CASH_PER_PLAY;
  // ความ "ตรง" จะตัดสินก็ต่อเมื่อกรอกครบ (กัน false ตรง/ไม่ตรง ตอนช่องยังว่าง)
  const dollMeterFilled = isFilled(f.dollGear) && isFilled(f.dollDigi);
  const coinMeterFilled = isFilled(f.coinGear) && isFilled(f.coinDigi);
  const dollMeterEqual = dollMeterFilled && n0(f.dollGear) === n0(f.dollDigi);
  const coinMeterEqual = coinMeterFilled && n0(f.coinGear) === n0(f.coinDigi);
  const meterEqualOk = dollMeterEqual && coinMeterEqual;
  const dollMatch = isFilled(f.left) && dollMeterFilled && dollDelta === dispensed;
  // ⚠️ cashMatch = ADVISORY เท่านั้น: client เดา ฿10/เกม (CASH_PER_PLAY) เพราะราคาจริงต่อตู้
  // ยังไม่ถูกส่งมา client → สาขา ฿20/เกม จะดู "ไม่ตรง" ทั้งที่ถูก. ตัวจริง = server reconcile.
  // จึง "ไม่" รวม cashMatch เข้า allMatch (กัน banner/ปุ่มแดงหลอก) — โชว์เป็นคำแนะนำ "ประมาณ".
  const cashMatch = isFilled(f.cash) && coinMeterFilled && n0(f.cash) === expectedCash;
  const allMatch = dollMatch && meterEqualOk;
  const tooHard = isFilled(f.cash) && isFilled(f.left) && dispensed <= 0 && n0(f.cash) >= 200;
  const meterReady = !state.meterDeferred;

  /* ── gating: แต่ละขั้นต้องกรอกช่องที่ "ต้องนับ/อ่านเอง" ครบก่อนไปต่อ/ส่ง ──
   * (DEMO ใส่ค่าให้แล้ว → ผ่านอัตโนมัติ · REAL = ว่าง → ต้องกรอกจริง)
   * step1 นับเหลือ · step2 เติมกี่ตัว · step3 มิเตอร์ 4 ช่อง (เว้นเมื่อ defer) · step4 เงินสด+ราคา */
  const step1CountOk = isFilled(f.left);
  // 🆕 step2 ผ่านเมื่อ: มีไลน์เติม >0 (หลาย SKU) · หรือ fallback กรอก f.refill (สาขาไม่มีสต๊อก).
  // "เติม 0 ตัว" (ไม่เติมรอบนี้) ยังผ่านได้ทาง fallback f.refill=0 (isFilled(0)=true).
  const step2CountOk = hasRefillLines || isFilled(f.refill);
  const step3CountOk = state.meterDeferred ||
    (isFilled(f.dollGear) && isFilled(f.dollDigi) && isFilled(f.coinGear) && isFilled(f.coinDigi));
  // ราคาขายไม่บังคับ (server ใช้ราคา loadout ที่ตั้งไว้ · ค่านี้ไม่ถูกส่งไป submit) — gate แค่เงินสดที่ต้องนับ
  const step4CountOk = isFilled(f.cash);
  const stepCountSatisfied =
    state.step === 1 ? step1CountOk
      : state.step === 2 ? step2CountOk
        : state.step === 3 ? step3CountOk
          : state.step === 4 ? step4CountOk
            : true; // step 5/6 ไม่มีช่องนับ
  const countBlocks = state.step >= 1 && state.step <= 4 && !stepCountSatisfied;

  /* ── นโยบายถ่ายรูป: แต่ละขั้นต้องมีรูปครบไหมก่อนกดถัดไป/ส่ง ──
   * step 1 = ก่อนเติม · step 2 = หลังเติม · step 3 = มิเตอร์ (ตุ๊กตา + เหรียญ อย่างละ 1 รูป) · step 4 = เงินสด.
   * backend coalesce มิเตอร์เป็น 1 ช่อง/ตัว → บังคับอย่างน้อยฝั่งละ 1 (เฟืองหรือดิจิตอล). */
  // gate ใช้ "ถ่ายแล้ว" (photosCaptured) ไม่ใช่ url — พนักงานถ่ายเสร็จ = ผ่านทันที
  // (upload วิ่งเบื้องหลัง/retry เอง · เน็ตตกไม่บล็อกที่หน้างาน). captured รวม url สำเร็จด้วยแล้ว.
  const ph = state.photosCaptured;
  // ขั้นมิเตอร์ที่กด "ถ่ายไว้ก่อน · กรอกทีหลัง" (defer) จะซ่อนปุ่มถ่าย → ห้ามบังคับถ่ายตอนนั้น (กันค้าง)
  const step3PhotoOk = (!!ph.dollGear || !!ph.dollDigi) && (!!ph.coinGear || !!ph.coinDigi);
  // FIX-5 · รูปเงินสด "ไม่บังคับ" เสมอ (ถ่ายได้-ข้ามได้) — step 4 ผ่านได้โดยไม่ต้องมีรูปเงินสด.
  // เหตุผล: เงินสดเป็นตัวเลขที่นับ+กระทบยอดกับมิเตอร์อยู่แล้ว · รูปเป็นหลักฐานเสริม ไม่ควรบล็อกการส่ง.
  const stepPhotoSatisfied =
    state.step === 1 ? !!ph.before
      : state.step === 2 ? !!ph.after
        : state.step === 3 ? (state.meterDeferred ? true : step3PhotoOk)
          : state.step === 4 ? true // รูปเงินสดไม่บังคับ → step 4 ไม่บล็อกด้วยรูป
            : true; // step 5/6 ไม่มีช่องถ่าย
  // บังคับเฉพาะเมื่อนโยบายเปิด + ขั้นที่มีรูป (1-4)
  const photoStepActive = photoRequired && state.step >= 1 && state.step <= 4;
  const photoBlocks = photoStepActive && !stepPhotoSatisfied;

  /* ── FIX-1 · นับรูปที่ "ถ่ายแล้วแต่ upload ยังไม่เสร็จ" (photosCaptured มี · photos ยังว่าง) ──
   * slot ที่ upload ค้าง = เสี่ยง saveDraft เก็บรูปเป็น "" → resume แล้วรูปหาย. ใช้กันปุ่มบันทึกค้าง. */
  const pr = state.photos;
  const pc = state.photosCaptured;
  const uploadingCount = (Object.keys(blankPhotos) as (keyof Photos)[]).filter(
    (k) => !!pc[k] && !pr[k],
  ).length;
  // ยังมีรูปอัปโหลดค้างไหม (และยังไม่หมดเวลา escape) → true = ปุ่มบันทึกค้างต้องรอ
  const uploadPending = uploadingCount > 0 && !allowSaveDespitePending;
  // ── safety timeout: ถ้ามีรูปค้าง ตั้งเวลา ~8 วิ แล้วปล่อยให้บันทึกได้ (เน็ตตก/upload ล้มจะได้ไม่ค้างถาวร) ──
  // reset ทุกครั้งที่ "จำนวนรูปค้าง" เปลี่ยน (ถ่ายเพิ่ม/upload เสร็จ) → นับ 8 วิ ใหม่จากการถ่ายล่าสุด.
  useEffect(() => {
    if (uploadingCount === 0) {
      // ไม่มีรูปค้าง → เคลียร์ flag escape (กลับสู่โหมดปกติ · การถ่ายรอบหน้าจะ gate ใหม่)
      if (allowSaveDespitePending) setAllowSaveDespitePending(false);
      return;
    }
    // มีรูปค้าง → รีเซ็ต escape flag เป็น false ก่อน (การถ่ายใหม่ต้องรอ upload รอบใหม่) แล้วตั้งเวลา 8 วิ
    setAllowSaveDespitePending(false);
    const t = setTimeout(() => setAllowSaveDespitePending(true), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadingCount]);

  /* ── open a machine: start a REAL session up-front (so submit can fire), else demo ── */
  function openMachine(m: AppMachine) {
    setError(null);
    // N1 · ตู้ยังไม่ตั้ง baseline (AWAITING_SETUP) → ไปฟอร์ม "ตั้งค่าครั้งแรก" แทน 6-step wizard.
    // (ตู้ยังไม่มี baseline → กระทบยอดเทียบอะไรไม่ได้ · ต้องบันทึกยอดตั้งต้นก่อน). demo ไม่มี awaitingSetup.
    if (m.awaitingSetup && !isDemo(m.id)) {
      setBaselineMachineId(m.id);
      return;
    }
    // resume draft → jump to meter entry
    const dr = drafts[m.id];
    if (dr) {
      dispatch({ type: "resume", draft: dr });
      return;
    }
    if (isDemo(m.id)) {
      dispatch({ type: "open", machine: m, skus, sessionId: null });
      return;
    }
    // REAL: open (or resume) the branch session before the wizard
    setOpeningId(m.id);
    startTransition(async () => {
      try {
        const r = await startBranchSession({ branchId: m.branchId });
        if (!r.ok) {
          // เปิดรอบกับระบบไม่ได้ (เน็ต/สิทธิ์) → อย่าเปิด wizard ที่ submit ไม่ได้
          // (กันเก็บเงินจริงแล้วโชว์ "เสร็จ" ลอย ๆ โดยไม่บันทึก) — ให้พนักงานลองใหม่
          console.error("[clawos] startBranchSession failed:", r.error);
          setError("เปิดรอบไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่อีกครั้ง");
          return;
        }
        dispatch({ type: "open", machine: m, skus, sessionId: r.data.id });
        // TASK A · ไม่มี deferred draft (เช็คไปแล้วด้านบน) → ถ้ามี WIP ค้างของ (รอบนี้+ตู้นี้) คืนกลับ.
        // form ที่เพิ่ง open เป็นค่าเริ่ม (ว่าง) → hydrate ทับได้ปลอดภัย (WIP = safety net · draft ชนะไปแล้ว).
        const wip = loadWip(r.data.id, m.id);
        if (wip) dispatch({ type: "hydrateWip", snapshot: wip });
      } finally {
        setOpeningId(null);
      }
    });
  }

  /* ── B1 · เปิดตู้เข้าหน้า "ถ่ายรูปก่อน" (photo hub) — logic เดียวกับ openMachine
   *  แต่ปลายทางเป็น photoHub (ถ่ายรัว ๆ ทุกช่องในที่เดียว → บันทึกค้าง → ไปตู้ต่อไป).
   *  awaitingSetup/resume-draft/demo เดินเหมือน openMachine (ไม่ให้ตู้ยังไม่ตั้ง baseline เข้า hub). */
  function openMachinePhotoHub(m: AppMachine) {
    setError(null);
    // ตู้ยังไม่ตั้ง baseline → ไปฟอร์มตั้งค่าครั้งแรกเหมือนเดิม (hub ใช้ไม่ได้)
    if (m.awaitingSetup && !isDemo(m.id)) {
      setBaselineMachineId(m.id);
      return;
    }
    // มีร่างค้างอยู่แล้ว → resume ไปกรอกมิเตอร์ (อย่าเปิด hub ทับ ร่างเก่า)
    const dr = drafts[m.id];
    if (dr) {
      dispatch({ type: "resume", draft: dr });
      return;
    }
    if (isDemo(m.id)) {
      dispatch({ type: "openPhotoHub", machine: m, skus, sessionId: null });
      return;
    }
    // REAL: เปิดรอบสาขาก่อน (เหมือน openMachine) → hub ถ่ายรูป+บันทึกค้างได้ (ต้องมี sessionId ในร่าง)
    setOpeningId(m.id);
    startTransition(async () => {
      try {
        const r = await startBranchSession({ branchId: m.branchId });
        if (!r.ok) {
          console.error("[clawos] startBranchSession failed (photoHub):", r.error);
          setError("เปิดรอบไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่อีกครั้ง");
          return;
        }
        dispatch({ type: "openPhotoHub", machine: m, skus, sessionId: r.data.id });
        // TASK A · คืน WIP ค้าง (ถ้ามี) เหมือน openMachine — รูป/เลขที่กรอกไว้ไม่หายเมื่อกลับเข้ามาถ่ายต่อ
        const wip = loadWip(r.data.id, m.id);
        if (wip) dispatch({ type: "hydrateWip", snapshot: wip });
      } finally {
        setOpeningId(null);
      }
    });
  }

  function saveDraft() {
    if (!machine) return;
    // FIX-1 · defensive: อย่าเพิ่งบันทึกถ้ายังมีรูปอัปโหลดค้าง (photosCaptured มี · photos ยังว่าง)
    // — ถ้าบันทึกตอนนี้ ร่างจะเก็บรูปเป็น "" → resume แล้วรูปหาย. ปุ่มถูก gate ไว้แล้ว (uploadPending)
    // นี่คือ safety net ชั้นสอง. เมื่อ escape timeout (8วิ) หมด → allowSaveDespitePending=true → ผ่าน.
    if (uploadPending) return;
    const d: Draft = {
      machineId: machine.id,
      code: machine.code,
      branch: machine.branch,
      cash: n0(f.cash),
      dispensed,
      time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
      form: { ...f },
      photos: { ...state.photos }, // เก็บรูปไว้ → resume ไม่ต้องถ่ายใหม่ (กันค้าง)
      sessionId: state.sessionId,
    };
    setDrafts((p) => ({ ...p, [machine.id]: d }));
    // TASK A · deferred draft เก็บ form+รูปครบแล้ว (เป็น persistence หลักของตู้นี้) → เคลียร์ WIP ที่ซ้ำซ้อน.
    // (deferred draft ชนะ WIP ตอน re-entry อยู่แล้ว · เคลียร์เพื่อไม่ให้เศษค้าง localStorage)
    clearWip(state.sessionId, machine.id);
    dispatch({ type: "home" });
  }

  /* ── ตู้เสีย/อ่านมิเตอร์ไม่ได้ → แจ้งซ่อม & ข้าม (ข้าม 1 ตู้ · ไม่ปิดรอบสาขา) ──
   * แจ้งซ่อมของจริง (createRepairTicket) สำหรับตู้ปัจจุบัน แล้วมาร์ค skipped + กลับรายการตู้.
   * ⚠️ คง cfCollectionSession ระดับสาขาไว้ (OPEN) — ข้ามตู้เดียวไม่ควรปิดรอบ เพราะตู้อื่นในสาขา
   * ยังต้องเก็บต่อ (ตู้อื่น openMachine → startBranchSession reuse รอบ OPEN เดิม · cron auto-close
   * 24ชม ครอบเคสตู้สุดท้ายถูกข้ามจนรอบว่าง). DEMO → ข้ามอย่างเดียว (ไม่มี backend). */
  function skipBrokenMachine() {
    if (!machine) return;
    const m = machine;
    setError(null);
    // demo → ข้ามเฉย ๆ (ไม่มี backend แจ้งซ่อม)
    if (isDemo(m.id)) {
      setSkippedIds((prev) => new Set(prev).add(m.id));
      setDrafts((p) => { const n = { ...p }; delete n[m.id]; return n; });
      dispatch({ type: "skipMachine" });
      return;
    }
    setSkipPending(true);
    startTransition(async () => {
      try {
        const r = await createRepairTicket({
          machineId: m.id,
          symptom: "อ่านมิเตอร์ไม่ได้ / ตู้เสียหน้างาน",
          note: "แจ้งจากแอปเก็บเงิน — พนักงานกดข้ามตู้นี้ในรอบเก็บ",
        });
        if (!r.ok) {
          console.error("[clawos] skip-broken createRepairTicket failed:", r.error);
          setError(r.error || "แจ้งซ่อมไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        // แจ้งซ่อมสำเร็จ → มาร์คข้าม + ลบร่างค้าง (ถ้ามี) + กลับรายการตู้ไปเก็บตู้ที่เหลือต่อ
        // (คง session สาขาไว้ · ไม่ปิดรอบเพราะข้ามแค่ตู้เดียว · ตู้อื่นยังต้องเก็บในรอบเดิม)
        setSkippedIds((prev) => new Set(prev).add(m.id));
        setDrafts((p) => { const n = { ...p }; delete n[m.id]; return n; });
        clearWip(state.sessionId, m.id); // TASK A · ข้ามตู้เสีย = ทิ้งรอบตู้นี้ → เคลียร์ WIP ค้าง
        dispatch({ type: "skipMachine" });
      } catch (e) {
        console.error("[clawos] skip-broken threw:", e);
        setError("แจ้งซ่อมไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      } finally {
        setSkipPending(false);
      }
    });
  }

  /* ── submit the round: REAL → submitBranchEvent + closeBranchSession; DEMO → optimistic ── */
  function submitRound() {
    if (!machine) return;
    setError(null);

    // demo → optimistic, jump to done (ไม่มี server)
    if (isDemo(machine.id)) {
      setDrafts((p) => {
        const n = { ...p };
        delete n[machine.id];
        return n;
      });
      dispatch({ type: "next" }); // → step 6 (done)
      return;
    }
    // ตู้จริงแต่ไม่มี session = เปิดรอบไม่สำเร็จ → ห้ามแสดง "เสร็จ" ลอย ๆ (กันเงิน/ตุ๊กตาหายเงียบ)
    if (!state.sessionId) {
      setError("ยังไม่ได้เปิดรอบกับระบบ · กดย้อนกลับเปิดตู้ใหม่ (ตรวจสัญญาณเน็ต) ก่อนบันทึก");
      return;
    }
    // safety net: ช่องที่ต้องนับ/อ่านเองต้องกรอกครบก่อนส่ง (ปุ่มถูก gate ไว้แล้ว · กันหลุดซ้ำ)
    // → จะได้ไม่ส่ง 0 ปลอมเข้าระบบ anti-cheat. 🆕 เติม: มีไลน์ >0 หรือกรอก f.refill (fallback) อย่างใดอย่างหนึ่ง.
    if (!isFilled(f.left) || (!hasRefillLines && !isFilled(f.refill)) || !isFilled(f.cash) ||
        !isFilled(f.dollDigi) || !isFilled(f.coinDigi)) {
      setError("กรอกตัวเลขที่นับ/อ่านมิเตอร์ให้ครบก่อนบันทึก");
      return;
    }

    const sessionId = state.sessionId;
    const p = state.photos;

    // ── หลักฐานกันโกง: ถ้านโยบายบังคับถ่าย + ถ่ายแล้วแต่ url ยังไม่มา (upload retry ค้าง) → รอ ──
    // gate ตอนกรอกใช้ "ถ่ายแล้ว" (photosCaptured) แบบ optimistic เพื่อไม่บล็อกหน้างานเน็ตตก, แต่
    // ตอนส่งรอบจริงต้องมี url จริงครบตาม policy — ไม่งั้น event บันทึกไม่มีรูปหลักฐานทั้งที่บังคับ.
    // เช็คแบบ coalesce ให้ตรงกับ payload ที่ส่ง (มิเตอร์: เฟือง/ดิจิตอลอย่างใดอย่างหนึ่งพอ).
    if (photoRequired) {
      const cap = state.photosCaptured;
      // slot ที่ "ถ่ายแล้ว" (มี capture mark/url) แต่ url จริงยังว่าง = upload ยังไม่เสร็จ
      const coinCaptured = !!cap.coinDigi || !!cap.coinGear;
      const prizeCaptured = !!cap.dollDigi || !!cap.dollGear;
      const waitingUpload =
        (!!cap.before && !p.before) ||
        (!!cap.after && !p.after) ||
        (!!cap.cash && !p.cash) ||
        (coinCaptured && !(p.coinDigi || p.coinGear)) ||
        (prizeCaptured && !(p.dollDigi || p.dollGear));
      if (waitingUpload) {
        // retry อัปโหลดวิ่งเบื้องหลังเอง (ไม่ต้องถ่ายซ้ำ) → พนักงานแค่รอ url ครบแล้วกดส่งอีกครั้ง
        setError("⏳ กำลังส่งรูปหลักฐาน รอสักครู่แล้วกดบันทึกอีกครั้ง");
        return;
      }
    }

    // 🆕 เติมหลาย SKU (money-safe): refillTotal = ที่โชว์บนจอ = ที่ server จะคิด (Σ lines.qty เมื่อมีไลน์ · f.refill เมื่อไม่มี).
    const refillQty = refillTotal;
    // ห้องที่หยิบของมาเติม (สาขา >1 ห้อง เท่านั้น · ≤1 ห้อง = null → คลังหลัก INVARIANT).
    const refillWarehouseId = f.refillWarehouseId ?? undefined;
    // มีไลน์เติม (หลาย SKU) → ส่ง refillLines[] · แต่ละไลน์แนบ warehouseId (ห้องเดียวกันทุกไลน์รอบนี้).
    // server: มี refillLines → total = Σ qty · หัก 1 แถว/ไลน์ (refillQty/refillProductId ถูก override).
    const refillLines = hasRefillLines
      ? refillLinesActive.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          warehouseId: refillWarehouseId,
        }))
      : undefined;
    // R4 (legacy single-SKU) · productId ที่เติม: ใช้ที่เลือกจาก BranchStockPicker ก่อน · fallback หา SKU จากชื่อ.
    // ใช้เฉพาะ fallback (ไม่มี refillLines) — server unused เมื่อ refillLines present.
    const refillProductId =
      !hasRefillLines && refillQty > 0
        ? (f.refillProductId ?? skus.find((s) => s.name === f.product)?.id)
        : undefined;

    const args: SubmitBranchEventArgs = {
      sessionId,
      machineId: machine.id,
      coinMeterAfter: n0(f.coinDigi),
      dollMeterAfter: n0(f.dollDigi),
      cashCountedCents: Math.round(n0(f.cash) * 100),
      // ⚠️ anti-cheat: stockBefore = สต๊อกรอบก่อน (lastDollStock = f.last) ไม่ใช่ที่นับตอนนี้.
      // server: prizeCountedOut = stockBefore + refillQty − stockAfter = f.last − f.left = dispensed
      // (ถ้าส่ง f.left จะได้ 0 เสมอ → ทุกตู้โดน flag ตุ๊กตาหายเท็จ + จับขโมยจริงไม่ได้)
      stockBefore: f.last,
      refillQty,
      stockAfter: afterFill,
      // 🆕 หลาย SKU — ส่งเมื่อมีไลน์เติม >0 · server จะใช้แทน refillQty/refillProductId (หัก 1 แถว/ไลน์).
      refillLines,
      refillProductId,
      // WAVE-3b · R4 · ห้องที่หยิบของมาเติม — ส่งเฉพาะเมื่อมีการเติม + เลือกห้อง (สาขา >1 ห้อง).
      // null/ไม่ส่ง = server ตัดจากคลังหลัก (INVARIANT) → สาขา ≤1 ห้อง พฤติกรรมเดิมเป๊ะ.
      warehouseId: refillQty > 0 && f.refillWarehouseId ? f.refillWarehouseId : undefined,
      // Photos OPTIONAL ("ถ่ายได้-ข้ามได้"): send the real R2 url that was captured, else ""
      // (server accepts url | "" | undefined → a skipped photo never blocks the round).
      // The meter step captures per-row (เฟือง/ดิจิตอล); backend has 1 slot per meter, so
      // coalesce to whichever row was photographed.
      photoCoinMeterUrl: p.coinDigi || p.coinGear || "",
      photoPrizeMeterUrl: p.dollDigi || p.dollGear || "",
      photoStockBeforeUrl: p.before || "",
      photoStockAfterUrl: p.after || "",
      photoCashUrl: p.cash || "",
    };
    sendEvent(args);
  }

  /* ── N5 · ส่ง event จริง (แยกจาก submitRound เพื่อ resubmit ได้พร้อม shortReason) ──
   * flow: submitBranchEvent → ถ้า needsReason (verdict=SHORT) → เปิด MismatchGate เก็บ payload เดิมไว้.
   * แม่บ้านเลือกเหตุผล → resubmit args เดิม + shortReason. OVER/OK/round-1 → ผ่านตามปกติ (server รับแล้ว).
   * เมื่อ event ผ่าน → closeBranchSession → step 6 (done). ตรรกะ submit เดิมคงไว้ทุกอย่าง. */
  function sendEvent(args: SubmitBranchEventArgs) {
    const machineId = args.machineId;
    startTransition(async () => {
      try {
        const ev = await submitBranchEvent(args);
        if (!ev.ok) {
          // N5 · soft-gate: server บอกว่าเงินขาด (verdict=SHORT) แต่ยังไม่ให้เหตุผล → เปิดด่านเหตุผล
          // (ไม่ใช่ error แข็ง · เก็บ payload เดิมไว้ resubmit พร้อม shortReason).
          if (ev.needsReason) {
            setPendingShort(args);
            return;
          }
          // แสดง "เหตุผลจริง" จาก server (เช่น ต้องตั้ง baseline · สต๊อกไม่พอ · มิเตอร์น้อยกว่าครั้งก่อน)
          // แทนข้อความเน็ตลอย ๆ → พนักงานแก้ตรงจุดได้. console เก็บ raw ไว้ debug.
          console.error("[clawos] submitBranchEvent failed:", ev.error);
          setError(ev.error || "บันทึกไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        // ผ่านแล้ว → เคลียร์ด่านเหตุผล (ถ้าเปิดค้าง) แล้วปิดรอบ
        setPendingShort(null);
        const close = await closeBranchSession({ sessionId: args.sessionId });
        if (!close.ok) {
          console.error("[clawos] closeBranchSession failed:", close.error);
          setError(close.error || "ปิดรอบไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        setDrafts((p) => {
          const n = { ...p };
          delete n[machineId];
          return n;
        });
        // TASK A · ปิดรอบสำเร็จ → เคลียร์ WIP ของตู้นี้ (ข้อมูลถูกบันทึกเข้าระบบแล้ว · ไม่ต้อง safety net อีก)
        clearWip(args.sessionId, machineId);
        dispatch({ type: "next" }); // → step 6 (done)
      } catch (e) {
        // action reject จริง ๆ (เน็ตหลุด/เซิร์ฟเวอร์ล่ม) → อันนี้ค่อยบอกให้เช็คเน็ต
        console.error("[clawos] submit threw:", e);
        setError("ส่งไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่อีกครั้ง");
      }
    });
  }

  // N5 · แม่บ้านเลือกเหตุผลเงินขาดใน MismatchGate → resubmit payload เดิม + shortReason
  function confirmShort(reason: string, note: string) {
    if (!pendingShort) return;
    setError(null);
    const withReason: SubmitBranchEventArgs = {
      ...pendingShort,
      // เหตุผล + โน้ต (ถ้ามี) → รวมเป็น shortReason เดียว (server เก็บใน cf_collection_events.short_reason)
      shortReason: note ? `${reason} · ${note}` : reason,
    };
    sendEvent(withReason);
  }

  function finishMachine() {
    dispatch({ type: "home" });
  }

  // ช่องตัวเลข: ว่าง → null ("ยังไม่กรอก") · มีค่า → number.
  // null สำคัญ: แยก "ยังไม่นับ" ออกจาก "นับได้ 0" → กันค่า default หลอก anti-cheat + กัน false ตรง/ไม่ตรง
  const setNum = (key: keyof Form) => (v: string) => {
    const digits = v.replace(/[^0-9]/g, "");
    dispatch({ type: "setForm", key, value: digits === "" ? null : Number(digits) });
  };

  /* ── bottom-bar primary/secondary buttons ── */
  let primaryLabel = "ถัดไป";
  let primaryColor = "#4F46E5";
  let primaryAction: () => void = () => dispatch({ type: "next" });
  let secondaryLabel = "";
  let secondaryAction: (() => void) | null = null;

  if (state.step === 5) {
    if (!meterReady) {
      // FIX-1 · ถ้ายังมีรูปอัปโหลดค้าง → เปลี่ยนป้าย + disable (กัน saveDraft เก็บรูปเป็น "" = หายตอน resume)
      primaryLabel = uploadPending ? "⏳ กำลังอัปโหลดรูป… รอสักครู่" : "บันทึกค้างไว้ · ไปเก็บตู้อื่น";
      primaryColor = "#B45309";
      primaryAction = saveDraft;
      secondaryLabel = "หรือกรอกเลขมิเตอร์ตอนนี้เลย";
      secondaryAction = () => dispatch({ type: "fillMeterNow" });
    } else {
      primaryLabel = pending ? "กำลังส่ง..." : "ยืนยันส่งข้อมูล";
      primaryColor = allMatch ? "#15803D" : "#B42318";
      primaryAction = submitRound;
    }
  } else if (state.step === 6) {
    primaryLabel = "เสร็จสิ้น · กลับหน้าหลัก";
    primaryColor = "#4F46E5";
    primaryAction = finishMachine;
  }

  // กันกดถัดไป/ส่ง เมื่อ: กำลังส่ง · ยังถ่ายรูปไม่ครบ (นโยบาย) · ยังกรอกตัวเลขที่ต้องนับไม่ครบ ·
  // FIX-1 · ปุ่ม "บันทึกค้าง" (step 5 + meterDeferred) ต้องรอ upload รูปเสร็จก่อน (uploadPending)
  const savingDraftStep = state.step === 5 && !meterReady;
  const primaryDisabled = pending || photoBlocks || countBlocks || (savingDraftStep && uploadPending);

  const stepLabels: Record<number, string> = {
    1: "นับตุ๊กตาก่อนเติม",
    2: "เติมตุ๊กตา",
    3: "มิเตอร์ (เฟือง+ดิจิตอล)",
    4: "เงินสด & ราคาในตู้",
    5: "กระทบยอด",
    6: "เสร็จสมบูรณ์",
  };

  // route + drafts derived for HOME
  const routeTotal = machines.length;
  const draftList = Object.values(drafts);
  // ✅ "ตู้เก็บแล้ว" = รอบที่ปิดเสร็จจริงวันนี้ (closedTodayCount จาก server) ไม่ใช่ draft ที่ค้าง.
  // draft = เก็บค้างรอกรอกมิเตอร์ (คนละความหมายกับ "เก็บเสร็จ"). DEMO ไม่มีข้อมูล server
  // → fallback ใช้ draftList.length เพื่อให้ตัวอย่างยังขยับ progress ได้.
  const routeDone = usingDemo ? draftList.length : closedTodayCount;
  const routePct = routeTotal > 0 ? Math.min(100, Math.round((routeDone / routeTotal) * 100)) : 0;

  /* ═══════════════ RENDER ═══════════════ */
  const onHome = state.step === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
      {usingDemo && onHome && (
        <div style={{ margin: "8px 18px 0", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "8px 12px", fontSize: 11, color: "#7A5510", lineHeight: 1.4 }}>
          กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — กดลองเดินขั้นตอนได้ ไม่บันทึกจริง
        </div>
      )}
      {error && (
        <div style={{ margin: "8px 18px 0", background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "8px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      {baselineMachine ? (
        // N1 · ตั้งค่าครั้งแรก (แทน 6-step wizard สำหรับตู้ AWAITING_SETUP)
        <BaselineScreen
          machine={baselineMachine}
          orgId={orgId}
          products={branchProducts[baselineMachine.branchId] ?? []}
          onBack={() => setBaselineMachineId(null)}
          onDone={() => {
            // ตั้งค่าเสร็จ → กลับหน้าหลัก · refresh ให้ server ส่ง awaitingSetup ใหม่ (ตู้ active แล้ว)
            setBaselineMachineId(null);
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
      ) : state.photoHub ? (
        // B1 · หน้า "รีบถ่ายรูปก่อน" — รวมทุกช่องถ่ายรูปในที่เดียว (ถ่ายรัว ๆ) → บันทึกค้าง → ไปตู้ต่อไป
        <PhotoHubScreen
          machine={machine}
          orgId={orgId}
          usingDemo={usingDemo}
          eventScopeId={`${state.sessionId ?? "demo"}-${machine?.id ?? "none"}`}
          photos={state.photos}
          onPhoto={(k, url) => dispatch({ type: "setPhoto", key: k, url })}
          onCapture={(k) => dispatch({ type: "capturePhoto", key: k })}
          onSaveDraft={saveDraft}
          // FIX-1 · รอ upload รูปเสร็จก่อนบันทึกค้าง (กันรูปหาย)
          uploadPending={uploadPending}
          onContinue={() => dispatch({ type: "exitPhotoHub" })}
          onBack={() => dispatch({ type: "home" })}
        />
      ) : onHome ? (
        <HomeScreen
          userName={userName}
          panel={panel}
          setPanel={setPanel}
          routeTotal={routeTotal}
          routeDone={routeDone}
          routePct={routePct}
          machines={machines}
          drafts={drafts}
          draftList={draftList}
          onOpen={openMachine}
          onOpenPhotoHub={openMachinePhotoHub}
          onReturn={(m) => { setError(null); setReturnMachineId(m.id); }}
          inMachineByMachine={inMachineByMachine}
          pending={pending}
          openingId={openingId}
          tourStep={tourStep}
          setTourStep={setTourStep}
          skus={skus}
          history={history}
          viewDate={viewDate}
          usingDemo={usingDemo}
          orgId={orgId}
          repairMachines={machines}
          myRecentTickets={myRecentTickets}
          skippedIds={skippedIds}
          assignedOnly={assignedOnly}
          branchProducts={branchProducts}
          inboundByBranch={inboundByBranch}
          warehousesByBranch={warehousesByBranch}
          onHandByBranch={onHandByBranch}
          receivedByBranch={receivedByBranch}
        />
      ) : (
        <FlowScreen
          orgId={orgId}
          usingDemo={usingDemo}
          eventScopeId={`${state.sessionId ?? "demo"}-${machine?.id ?? "none"}`}
          machine={machine}
          step={state.step}
          stepLabel={stepLabels[state.step] ?? ""}
          form={f}
          setNum={setNum}
          dispensed={dispensed}
          afterFill={afterFill}
          photos={state.photos}
          onPhoto={(k, url) => dispatch({ type: "setPhoto", key: k, url })}
          onCapture={(k) => dispatch({ type: "capturePhoto", key: k })}
          photoRequired={photoRequired}
          photoBlocks={photoBlocks}
          countBlocks={countBlocks}
          meterDeferred={state.meterDeferred}
          toggleDefer={() => dispatch({ type: "toggleDefer" })}
          onSkipBroken={skipBrokenMachine}
          skipPending={skipPending}
          resumed={state.resumed}
          meterGroupVals={{ dollMeterEqual, coinMeterEqual }}
          recon={{ dollDelta, expectedCash, dollMatch, cashMatch, meterEqualOk, allMatch }}
          tooHard={tooHard}
          configSent={state.configSent}
          sendConfig={() => dispatch({ type: "sendConfig" })}
          skus={skus}
          onProduct={(v) => dispatch({ type: "setForm", key: "product", value: v })}
          onCategory={(v) => dispatch({ type: "setForm", key: "category", value: v })}
          // R4 · สินค้าคลังสาขาของตู้นี้ + handler เลือกสินค้าเติมจาก picker (ตั้งทั้ง product+productId)
          branchProducts={activeBranchProducts}
          refillNetById={activeRefillNet}
          onPickRefill={(pid, name) => {
            dispatch({ type: "setForm", key: "refillProductId", value: pid });
            dispatch({ type: "setForm", key: "product", value: name });
          }}
          // WAVE-3b · R4 · คลัง active ของสาขานี้ (picker "เติมจากคลัง" · โผล่เมื่อ >1 ห้อง) + handler เลือกห้อง
          branchWarehouses={activeBranchWarehouses}
          onPickWarehouse={(wid) => dispatch({ type: "setForm", key: "refillWarehouseId", value: wid })}
          // 🆕 เติมหลาย SKU — ไลน์ปัจจุบัน + handlers เพิ่ม/แก้จำนวน/ลบ · total ที่ตรงกับ server
          refillLines={f.refillLines}
          refillTotal={refillTotal}
          onAddRefillLine={(pid, name) => dispatch({ type: "addRefillLine", productId: pid, name })}
          onSetRefillLineQty={(pid, qty) => dispatch({ type: "setRefillLineQty", productId: pid, qty })}
          onRemoveRefillLine={(pid) => dispatch({ type: "removeRefillLine", productId: pid })}
          // N5 · ด่านเงินไม่ตรง — เปิดเมื่อ server คืน needsReason (verdict=SHORT). ยกเลิก = ล้าง payload ค้าง.
          mismatchGate={
            pendingShort
              ? { active: true, onConfirmShort: confirmShort, onCancel: () => setPendingShort(null) }
              : null
          }
          // ขั้นเสร็จ (6): back = กลับหน้าหลัก+รีเซ็ต (กันย้อนเข้าไปแก้ยอดที่ส่งไปแล้ว)
          onBack={() => dispatch({ type: state.step >= 6 ? "home" : "back" })}
          // FIX-3 · "เลือกตู้อื่น" — กลับหน้ารายการตู้กลางคัน (คง session สาขาไว้ · home ไม่ทิ้งรอบผิด)
          onExitToList={() => dispatch({ type: "home" })}
          primary={{ label: primaryLabel, color: primaryColor, action: primaryAction }}
          secondary={secondaryAction ? { label: secondaryLabel, action: secondaryAction } : null}
          pending={pending}
          primaryDisabled={primaryDisabled}
        />
      )}

      {/* 🆕 คืนตุ๊กตาจากตู้เข้าคลัง — bottom-sheet overlay (ราย SKU + รูป + ยืนยันจำนวนเดิม) */}
      {returnMachine && (
        <ReturnDollsSheet
          machine={returnMachine}
          dolls={returnDolls}
          netAvailable={returnNetAvailable}
          usingDemo={usingDemo}
          onClose={() => setReturnMachineId(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── HOME ─────────────────────────── */
function HomeScreen(props: {
  userName: string;
  panel: Panel;
  setPanel: (p: Panel) => void;
  routeTotal: number;
  routeDone: number;
  routePct: number;
  machines: AppMachine[];
  drafts: Record<string, Draft>;
  draftList: Draft[];
  onOpen: (m: AppMachine) => void;
  onOpenPhotoHub: (m: AppMachine) => void; // B1 · เปิดตู้เข้าหน้า "ถ่ายรูปก่อน"
  // 🆕 เปิด sheet "คืนตุ๊กตาจากตู้เข้าคลัง" ของตู้นี้ + map ตุ๊กตาในตู้ (โชว์ปุ่มเฉพาะตู้ที่มีของในตู้)
  onReturn: (m: AppMachine) => void;
  inMachineByMachine: Record<string, InMachineDoll[]>;
  pending: boolean;
  openingId: string | null;
  tourStep: number;
  setTourStep: (n: number) => void;
  skus: CollectSku[];
  history: StaffHistoryRow[];
  viewDate: string; // B3 · วันที่ที่ดูประวัติ (YYYY-MM-DD)
  usingDemo: boolean;
  orgId: string;
  repairMachines: AppMachine[];
  myRecentTickets: RepairTicketRow[];
  skippedIds: Set<string>;
  // true = route ถูกกรองเหลือ "ตู้ของฉัน" (มีการมอบหมาย) → หัวข้อ "ตู้ของฉันวันนี้ (N)" + ไม่จัดกลุ่มสาขา
  assignedOnly: boolean;
  // N3/R4 · สินค้าคลังสาขา (นับสต๊อก) · N6 · ใบกระจายขาเข้า (รับสินค้า) — แยกตาม branchId
  branchProducts: Record<string, BranchStockProduct[]>;
  inboundByBranch: Record<string, InboundDelivery[]>;
  // WAVE-3b · N3 · คลัง active แยกตาม branchId (picker "นับคลัง" · โผล่เมื่อ >1 ห้อง)
  warehousesByBranch: Record<string, BranchWarehouse[]>;
  // F1 · คลังตอนนี้ต่อสินค้า · F2 · ประวัติรับแล้ว — แยกตาม branchId
  onHandByBranch: Record<string, Record<string, number>>;
  receivedByBranch: Record<string, CfReceivedDoc[]>;
}) {
  const { userName, panel, setPanel, routeTotal, routeDone, routePct, machines, drafts, draftList, onOpen, onOpenPhotoHub, onReturn, inMachineByMachine, pending, openingId, skippedIds, assignedOnly } = props;
  // N3/N6 · สาขาของพนักงาน (ตู้ตัวแรกในรายการ) → ใช้เลือกสินค้าคลัง/ใบรับของสาขานั้น.
  // route ถูกกรองเป็นสาขาเดียวของพนักงานอยู่แล้ว (assignedOnly/single-branch) → ใช้ branchId ตู้แรก.
  const primaryBranchId = machines.find((m) => !isDemo(m.id))?.branchId ?? "";
  const stockProducts = props.branchProducts[primaryBranchId] ?? [];
  const stockWarehouses = props.warehousesByBranch[primaryBranchId] ?? []; // WAVE-3b · N3 picker "นับคลัง"
  const inboundDeliveries = props.inboundByBranch[primaryBranchId] ?? [];
  // F1 · คลังตอนนี้ต่อสินค้าของสาขานี้ · F2 · ประวัติรับแล้วของสาขานี้ (ส่งเข้าหน้ารับสินค้า)
  const onHandByProduct = props.onHandByBranch[primaryBranchId] ?? {};
  const receivedDocs = props.receivedByBranch[primaryBranchId] ?? [];
  // จัดกลุ่มตู้ตามสาขา → หาง่ายเมื่อมีหลายสาขา (Wave 2).
  // รักษาลำดับสาขาตามที่เข้ามาครั้งแรก (insertion order ของ Map).
  const branchGroups = useMemo(() => {
    const map = new Map<string, AppMachine[]>();
    for (const m of machines) {
      const list = map.get(m.branch);
      if (list) list.push(m);
      else map.set(m.branch, [m]);
    }
    return Array.from(map.entries()); // [branchName, machines[]][]
  }, [machines]);
  // assignedOnly = "ตู้ของฉัน" (curated แล้ว) → ไม่ต้องคั่นสาขา แสดงเป็นรายการเดียว.
  // ไม่งั้น: มีมากกว่า 1 สาขา → โชว์หัวข้อสาขาคั่น (สาขาเดียวไม่ต้องคั่น กันรก).
  const showBranchHeaders = !assignedOnly && branchGroups.length > 1;
  // หัวข้อรายการตู้: มอบหมายแล้ว → "ตู้ของฉันวันนี้ (N)" · ไม่งั้น → "ตู้ในเส้นทางวันนี้" เดิม
  const routeHeading = assignedOnly ? `ตู้ของฉันวันนี้ (${machines.length})` : "ตู้ในเส้นทางวันนี้";
  // ชื่อจริงของพนักงานที่ล็อกอิน (จาก session) · ถ้าไม่ทราบ → "พนักงาน"
  const displayName = userName.trim() || "พนักงาน";
  const avatarChar = displayName.charAt(0) || "พ";
  // ทักทายตามเวลา (เช้า/บ่าย/เย็น/ค่ำ)
  const hr = new Date().getHours();
  const greet = hr < 12 ? "สวัสดีตอนเช้า" : hr < 16 ? "สวัสดีตอนบ่าย" : hr < 19 ? "สวัสดีตอนเย็น" : "สวัสดีตอนค่ำ";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px 24px" }}>
      {/* greeting */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, margin: "8px 0 18px" }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>{avatarChar}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#9AA1AB" }}>{greet}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{displayName}</div>
        </div>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: "#fff", border: "1px solid #E8EAED", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        </span>
      </div>

      {/* route progress */}
      <div style={{ background: "linear-gradient(135deg,#4F46E5,#6D5CE8)", borderRadius: 16, padding: "18px 20px", color: "#fff", marginBottom: 18 }}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>รอบเก็บเงินวันนี้ · เส้นทางรังสิต–ลาดพร้าว</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: 6 }}>
          <span className="num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-1px" }}>{routeDone}/{routeTotal}</span>
          <span style={{ fontSize: 13, opacity: 0.85, paddingBottom: 6 }}>ตู้เก็บแล้ว</span>
        </div>
        <div style={{ height: 6, background: "rgba(255,255,255,0.25)", borderRadius: 6, marginTop: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${routePct}%`, background: "#fff", borderRadius: 6 }} />
        </div>
      </div>

      {panel === null ? (
        <>
          {/* quick menu */}
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9, color: "#454B54" }}>เมนูลัด</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 18 }}>
            {QUICK_MENU.map((mn) => (
              <button key={mn.key} type="button" onClick={() => setPanel(mn.key)} className="co-tap co-lift"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minHeight: 72, background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "12px 6px", cursor: "pointer" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "#EEF0FE", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon paths={mn.d} size={17} />
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}>{mn.label}</span>
              </button>
            ))}
          </div>

          {/* tour CTA */}
          <button type="button" onClick={() => { setPanel("tour"); props.setTourStep(0); }} className="co-tap co-lift"
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 64, textAlign: "left", border: "none", cursor: "pointer", background: "linear-gradient(100deg,#4F46E5,#6D5DF0)", color: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 40px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M3 9h18M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M4 9 6 4h12l2 5" /></svg>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>เริ่มทัวร์เติมตู้ 7-11</span>
              <span style={{ display: "block", fontSize: 11.5, opacity: 0.85 }}>เบิกตุ๊กตา → ไล่เติม 8 ตู้ → คืนของเหลือ</span>
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"><path d="M9 18l6-6-6-6" /></svg>
          </button>

          {/* drafts */}
          {draftList.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#454B54" }}>เก็บค้างไว้ · รอกรอกมิเตอร์</span>
                <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FCF1E2", padding: "2px 9px", borderRadius: 20 }}>{draftList.length}</span>
              </div>
              <div style={{ background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "9px 12px", marginBottom: 10, fontSize: 11, color: "#7A5510", lineHeight: 1.45 }}>
                ถ่ายรูป + นับครบแล้ว เหลือกรอกเลขมิเตอร์ในที่ร่ม — แตะเพื่อกรอกให้จบ
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draftList.map((d) => (
                  <button key={d.machineId} type="button" className="co-tap co-lift"
                    onClick={() => { const m = machines.find((x) => x.id === d.machineId); if (m) onOpen(m); }}
                    style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 64, background: "#fff", border: "1px solid #F0E2BE", borderRadius: 12, padding: "11px 13px", textAlign: "left", cursor: "pointer" }}>
                    <span className="num" style={{ width: 42, height: 42, flex: "0 0 42px", borderRadius: 12, background: "#FCF1E2", color: "#B45309", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{d.code}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.branch}</div>
                      <div style={{ fontSize: 11, color: "#9AA1AB" }}>เก็บ <span className="num">฿{d.cash.toLocaleString("en-US")}</span> · ตุ๊กตาออก <span className="num">{d.dispensed}</span> · {d.time}</div>
                    </div>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#B45309", whiteSpace: "nowrap" }}>
                      กรอกมิเตอร์<ChevronRight size={16} strokeWidth={2.4} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* route list — assignedOnly = "ตู้ของฉันวันนี้ (N)" · ไม่งั้น "ตู้ในเส้นทางวันนี้" */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#454B54" }}>{routeHeading}</span>
            {assignedOnly && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "2px 9px", borderRadius: 20 }}>มอบหมายให้ฉัน</span>
            )}
          </div>
          {machines.length === 0 ? (
            // empty state — พนักงานยังไม่ได้รับมอบหมายตู้ (กันหน้าว่างเปล่าดูเหมือนพัง)
            <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
              <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="ยังไม่มีตู้ที่ได้รับมอบหมาย" sub="ติดต่อผู้ดูแลเพื่อขอมอบหมายตู้ในเส้นทางของคุณ" />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: showBranchHeaders ? 16 : 9 }}>
              {branchGroups.map(([branchName, list]) => (
                <div key={branchName} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {showBranchHeaders && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7280" }}>{branchName}</span>
                      <span className="num" style={{ fontSize: 10.5, fontWeight: 700, color: "#9AA1AB", background: "#F1F2F5", padding: "1px 8px", borderRadius: 20 }}>{list.length}</span>
                    </div>
                  )}
                  {list.map((m) => {
                    const isDraft = !!drafts[m.id];
                    const isOpening = openingId === m.id;
                    const isSkipped = skippedIds.has(m.id);
                    // N1 · ตู้ยังไม่ตั้ง baseline (AWAITING_SETUP) → ป้าย ⚪ neutral gray "ตั้งค่าครั้งแรก" (ไม่ใช่แดง)
                    const isAwaiting = m.awaitingSetup;
                    const tag = isSkipped
                      ? { l: "แจ้งซ่อมแล้ว", c: "#B42318", bg: "#FCEDEC", iBg: "#FCEDEC", iC: "#B42318", dot: "#D8503F", hint: "ตู้เสีย · แจ้งซ่อม & ข้ามในรอบนี้แล้ว" }
                      : isAwaiting
                        ? { l: "ตั้งค่าครั้งแรก", c: "#5A6270", bg: "#F1F2F7", iBg: "#F1F2F7", iC: "#5A6270", dot: "#A9AEB8", hint: "ตู้ใหม่ · แตะเพื่อบันทึกยอดตั้งต้น" }
                        : isDraft
                          ? { l: "ค้างมิเตอร์", c: "#B45309", bg: "#FCF1E2", iBg: "#FCF1E2", iC: "#B45309", dot: "#E8A33D", hint: "ถ่ายรูป+นับแล้ว · รอกรอกเลขมิเตอร์" }
                          : { l: "รอเก็บ", c: "#4F46E5", bg: "#EEF0FE", iBg: "#EEF0FE", iC: "#4F46E5", dot: "#4F46E5", hint: "แตะเพื่อเริ่มเก็บเงิน" };
                    // ระหว่างมีตู้กำลังเปิดรอบ → dim ตู้อื่น, ตู้ที่กดโชว์สปินเนอร์ (กันรู้สึกค้าง/พัง)
                    const dimmed = pending && !isOpening;
                    // B1 · ปุ่มลัด "ถ่ายรูปก่อน" โชว์เฉพาะตู้ที่ยัง "รอเก็บ" (ยังไม่มีร่าง/ไม่เสีย/ตั้ง baseline แล้ว)
                    const canPhotoFirst = !isDraft && !isSkipped && !isAwaiting;
                    // 🆕 คืนตุ๊กตา — โชว์ปุ่มเฉพาะตู้ที่ "มีของในตู้ตอนนี้" (จาก server ledger · ไม่ใช่ demo/ตู้เสีย)
                    const dollCount = inMachineByMachine[m.id]?.length ?? 0;
                    const canReturn = dollCount > 0 && !isSkipped && !isAwaiting;
                    return (
                      <div key={m.id} style={{ display: "flex", alignItems: "stretch", gap: 8, opacity: dimmed ? 0.5 : 1 }}>
                        <button type="button" disabled={pending} onClick={() => onOpen(m)}
                          className={pending ? "" : "co-tap co-lift"}
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, minHeight: 64, background: "#fff", border: `1px solid ${isOpening ? "#C7C3F0" : isSkipped ? "#F3D4D0" : isAwaiting ? "#E1E3E9" : isDraft ? "#F0E2BE" : "#E8EAED"}`, borderRadius: 13, padding: "12px 14px", textAlign: "left", cursor: pending ? "wait" : "pointer" }}>
                          <span style={{ position: "relative", flex: "0 0 42px" }}>
                            <span className="num" style={{ width: 42, height: 42, borderRadius: 12, background: tag.iBg, color: tag.iC, fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.code}</span>
                            <span style={{ position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: "50%", background: tag.dot, border: "2px solid #fff" }} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.branch} <span style={{ color: "#9AA1AB", fontWeight: 400, fontSize: 12 }}>· {m.zone}</span></div>
                            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{isOpening ? "กำลังเปิดรอบ…" : tag.hint}</div>
                          </div>
                          {isOpening ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#4F46E5" }}>
                              <Spinner color="#4F46E5" />
                              เปิดรอบ
                            </span>
                          ) : (
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: tag.bg, color: tag.c }}>{tag.l}</span>
                              <ChevronRight size={17} color="#C2C7CF" strokeWidth={2.2} />
                            </span>
                          )}
                        </button>
                        {/* B1 · ปุ่มลัด "📸 ถ่ายรูปก่อน" — เข้าหน้ารวมถ่ายรูปทุกช่อง แล้วบันทึกค้าง ไปตู้ต่อไป */}
                        {canPhotoFirst && (
                          <button type="button" disabled={pending} aria-label={`ถ่ายรูปก่อน ตู้ ${m.code}`} title="ถ่ายรูปก่อน"
                            onClick={() => onOpenPhotoHub(m)} className={pending ? "" : "co-tap"}
                            style={{ flex: "0 0 56px", width: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "#F5F5FE", border: "1px solid #D9D6F5", borderRadius: 13, cursor: pending ? "wait" : "pointer", color: "#4F46E5" }}>
                            <Camera size={19} strokeWidth={2} />
                            <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>ถ่ายก่อน</span>
                          </button>
                        )}
                        {/* 🆕 ปุ่ม "คืนตุ๊กตา" — เอาตุ๊กตาออกจากตู้ กลับเข้าคลังสาขา (ราย SKU + รูป) */}
                        {canReturn && (
                          <button type="button" disabled={pending} aria-label={`คืนตุ๊กตาจากตู้ ${m.code} เข้าคลัง`} title="เอาตุ๊กตาออก / คืนเข้าคลัง"
                            onClick={() => onReturn(m)} className={pending ? "" : "co-tap"}
                            style={{ flex: "0 0 56px", width: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "#EFFAF3", border: "1px solid #C8E9D3", borderRadius: 13, cursor: pending ? "wait" : "pointer", color: "#15803D" }}>
                            <PackageOpen size={19} strokeWidth={2} />
                            <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>คืนของ</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <PanelScreen panel={panel} onBack={() => setPanel(null)} tourStep={props.tourStep} setTourStep={props.setTourStep} skus={props.skus} history={props.history} viewDate={props.viewDate} usingDemo={props.usingDemo} orgId={props.orgId} repairMachines={props.repairMachines} myRecentTickets={props.myRecentTickets} branchId={primaryBranchId} branchCode={machines.find((m) => m.branchId === primaryBranchId)?.code ?? ""} stockProducts={stockProducts} stockWarehouses={stockWarehouses} inboundDeliveries={inboundDeliveries} onHandByProduct={onHandByProduct} receivedDocs={receivedDocs} />
      )}
    </div>
  );
}

/* ─────────────────────────── PANELS (history/repair/stock/receive/config/tour) ─────────────────────────── */
const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  history: "ประวัติการเก็บของฉัน",
  repair: "แจ้งซ่อมตู้",
  stock: "นับสต็อกสาขา",
  receive: "รับสินค้าเข้าคลัง",
  config: "สถานะตั้งค่าตู้",
  tour: "เติมทัวร์ 7-11",
};

function PanelScreen(props: {
  panel: Exclude<Panel, null>; onBack: () => void; tourStep: number; setTourStep: (n: number) => void;
  skus: CollectSku[]; history: StaffHistoryRow[]; viewDate: string; usingDemo: boolean; orgId: string;
  repairMachines: AppMachine[]; myRecentTickets: RepairTicketRow[];
  // N3/N6 · บริบทสาขาสำหรับหน้านับสต๊อก + รับสินค้า
  branchId: string; branchCode: string; stockProducts: BranchStockProduct[]; inboundDeliveries: InboundDelivery[];
  // WAVE-3b · N3 · คลัง active ของสาขานี้ (picker "นับคลัง" · โผล่เมื่อ >1 ห้อง)
  stockWarehouses: BranchWarehouse[];
  // F1 · คลังตอนนี้ต่อสินค้า (การ์ดรับ "N → N+รับ") · F2 · ประวัติรับแล้ว (แท็บ "รับแล้ว")
  onHandByProduct: Record<string, number>;
  receivedDocs: CfReceivedDoc[];
}) {
  const { panel, onBack } = props;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
        <button type="button" onClick={onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{PANEL_TITLE[panel]}</span>
      </div>
      {panel === "history" && <HistoryPanel history={props.history} viewDate={props.viewDate} usingDemo={props.usingDemo} />}
      {panel === "repair" && <RepairPanel orgId={props.orgId} machines={props.repairMachines} usingDemo={props.usingDemo} myRecentTickets={props.myRecentTickets} />}
      {panel === "stock" && <StockCountPanel orgId={props.orgId} usingDemo={props.usingDemo} branchId={props.branchId} branchCode={props.branchCode} products={props.stockProducts} warehouses={props.stockWarehouses} />}
      {panel === "receive" && <GoodsReceivePanel orgId={props.orgId} usingDemo={props.usingDemo} branchCode={props.branchCode} deliveries={props.inboundDeliveries} onHandByProduct={props.onHandByProduct} receivedDocs={props.receivedDocs} />}
      {panel === "config" && <ConfigPanel />}
      {panel === "tour" && <TourPanel tourStep={props.tourStep} setTourStep={props.setTourStep} />}
    </div>
  );
}

/* ─────────────────── N1 · หน้าจอ "ตั้งค่าครั้งแรก" (แทน 6-step wizard สำหรับตู้ AWAITING_SETUP) ─────────────────── */
function BaselineScreen({ machine, orgId, products, onBack, onDone }: {
  machine: AppMachine; orgId: string; products: BranchStockProduct[]; onBack: () => void; onDone: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* header กระชับ (back + ชื่อตู้) */}
      <div style={{ padding: "4px 18px 12px", borderBottom: "1px solid #EAECEF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <button type="button" onClick={onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* TASK C · ชื่อเล่นเด่น + รหัสเป็นรอง (baseline form มีช่องตั้งชื่อเล่นเองอยู่แล้ว) */}
            <MachineHeaderTitle prefix="ตั้งค่าครั้งแรก" machine={machine} />
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{machine.branch} · {machine.zone}</div>
          </div>
        </div>
      </div>
      {/* body — ฟอร์ม baseline (server ทำ money logic · ฟอร์มแค่เก็บ+ส่ง) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 24px" }}>
        <BaselineForm
          machine={{ id: machine.id, code: machine.code, nickname: machine.nickname }}
          branchId={machine.branchId}
          orgId={orgId}
          products={products.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl }))}
          onDone={onDone}
        />
      </div>
    </div>
  );
}

/* B3 · date helpers สำหรับ date picker ประวัติ (YYYY-MM-DD ± วัน · label ภาษาไทย) */
function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // ใช้ UTC noon เป็นฐาน (กัน DST/timezone เลื่อนวัน) แล้ว ±วัน
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function ymdLabelThai(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return "วันนี้";
  if (ymd === shiftYmd(todayYmd, -1)) return "เมื่อวาน";
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  // ปี พ.ศ. (ค.ศ. + 543) แบบ 2 หลัก
  return `${d} ${months[m - 1] ?? ""} ${String((y + 543) % 100).padStart(2, "0")}`;
}

// B3 · date picker ประวัติ — เปลี่ยน ?date= → server re-query (หน้าเป็น force-dynamic).
// prev/next วัน + native date input · กันเลือกอนาคต (max = วันนี้). READ-ONLY ไม่แตะเงิน.
function HistoryDatePicker({ viewDate }: { viewDate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const todayYmd = clientTodayBangkokYmd();
  const isToday = viewDate >= todayYmd; // >= กัน edge เผื่อ clock ต่างเล็กน้อย
  const go = (ymd: string) => {
    // ไม่ให้ไปวันอนาคต (ไม่มีข้อมูล)
    const target = ymd > todayYmd ? todayYmd : ymd;
    router.push(`${pathname}?date=${target}`);
  };
  const chip = (active: boolean) =>
    ({ minHeight: 44, padding: "8px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
       border: `1.5px solid ${active ? "#C7C3F0" : "#E3E6EA"}`, background: active ? "#EEF0FE" : "#fff",
       color: active ? "#4338CA" : "#5A6270", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 } as const);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <button type="button" aria-label="วันก่อนหน้า" onClick={() => go(shiftYmd(viewDate, -1))} className="co-tap"
        style={{ width: 44, height: 44, flex: "0 0 44px", borderRadius: 11, border: "1.5px solid #E3E6EA", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#5A6270" }}>
        <ChevronLeft size={18} strokeWidth={2.2} />
      </button>
      {/* native date input — แตะเลือกวันไหนก็ได้ (label ทับด้วยข้อความไทยให้อ่านง่าย) */}
      <label style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 11, border: "1.5px solid #E3E6EA", background: "#fff", cursor: "pointer", padding: "0 10px" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1D21" }}>{ymdLabelThai(viewDate, todayYmd)}</span>
        <input type="date" aria-label="เลือกวันที่ดูประวัติ" value={viewDate} max={todayYmd}
          onChange={(e) => { if (e.target.value) go(e.target.value); }}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
      </label>
      <button type="button" disabled={isToday} aria-label="วันถัดไป" onClick={() => go(shiftYmd(viewDate, 1))} className={isToday ? "" : "co-tap"}
        style={{ width: 44, height: 44, flex: "0 0 44px", borderRadius: 11, border: "1.5px solid #E3E6EA", background: isToday ? "#F4F5F7" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: isToday ? "not-allowed" : "pointer", color: isToday ? "#C2C7CF" : "#5A6270", opacity: isToday ? 0.7 : 1 }}>
        <ChevronRight size={18} strokeWidth={2.2} />
      </button>
      {!isToday && (
        <button type="button" onClick={() => go(todayYmd)} className="co-tap" style={chip(false)}>วันนี้</button>
      )}
    </div>
  );
}

function HistoryPanel({ history, viewDate, usingDemo }: { history: StaffHistoryRow[]; viewDate: string; usingDemo: boolean }) {
  const todayYmd = clientTodayBangkokYmd();
  // โหมดตัวอย่าง (ยังไม่มีข้อมูลจริง) → โชว์ตัวอย่างแต่ติดป้ายชัดว่าเป็นตัวอย่าง (ไม่หลอกว่าเป็นของจริง)
  const demoRows: StaffHistoryRow[] = [
    { code: "RS-03", branch: "รังสิต", time: "14:20", cashBaht: 300, coinMeter: 210, ok: true },
    { code: "LP-01", branch: "ลาดพร้าว", time: "13:50", cashBaht: 620, coinMeter: 158, ok: true },
    { code: "RS-07", branch: "รังสิต", time: "12:10", cashBaht: 540, coinMeter: 302, ok: false },
  ];
  const rows = usingDemo ? demoRows : history;
  const dayLabel = ymdLabelThai(viewDate, todayYmd);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* B3 · date picker (demo ก็โชว์ได้ · แค่ข้อมูลเป็นตัวอย่าง) */}
      {!usingDemo && <HistoryDatePicker viewDate={viewDate} />}
      {usingDemo && (
        <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — รายการจริงจะขึ้นเมื่อเก็บเงินผ่านระบบ" />
      )}

      {/* ของจริงแต่ "วันที่เลือก" ไม่มีรอบ → empty state ซื่อสัตย์ (ยังโชว์ picker ให้เปลี่ยนวันได้) */}
      {!usingDemo && rows.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
          <EmptyState
            icon={<Inbox size={30} strokeWidth={1.6} />}
            title={viewDate === todayYmd ? "วันนี้ยังไม่มีรอบที่เก็บเสร็จ" : `${dayLabel} ไม่มีรอบที่เก็บ`}
            sub={viewDate === todayYmd ? "เมื่อคุณเก็บเงินจบตู้ รายการจะขึ้นที่นี่" : "ลองเลือกวันอื่นด้านบนเพื่อดูย้อนหลัง"}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((h, i) => (
            <div key={`${h.code}-${h.time}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "12px 13px", minHeight: 60 }}>
              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#4F46E5", flex: "0 0 52px" }}>{h.code}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>฿{h.cashBaht.toLocaleString("en-US")}</div>
                <div style={{ fontSize: 10.5, color: "#9AA1AB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.branch ? `${h.branch} · ` : ""}{dayLabel} {h.time}
                  {h.coinMeter != null ? <> · มิเตอร์ <span className="num">{h.coinMeter.toLocaleString("en-US")}</span></> : null}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: h.ok ? "#E7F4EC" : "#FCEDEC", color: h.ok ? "#15803D" : "#B42318" }}>{h.ok ? "ตรง" : "ไม่ตรง"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// อาการเสียมาตรฐาน (ปุ่มเลือกเร็ว) — "อื่นๆ" ให้พิมพ์อาการเอง
const REPAIR_SYMPTOMS = ["คีบไม่ติด", "เหรียญค้าง", "จอดับ", "มิเตอร์เพี้ยน", "อื่นๆ"] as const;

// ป้ายสถานะตั๋วซ่อม (ภาษาคน + สี)
function repairStatusStyle(status: string): { label: string; c: string; bg: string } {
  switch (status) {
    case "OPEN": return { label: "รอช่าง", c: "#B42318", bg: "#FCEDEC" };
    case "IN_PROGRESS": return { label: "กำลังซ่อม", c: "#B45309", bg: "#FCF1E2" };
    case "RESOLVED": return { label: "ซ่อมแล้ว", c: "#15803D", bg: "#E7F4EC" };
    case "CANCELLED": return { label: "ยกเลิก", c: "#6B7280", bg: "#F1F2F5" };
    default: return { label: status, c: "#6B7280", bg: "#F1F2F5" };
  }
}

function RepairPanel({ orgId, machines, usingDemo, myRecentTickets }: {
  orgId: string; machines: AppMachine[]; usingDemo: boolean; myRecentTickets: RepairTicketRow[];
}) {
  // ตู้จริงเท่านั้น (โหมด demo ไม่มี backend → แจ้งซ่อมจริงไม่ได้ · โชว์ป้ายตัวอย่าง)
  const realMachines = useMemo(() => machines.filter((m) => !isDemo(m.id)), [machines]);
  const canSubmit = !usingDemo && realMachines.length > 0;

  const [machineId, setMachineId] = useState<string>(realMachines[0]?.id ?? "");
  const [symptom, setSymptom] = useState<string>(REPAIR_SYMPTOMS[0]);
  const [otherSymptom, setOtherSymptom] = useState<string>(""); // เมื่อเลือก "อื่นๆ"
  const [note, setNote] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [meterReset, setMeterReset] = useState<boolean>(false);
  const [propCoin, setPropCoin] = useState<string>(""); // เลขมิเตอร์เหรียญใหม่หลังซ่อม
  const [propStock, setPropStock] = useState<string>(""); // สต๊อกตุ๊กตาใหม่หลังซ่อม
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const selected = realMachines.find((m) => m.id === machineId) ?? null;
  // อาการจริง = ที่เลือก · ถ้า "อื่นๆ" ใช้ที่พิมพ์ (fallback เป็น "อื่นๆ" กัน symptom ว่าง)
  const effectiveSymptom = symptom === "อื่นๆ" ? otherSymptom.trim() || "อื่นๆ" : symptom;

  const lbl = { fontSize: 12, fontWeight: 600, color: "#454B54", display: "block", marginBottom: 5 } as const;
  const sel = { width: "100%", fontSize: 14, fontWeight: 600, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", cursor: "pointer" } as const;
  const numInput = { width: "100%", fontSize: 15, fontWeight: 700, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" } as const;

  function submit() {
    if (!canSubmit || !selected) return;
    setError(null);
    setOkMsg(null);
    // ถ้าขอรีเซ็ตมิเตอร์ → ต้องกรอกเลขเหรียญใหม่ + สต๊อกตุ๊กตาใหม่ให้ครบ (ผจก.เอาไปอนุมัติ)
    const coinNum = propCoin === "" ? undefined : Number(propCoin);
    const stockNum = propStock === "" ? undefined : Number(propStock);
    if (meterReset && (coinNum === undefined || stockNum === undefined)) {
      setError("ขอรีเซ็ตมิเตอร์ · กรอกเลขมิเตอร์เหรียญใหม่ + สต๊อกตุ๊กตาใหม่ให้ครบ");
      return;
    }
    startTransition(async () => {
      try {
        const r = await createRepairTicket({
          machineId: selected.id,
          symptom: effectiveSymptom,
          note: note.trim() || undefined,
          photoUrls: photoUrl ? [photoUrl] : undefined,
          meterResetRequested: meterReset,
          proposedCoinMeter: meterReset ? coinNum : undefined,
          proposedDollStock: meterReset ? stockNum : undefined,
        });
        if (!r.ok) {
          console.error("[clawos] createRepairTicket failed:", r.error);
          setError(r.error || "แจ้งซ่อมไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        // สำเร็จ → เคลียร์ฟอร์ม + โชว์ยืนยัน (รายการล่าสุดจะอัปเดตรอบถัดไปที่โหลดหน้า)
        setOkMsg(`ส่งแจ้งซ่อมตู้ ${selected.code} แล้ว · ทีมช่างจะได้รับแจ้ง`);
        setNote("");
        setPhotoUrl("");
        setMeterReset(false);
        setPropCoin("");
        setPropStock("");
        setSymptom(REPAIR_SYMPTOMS[0]);
        setOtherSymptom("");
      } catch (e) {
        console.error("[clawos] createRepairTicket threw:", e);
        setError("แจ้งซ่อมไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      {usingDemo && (
        <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — แจ้งซ่อมจริงได้เมื่อมีตู้ในระบบ" />
      )}
      {!usingDemo && realMachines.length === 0 && (
        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
          <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="ยังไม่มีตู้ในระบบ" sub="ติดต่อผู้ดูแลเพื่อเพิ่มตู้ก่อนแจ้งซ่อม" />
        </div>
      )}

      {canSubmit && (
        <>
          {error && (
            <div style={{ background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
          )}
          {okMsg && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#15803D", fontWeight: 600, lineHeight: 1.4 }}>
              <Check size={15} strokeWidth={2.6} />{okMsg}
            </div>
          )}
          <div>
            <label style={lbl}>เลือกตู้ที่เสีย</label>
            <select aria-label="เลือกตู้ที่เสีย" title="เลือกตู้ที่เสีย" value={machineId} onChange={(e) => setMachineId(e.target.value)} style={sel}>
              {realMachines.map((m) => (
                <option key={m.id} value={m.id}>{m.code} · {m.branch}{m.zone ? ` · ${m.zone}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>อาการเสีย</label>
            <select aria-label="อาการเสีย" title="อาการเสีย" value={symptom} onChange={(e) => setSymptom(e.target.value)} style={sel}>
              {REPAIR_SYMPTOMS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {symptom === "อื่นๆ" && (
              <input type="text" value={otherSymptom} onChange={(e) => setOtherSymptom(e.target.value)}
                placeholder="พิมพ์อาการที่พบ…"
                style={{ width: "100%", fontSize: 13.5, padding: "10px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", marginTop: 8 }} />
            )}
          </div>
          <div>
            <label style={lbl}>แนบรูปอาการเสีย (ถ่ายได้-ข้ามได้)</label>
            <PhotoCaptureButton
              label={photoUrl ? "แนบรูปแล้ว · แตะถ่ายใหม่" : "ถ่ายรูปอาการเสีย"}
              value={photoUrl} onChange={setPhotoUrl}
              orgId={orgId} machineCode={selected?.code ?? ""}
              eventScopeId={`repair-${selected?.id ?? "none"}`} phase="stock" />
          </div>
          <div>
            <label style={lbl}>รายละเอียดเพิ่มเติม</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เสียงดังผิดปกติ · เกิดตอนไหน…"
              style={{ width: "100%", fontSize: 13, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", minHeight: 64, resize: "none" }} />
          </div>

          {/* toggle: เปลี่ยน/รีเซ็ตมิเตอร์หลังซ่อม → ต้องผจก.อนุมัติเลขก่อนใช้ (กันโดนหาว่าโกง) */}
          <button type="button" onClick={() => setMeterReset((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 13px", borderRadius: 11, cursor: "pointer", textAlign: "left", border: `1.5px solid ${meterReset ? "#C7C3F0" : "#E3E6EA"}`, background: meterReset ? "#EEF0FE" : "#fff" }}>
            <span style={{ width: 40, height: 24, flex: "0 0 40px", borderRadius: 20, background: meterReset ? "#4F46E5" : "#D6DAE0", position: "relative", transition: "background .15s" }}>
              <span style={{ position: "absolute", top: 2, left: meterReset ? 18 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: meterReset ? "#4338CA" : "#454B54" }}>มิเตอร์รีเซ็ตหลังซ่อม</span>
              <span style={{ display: "block", fontSize: 11, color: "#6B7280", lineHeight: 1.4 }}>เปิดเมื่อช่างเปลี่ยนบอร์ด/มิเตอร์ แล้วเลขเริ่มใหม่</span>
            </span>
          </button>

          {meterReset && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11, background: "#F8F8FE", border: "1px solid #E0DEF7", borderRadius: 12, padding: "13px 14px" }}>
              <div style={{ display: "flex", gap: 8, fontSize: 11.5, color: "#4338CA", lineHeight: 1.45 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 16px", marginTop: 1 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <span>ผจก.อนุมัติก่อนระบบใช้เลขนี้ (กันโดนหาว่าโกงตอนเลขมิเตอร์เปลี่ยน)</span>
              </div>
              <div>
                <label style={lbl}>เลขมิเตอร์เหรียญใหม่ (หลังซ่อม)</label>
                <input type="number" inputMode="numeric" value={propCoin} onChange={(e) => setPropCoin(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="อ่านเลขมิเตอร์ปัจจุบัน" className="num" style={numInput} />
              </div>
              <div>
                <label style={lbl}>สต๊อกตุ๊กตาในตู้ตอนนี้ (ตัว)</label>
                <input type="number" inputMode="numeric" value={propStock} onChange={(e) => setPropStock(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="นับตุ๊กตาในตู้" className="num" style={numInput} />
              </div>
            </div>
          )}

          <button type="button" onClick={submit} disabled={pending}
            className={pending ? "" : "co-tap"}
            style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: 13, borderRadius: 12, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}>
            {pending ? "กำลังส่ง…" : "ส่งแจ้งซ่อม"}
          </button>
        </>
      )}

      {/* ตั๋วซ่อมของฉันล่าสุด (ของจริง จาก listMyRecentRepairTickets) */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", marginTop: 4 }}>ตั๋วซ่อมของฉันล่าสุด</div>
      {myRecentTickets.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9AA1AB", background: "#F6F7FA", borderRadius: 11, padding: "12px 14px", lineHeight: 1.5 }}>
          ยังไม่มีตั๋วซ่อม — เมื่อคุณแจ้งซ่อม รายการจะขึ้นที่นี่
        </div>
      ) : (
        myRecentTickets.map((rp) => {
          const st = repairStatusStyle(rp.status);
          return (
            <div key={rp.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "11px 13px" }}>
              <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5", flex: "0 0 52px" }}>{rp.machineCode}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1A1D21", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rp.symptom}</div>
                {rp.meterResetRequested && (
                  <div style={{ fontSize: 10.5, color: "#B45309", fontWeight: 600 }}>ขอรีเซ็ตมิเตอร์ · รอผจก.อนุมัติ</div>
                )}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: st.bg, color: st.c, whiteSpace: "nowrap" }}>{st.label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ─────────────────── N3 · นับสต๊อกมือถือ (ProductCountCard list → submitStockCount DRAFT) ─────────────────── */
function StockCountPanel({ orgId, usingDemo, branchId, branchCode, products, warehouses }: {
  orgId: string; usingDemo: boolean; branchId: string; branchCode: string; products: BranchStockProduct[];
  // WAVE-3b · N3 · คลัง active ของสาขานี้ — picker "นับคลัง" โผล่เฉพาะเมื่อ >1 ห้อง (default คลังหลัก).
  warehouses: BranchWarehouse[];
}) {
  // นับต่อสินค้า (null = ยังไม่นับ) · รูปหลักฐานต่อสินค้า (optional)
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // clientKey เดียวต่อการเปิดหน้า (idempotency · กดส่งซ้ำ = ใบเดิม). reset เมื่อส่งสำเร็จ.
  const [clientKey, setClientKey] = useState(() => genClientKey());
  // WAVE-3b · N3 · ห้องที่กำลังนับ — โผล่ picker เฉพาะสาขา >1 ห้อง. default = คลังหลัก (fallback ห้องแรก).
  // null = ส่ง warehouseId ไม่ไป → server นับที่คลังหลัก (INVARIANT) → สาขา ≤1 ห้อง พฤติกรรมเดิมเป๊ะ.
  const showWarehousePicker = warehouses.length > 1;
  const mainWarehouseId = warehouses.find((w) => w.isMain)?.id ?? warehouses[0]?.id ?? "";
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(mainWarehouseId);

  const countedLines = products
    .map((p) => ({ productId: p.id, countedQty: counts[p.id] }))
    .filter((l): l is { productId: string; countedQty: number } => l.countedQty != null);

  const canSubmit = !usingDemo && !!branchId && countedLines.length > 0;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    setOkMsg(null);
    const photoUrls = Object.values(photos).filter(Boolean);
    startTransition(async () => {
      try {
        const r = await submitStockCount({
          branchId,
          lines: countedLines,
          photoUrls: photoUrls.length ? photoUrls : undefined,
          clientKey,
          // WAVE-3b · N3 · ส่งห้องที่นับ เฉพาะสาขา >1 ห้อง (มี picker) → server ตัด/นับที่ห้องนั้น.
          // ≤1 ห้อง / ไม่มี picker → ไม่ส่ง → server นับที่คลังหลัก (INVARIANT · พฤติกรรมเดิม).
          warehouseId: showWarehousePicker && selectedWarehouseId ? selectedWarehouseId : undefined,
        });
        if (!r.ok) {
          console.error("[clawos] submitStockCount failed:", r.error);
          setError(r.error || "บันทึกไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        // field-staff → server บังคับ DRAFT/PENDING (รอผจก.อนุมัติ · ไม่ตัดสต๊อกทันที)
        setOkMsg("ส่งให้ผู้จัดการอนุมัติแล้ว · ยอดจะปรับหลังอนุมัติ");
        setCounts({});
        setPhotos({});
        setClientKey(genClientKey()); // ใบใหม่รอบหน้า
      } catch (e) {
        console.error("[clawos] submitStockCount threw:", e);
        setError("บันทึกไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  if (usingDemo || products.length === 0) {
    return (
      <div>
        {usingDemo
          ? <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — นับสต๊อกจริงได้เมื่อมีสินค้าในคลังสาขา" />
          : (
            <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
              <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="คลังสาขานี้ยังไม่มีสินค้า" sub="รับสินค้าเข้าคลังก่อน แล้วค่อยนับสต๊อก" />
            </div>
          )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11.5, color: "#8A909A", lineHeight: 1.5 }}>
        นับของในคลังสาขาแล้วแตะ + ต่อสินค้า · ส่งแล้วผู้จัดการจะอนุมัติก่อนปรับยอด
      </div>
      {error && (
        <div style={{ background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
      )}
      {okMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#15803D", fontWeight: 600, lineHeight: 1.4 }}>
          <Check size={15} strokeWidth={2.6} />{okMsg}
        </div>
      )}
      {/* WAVE-3b · N3 · เลือกคลัง (ห้อง) ที่กำลังนับ — โผล่เฉพาะสาขาที่มี >1 ห้อง.
          สาขา ≤1 ห้อง → ไม่โชว์ (นับที่คลังหลัก · พฤติกรรมเดิมเป๊ะ · zero friction). */}
      {showWarehousePicker && (
        <div>
          <FieldLabel>นับคลัง</FieldLabel>
          <select value={selectedWarehouseId} onChange={(e) => setSelectedWarehouseId(e.target.value)} style={selectStyle}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.isMain ? " (คลังหลัก)" : ""}</option>
            ))}
          </select>
        </div>
      )}
      {products.map((p) => (
        <ProductCountCard
          key={p.id}
          product={{ id: p.id, name: p.name, imageUrl: p.imageUrl }}
          value={counts[p.id] ?? null}
          onChange={(n) => setCounts((c) => ({ ...c, [p.id]: n }))}
          orgId={orgId}
          machineCode={branchCode}
          eventScopeId={`stockcount-${branchId}`}
          photoUrl={photos[p.id] ?? ""}
          onPhoto={(url) => setPhotos((ph) => ({ ...ph, [p.id]: url }))}
        />
      ))}
      <button type="button" onClick={submit} disabled={!canSubmit || pending}
        className={!canSubmit || pending ? "" : "co-tap"}
        style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, color: "#fff", background: !canSubmit ? "#A8AEB8" : "#4F46E5", border: "none", padding: 13, borderRadius: 12, cursor: !canSubmit || pending ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1 }}>
        {pending ? "กำลังส่ง…" : countedLines.length > 0 ? `ส่งผลนับ ${countedLines.length} รายการให้ผู้จัดการ` : "นับอย่างน้อย 1 รายการก่อน"}
      </button>
    </div>
  );
}

/* ─────────────────── N6 · รับสินค้ามือถือ (ใบกระจายขาเข้า → confirmShipmentReceived) ─────────────────── */
function GoodsReceivePanel({ orgId, usingDemo, branchCode, deliveries, onHandByProduct, receivedDocs }: {
  orgId: string; usingDemo: boolean; branchCode: string; deliveries: InboundDelivery[];
  onHandByProduct: Record<string, number>; // F1 · คลังตอนนี้ต่อสินค้า
  receivedDocs: CfReceivedDoc[]; // F2 · ประวัติรับแล้ว
}) {
  // F2 · แท็บ "รอรับ" | "รับแล้ว" — default = รอรับ (งานที่ต้องทำก่อน)
  const [tab, setTab] = useState<"pending" | "received">("pending");

  if (usingDemo) {
    return <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — รับสินค้าจริงได้เมื่อมีใบกระจายเข้าสาขา" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* segment control — รอรับ (N) | รับแล้ว (N) */}
      <div style={{ display: "flex", gap: 6, background: "#F1F2F5", padding: 4, borderRadius: 12 }}>
        <SegmentBtn active={tab === "pending"} onClick={() => setTab("pending")} label={`รอรับ (${deliveries.length})`} />
        <SegmentBtn active={tab === "received"} onClick={() => setTab("received")} label={`รับแล้ว (${receivedDocs.length})`} />
      </div>

      {tab === "pending" ? (
        deliveries.length === 0 ? (
          <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
            <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="ยังไม่มีสินค้ารอรับ" sub="เมื่อมีใบกระจายส่งเข้าสาขา รายการจะขึ้นที่นี่" />
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "#8A909A", lineHeight: 1.5 }}>
              ตรวจของที่ส่งมา ปรับจำนวนที่รับจริง แล้วกดรับสินค้า (ถ่ายรูปเป็นหลักฐานได้)
            </div>
            {deliveries.map((d) => (
              <DeliveryReceiveCard key={d.id} orgId={orgId} branchCode={branchCode} delivery={d} onHandByProduct={onHandByProduct} />
            ))}
          </>
        )
      ) : receivedDocs.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
          <EmptyState icon={<History size={30} strokeWidth={1.6} />} title="ยังไม่มีประวัติการรับ" sub="ใบที่รับเข้าคลังแล้วจะเก็บไว้ที่นี่ (ไม่หาย)" />
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: "#8A909A", lineHeight: 1.5 }}>
            ใบที่รับเข้าคลังแล้ว · กด &ldquo;ดูใบรับ&rdquo; เพื่อดาวน์โหลดเป็นรูป (ส่งลงไลน์ได้)
          </div>
          {receivedDocs.map((doc) => (
            <ReceivedHistoryCard key={`${doc.source}-${doc.id}`} doc={doc} />
          ))}
        </>
      )}
    </div>
  );
}

// ปุ่ม segment (รอรับ/รับแล้ว) — active = พื้นขาว ยกตัว · inactive = โปร่ง
function SegmentBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, minHeight: 38, borderRadius: 9, border: "none", cursor: "pointer",
        fontSize: 12.5, fontWeight: 700,
        background: active ? "#fff" : "transparent",
        color: active ? "#1A1D21" : "#7A828C",
        boxShadow: active ? "0 1px 3px rgba(16,24,40,0.10)" : "none",
      }}>
      {label}
    </button>
  );
}

// F2 · การ์ดประวัติ "รับแล้ว" 1 ใบ — code/วันที่/ผู้รับ + thumbnail รายการ + ปุ่มดาวน์โหลดใบรับ (Feature 3)
function ReceivedHistoryCard({ doc }: { doc: CfReceivedDoc }) {
  const when = doc.receivedAt.toLocaleDateString("th-TH", {
    day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  });
  // Feature 3 · route ดาวน์โหลดใบรับเป็นรูป PNG (attachment) — ผูกกับ refId ของเอกสารต้นทาง
  const imageHref = `/clawfleet/os/app/receipt/${doc.id}/image`;
  return (
    <div className="co-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1D21" }}>{doc.code}</span>
        <span style={{ flex: 1 }} />
        <span className="co-pill" style={{ background: "#E7F4EC", color: "#15803D" }}>รับแล้ว {doc.unitsCount} ชิ้น</span>
      </div>
      <div style={{ fontSize: 11, color: "#8A909A", display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
        <span>{when}</span>
        {doc.receivedByName ? <span>· ผู้รับ {doc.receivedByName}</span> : null}
        <span>· {doc.source === "dc_transfer" ? "โอนจากคลังกลาง" : "ใบกระจาย"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {doc.lines.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ProductThumb imageUrl={l.imageUrl} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.productName}</div>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "#1A1D21" }}>{l.qty} ชิ้น</span>
          </div>
        ))}
      </div>
      {/* Feature 3 · ดาวน์โหลดใบรับเป็นรูป (route ตั้ง Content-Disposition: attachment) */}
      <a href={imageHref} download
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, fontSize: 13, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", borderRadius: 11, textDecoration: "none", cursor: "pointer" }}>
        <ImageDown size={16} /> ดูใบรับ / ดาวน์โหลด
      </a>
    </div>
  );
}

// รูปสินค้า thumbnail (มือถือ) — มีรูป = <img> · ไม่มี = กล่อง placeholder (ไอคอนกล่อง)
function ProductThumb({ imageUrl, size = 38 }: { imageUrl?: string | null; size?: number }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" style={{ width: size, height: size, flex: `0 0 ${size}px`, objectFit: "cover", borderRadius: 9, border: "1px solid #E7EAF0", background: "#F6F7F9" }} />
    );
  }
  return (
    <span style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 9, border: "1px solid #E7EAF0", background: "#F6F7F9", display: "flex", alignItems: "center", justifyContent: "center", color: "#C2C7D0" }}>
      <PackageOpen size={size * 0.5} strokeWidth={1.6} />
    </span>
  );
}

// การ์ด 1 ใบกระจาย — per-line stepper รับจริง + รูป → confirmShipmentReceived (atomic-claim ที่ server)
//   F1 · โชว์ thumbnail สินค้า + "คลังตอนนี้ N → หลังรับ N+รับ" (display only · server ledger คือ source จริง)
function DeliveryReceiveCard({ orgId, branchCode, delivery, onHandByProduct }: {
  orgId: string; branchCode: string; delivery: InboundDelivery;
  onHandByProduct: Record<string, number>;
}) {
  // จำนวนที่รับจริงต่อบรรทัด — เริ่มด้วยค่าที่ระบุมา (qty) เป็นค่า default (รับครบ) · ปรับลงได้
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(delivery.lines.map((l) => [l.lineId, l.qty])),
  );
  const [photo, setPhoto] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // per-line stepper (keyed by lineId · ไม่ใช่ productId — ใบเดียวมีสินค้าซ้ำหลายบรรทัดได้ → ต้องแยกช่องรับต่อบรรทัด)
  const step = (lineId: string, delta: number, max: number) =>
    setReceived((r) => ({ ...r, [lineId]: Math.max(0, Math.min(max, (r[lineId] ?? 0) + delta)) }));

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        // route ตาม source — ห้ามสลับ write path (คนละ idempotency guard · สลับ = รับซ้ำ/ไม่ตรง refTable):
        //   dc_transfer → confirmTransfer(transferId) · cf_delivery → confirmShipmentReceived(deliveryId)
        if (delivery.source === "dc_transfer") {
          if (!delivery.transferId) {
            setError("ใบโอนไม่ถูกต้อง · ลองรีเฟรชแล้วรับใหม่");
            return;
          }
          // qtyReceived ราย line (default = ที่ส่งมา) — mirror transfer-confirm.tsx confirmPartial
          const r = await confirmTransfer({
            transferId: delivery.transferId,
            lines: delivery.lines.map((l) => ({ lineId: l.lineId, qtyReceived: received[l.lineId] ?? 0 })),
          });
          if (!r.ok) {
            console.error("[clawos] confirmTransfer failed:", r.error);
            setError(r.error || "รับสินค้าไม่สำเร็จ · ลองใหม่อีกครั้ง");
            return;
          }
          // idempotent: ถ้าคนอื่น/ผู้จัดการยืนยันไปก่อน → ok เลย (server คืน ok) → โชว์ "รับแล้ว"
          setDone(true);
          return;
        }

        const r = await confirmShipmentReceived({
          deliveryId: delivery.id,
          photoUrls: photo ? [photo] : undefined,
          // receivedLines ต้องใช้ lineId — delivery.lines มี lineId มากับ prop (ดู mapping ใน page loader)
          receivedLines: delivery.lines.map((l) => ({ lineId: l.lineId, receivedQty: received[l.lineId] ?? 0 })),
        });
        if (!r.ok) {
          console.error("[clawos] confirmShipmentReceived failed:", r.error);
          setError(r.error || "รับสินค้าไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        // atomic-claim: ถ้าคนอื่นรับไปก่อน → alreadyReceived (ไม่ error) → โชว์ "รับแล้ว"
        setDone(true);
      } catch (e) {
        console.error("[clawos] confirm receive threw:", e);
        setError("รับสินค้าไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  if (done) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 13, padding: "13px 15px" }}>
        <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: "#15803D", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check size={18} strokeWidth={2.6} />
        </span>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>รับสินค้าเข้าคลังแล้ว</div>
      </div>
    );
  }

  return (
    <div className="co-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1D21" }}>ใบกระจาย {delivery.itemsCount} รายการ · {delivery.unitsCount} ชิ้น</span>
        <span style={{ flex: 1 }} />
        <span className="co-pill" style={{ background: "#F1F2F7", color: "#5A6270" }}>{delivery.status === "IN_TRANSIT" ? "กำลังส่ง" : "นัดส่ง"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {delivery.lines.map((l) => {
          const rcv = received[l.lineId] ?? 0;
          // F1 · คลังตอนนี้ต่อสินค้า (จาก server ledger) → "คลังตอนนี้ N → หลังรับ N+รับ" (display · เลขจริง = ที่ server คิด)
          const onHand = onHandByProduct[l.productId];
          const hasOnHand = typeof onHand === "number";
          return (
            <div key={l.lineId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ProductThumb imageUrl={l.imageUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.productName}</div>
                <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ส่งมา <span className="num">{l.qty}</span> ชิ้น</div>
                {hasOnHand ? (
                  <div style={{ fontSize: 10.5, color: "#4F46E5", marginTop: 1 }}>
                    คลังตอนนี้ <span className="num">{onHand}</span> → หลังรับ <span className="num">{onHand + rcv}</span>
                  </div>
                ) : null}
              </div>
              <button type="button" aria-label="ลด" onClick={() => step(l.lineId, -1, l.qty)} disabled={rcv <= 0}
                style={{ width: 40, height: 40, flex: "0 0 40px", borderRadius: 10, border: "1.5px solid #E3E6EA", background: "#fff", color: "#5A6270", fontSize: 20, fontWeight: 700, cursor: "pointer" }}>−</button>
              <span className="num" style={{ width: 40, textAlign: "center", fontSize: 16, fontWeight: 700, color: "#1A1D21" }}>{rcv}</span>
              <button type="button" aria-label="เพิ่ม" onClick={() => step(l.lineId, 1, l.qty)}
                style={{ width: 40, height: 40, flex: "0 0 40px", borderRadius: 10, border: "none", background: "#4F46E5", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer" }}>+</button>
            </div>
          );
        })}
      </div>
      <PhotoCaptureButton label={photo ? "แนบรูปแล้ว · แตะถ่ายใหม่" : "ถ่ายรูปตอนรับ (ถ่ายได้-ข้ามได้)"}
        value={photo} onChange={setPhoto} orgId={orgId} machineCode={branchCode}
        eventScopeId={`receive-${delivery.id}`} phase="goods_receipt" />
      {error && (
        <div style={{ background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
      )}
      <button type="button" onClick={submit} disabled={pending}
        className={pending ? "" : "co-tap"}
        style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, color: "#fff", background: "#15803D", border: "none", padding: 13, borderRadius: 12, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}>
        {pending ? "กำลังรับ…" : "กดรับสินค้า"}
      </button>
    </div>
  );
}

/* ─────────────────── 🆕 คืนตุ๊กตาจากตู้เข้าคลัง (return-dolls · ราย SKU + รูป + ยืนยันจำนวนเดิม) ───────────────────
 * bottom-sheet มือถือ · 3 ขั้นในจอเดียว:
 *   1) เลือกตุ๊กตาที่จะคืน (รายการในตู้ · รูป + ชื่อ/SKU + "ในตู้ N ตัว") — มีตัวเดียว preselect
 *   2) ยืนยันจำนวนเดิม (โชว์ "ในตู้ N ตัว" เด่น ๆ · ให้กดยืนยันก่อนกรอกจำนวนคืน)
 *   3) กรอกจำนวนที่เอาออก/คืน (พิมพ์ได้ · −/+ · clamp [0, ในตู้]) + โชว์ "ของว่างในคลัง A → A+N"
 * ทุกเลขที่โชว์มาจาก server loader (dolls[].qty, netAvailable) — ไม่ใช่ client เดา (ตรงกับที่ server enforce).
 * clientKey = crypto.randomUUID ครั้งเดียวตอนเปิด sheet (stable ข้าม retry) → กดซ้ำ/double-tap = คืนครั้งเดียว. */
function ReturnDollsSheet({ machine, dolls, netAvailable, usingDemo, onClose }: {
  machine: AppMachine;
  dolls: InMachineDoll[];
  netAvailable: Record<string, number>; // productId → "ของว่างในคลัง" (คลัง − ในตู้) จาก server
  usingDemo: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  // เลือกตัวเดียวอัตโนมัติเมื่อในตู้มีสินค้าเดียว (CEO: "มีตัวเดียว preselect")
  const [selectedId, setSelectedId] = useState<string | null>(dolls.length === 1 ? dolls[0].productId : null);
  // ยืนยันจำนวนเดิม (CEO: "ยืนยันจำนวนเดิม") — ต้องกดก่อนถึงจะกรอกจำนวนคืนได้
  const [qtyConfirmed, setQtyConfirmed] = useState(false);
  // จำนวนที่เอาออก/คืน (null = ยังไม่กรอก) — พิมพ์ได้ + −/+ · clamp ตอน submit
  const [qty, setQty] = useState<Counted>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // clientKey เดียวต่อการ "เปิด sheet 1 ครั้ง" (idempotency · UUID) — stable ข้าม retry (double-tap ไม่คืนซ้ำ)
  const [clientKey] = useState(() => genClientKey());

  const selected = dolls.find((d) => d.productId === selectedId) ?? null;
  const inMachineQty = selected?.qty ?? 0;
  const qtyNum = qty == null ? 0 : qty;
  // ยอดคืนต้องอยู่ใน [1, ในตู้] — เกิน/≤0 = บล็อกส่ง (server ก็ enforce อีกชั้น)
  const qtyValid = qtyNum > 0 && qtyNum <= inMachineQty;
  const nudge = (delta: number) => {
    const next = Math.max(0, Math.min(inMachineQty, qtyNum + delta));
    setQty(next);
  };
  // "ของว่างในคลัง" ปัจจุบัน + หลังคืน (จาก server net-available · โชว์ให้เห็นคลังเพิ่มขึ้น)
  const roomNow = selected ? netAvailable[selected.productId] ?? 0 : 0;
  const roomAfter = roomNow + qtyNum;

  // เปลี่ยนสินค้าที่เลือก → รีเซ็ตขั้นยืนยัน + จำนวน (กันจำนวนของตัวก่อนหน้าค้าง)
  function pick(pid: string) {
    setSelectedId(pid);
    setQtyConfirmed(false);
    setQty(null);
    setError(null);
    setOkMsg(null);
  }

  function submit() {
    if (!selected || !qtyValid || pending) return;
    setError(null);
    setOkMsg(null);
    // demo → optimistic (ไม่มี backend · ปิด sheet)
    if (usingDemo || isDemo(machine.id)) {
      setOkMsg(`คืน ${qtyNum} ตัวเข้าคลังแล้ว (ตัวอย่าง)`);
      setTimeout(onClose, 900);
      return;
    }
    startTransition(async () => {
      try {
        const res = await returnDollsToStock({
          machineId: machine.id,
          productId: selected.productId,
          qty: qtyNum,
          clientKey, // UUID เดียวต่อ sheet → กดซ้ำ = คืนครั้งเดียว (idempotent ที่ server)
        });
        if (!res.ok) {
          setError(res.error || "คืนไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return; // ค้างที่ sheet ให้เห็น error (ไม่ปิด)
        }
        // เลขที่โชว์ = server-computed (inMachineAfter) — ยอดจริงหลังคืน
        setOkMsg(`คืน ${qtyNum} ตัวเข้าคลังแล้ว · เหลือในตู้ ${res.data.inMachineAfter}`);
        router.refresh(); // reload loader → ยอดในตู้/ของว่างในคลังอัปเดต
        setTimeout(onClose, 1100);
      } catch {
        setError("คืนไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`คืนตุ๊กตาจากตู้ ${machine.code} เข้าคลัง`}
      style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
    >
      {/* backdrop — แตะเพื่อปิด (ยกเว้นกำลังส่ง) */}
      <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }}
        style={{ position: "absolute", inset: 0, background: "rgba(15,18,26,0.42)", border: "none", cursor: pending ? "default" : "pointer" }} />
      {/* sheet */}
      <div style={{ position: "relative", background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 18px 22px", maxHeight: "88%", overflowY: "auto", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "#E3E6EA", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#EFFAF3", color: "#15803D", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PackageOpen size={18} strokeWidth={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>เอาตุ๊กตาออก · คืนเข้าคลัง</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตู้ <span className="num">{machine.code}</span> · {machine.branch}</div>
          </div>
          <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }} className="co-tap"
            style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={17} color="#5A6270" strokeWidth={2.2} />
          </button>
        </div>

        {dolls.length === 0 ? (
          <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14, marginTop: 10 }}>
            <EmptyState icon={<Inbox size={28} strokeWidth={1.6} />} title="ตู้นี้ไม่มีตุ๊กตาในตู้" sub="เติมตุ๊กตาก่อน แล้วค่อยคืนเข้าคลัง" />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {/* 1) เลือกตุ๊กตาที่จะคืน — รายการในตู้ (รูป + ชื่อ/SKU + ในตู้ N ตัว) */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54" }}>เลือกตุ๊กตาที่จะคืน</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dolls.map((d) => {
                const active = d.productId === selectedId;
                return (
                  <button key={d.productId} type="button" onClick={() => pick(d.productId)}
                    className="co-tap"
                    style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 60, background: active ? "#F2FBF5" : "#fff", border: `1.5px solid ${active ? "#BFE6CB" : "#E8EAED"}`, borderRadius: 13, padding: "10px 12px", textAlign: "left", cursor: "pointer" }}>
                    <DollThumb imageUrl={d.imageUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: "#9AA1AB" }} className="num">{d.sku} · ในตู้ {d.qty} ตัว</div>
                    </div>
                    {active && <Check size={18} color="#15803D" strokeWidth={2.6} />}
                  </button>
                );
              })}
            </div>

            {selected && (
              <>
                {/* 2) ยืนยันจำนวนเดิม — โชว์ "ในตู้ N ตัว" เด่น · กดยืนยันก่อนกรอกจำนวนคืน */}
                <div style={{ background: "#F6F7FA", border: "1px solid #E8EAED", borderRadius: 14, padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: "#6B7280" }}>ตอนนี้ในตู้มี</div>
                    <div className="num" style={{ fontSize: 24, fontWeight: 700, color: "#1A1D21" }}>{inMachineQty} <span style={{ fontSize: 13, fontWeight: 600, color: "#6B7280" }}>ตัว</span></div>
                  </div>
                  {qtyConfirmed ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#15803D", background: "#E7F4EC", borderRadius: 20, padding: "6px 12px" }}>
                      <Check size={14} strokeWidth={2.6} /> ยืนยันแล้ว
                    </span>
                  ) : (
                    <button type="button" onClick={() => setQtyConfirmed(true)} className="co-tap"
                      style={{ minHeight: 44, fontSize: 13, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: "10px 16px", borderRadius: 11, cursor: "pointer" }}>
                      ยืนยันจำนวนนี้
                    </button>
                  )}
                </div>

                {/* 3) กรอกจำนวนที่เอาออก/คืน — พิมพ์ได้ + −/+ · clamp [0, ในตู้] (เปิดหลังยืนยัน) */}
                {qtyConfirmed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <FieldLabel>จำนวนที่เอาออก / คืน</FieldLabel>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <button type="button" aria-label="ลด" onClick={() => nudge(-1)} disabled={qtyNum <= 0} className="co-tap"
                        style={{ width: 52, height: 52, flex: "0 0 52px", borderRadius: 12, border: "1.5px solid #E3E6EA", background: "#F6F7FA", fontSize: 24, fontWeight: 700, color: "#454B54", display: "flex", alignItems: "center", justifyContent: "center", cursor: qtyNum <= 0 ? "not-allowed" : "pointer", opacity: qtyNum <= 0 ? 0.5 : 1 }}>−</button>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"
                        value={qty == null ? "" : String(qty)}
                        onChange={(e) => {
                          // strip อักขระที่ไม่ใช่ตัวเลข + clamp ไม่ให้เกินยอดในตู้ (mirror CountField)
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          if (raw === "") { setQty(null); return; }
                          setQty(Math.min(inMachineQty, Number(raw)));
                        }}
                        className="num"
                        style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 22, fontWeight: 700, padding: "13px 10px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />
                      <button type="button" aria-label="เพิ่ม" onClick={() => nudge(1)} disabled={qtyNum >= inMachineQty} className="co-tap"
                        style={{ width: 52, height: 52, flex: "0 0 52px", borderRadius: 12, border: "none", background: "#4F46E5", color: "#fff", fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: qtyNum >= inMachineQty ? "not-allowed" : "pointer", opacity: qtyNum >= inMachineQty ? 0.5 : 1 }}>+</button>
                    </div>
                    <div style={{ fontSize: 11, color: "#9AA1AB" }} className="num">คืนได้สูงสุด {inMachineQty} ตัว</div>

                    {/* 4) context: ของว่างในคลังของ SKU นี้ เพิ่มขึ้นหลังคืน (เลขจาก server net-available) */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#EFFAF3", border: "1px solid #C8E9D3", borderRadius: 11, padding: "10px 13px" }}>
                      <span style={{ fontSize: 12, color: "#256B3E" }}>ของว่างในคลังของ SKU นี้</span>
                      <span style={{ flex: 1 }} />
                      <span className="num" style={{ fontSize: 13.5, fontWeight: 700, color: "#256B3E" }}>{roomNow}</span>
                      <ChevronRight size={14} color="#7FBF97" strokeWidth={2.4} />
                      <span className="num" style={{ fontSize: 15, fontWeight: 700, color: "#15803D" }}>{roomAfter}</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && (
              <div style={{ background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
            )}
            {okMsg && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "9px 12px", fontSize: 12, color: "#15803D", fontWeight: 600, lineHeight: 1.4 }}>
                <Check size={15} strokeWidth={2.6} />{okMsg}
              </div>
            )}

            {/* ปุ่มคืน — บล็อกถ้ายังไม่เลือก/ยังไม่ยืนยัน/จำนวนไม่ถูกต้อง (server enforce ซ้ำอีกชั้น) */}
            <button type="button" onClick={submit} disabled={!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg}
              className={(!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg) ? "" : "co-tap"}
              style={{ width: "100%", minHeight: 50, fontSize: 14.5, fontWeight: 700, color: "#fff", background: (!qtyConfirmed || !qtyValid || !!okMsg) ? "#A8AEB8" : "#15803D", border: "none", padding: 14, borderRadius: 13, cursor: (!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg) ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1, marginTop: 2 }}>
              {pending ? "กำลังคืน…" : qtyValid ? `คืน ${qtyNum} ตัวเข้าคลัง` : "เลือกตุ๊กตา + ใส่จำนวนก่อน"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// รูปตุ๊กตาเล็ก (thumbnail) — มีรูป = แสดงรูป · ไม่มี = กล่อง placeholder (mirror ProductCountCard)
function DollThumb({ imageUrl }: { imageUrl: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" style={{ width: 44, height: 44, flex: "0 0 44px", borderRadius: 11, objectFit: "cover", background: "#F1F2F5" }} />;
  }
  return (
    <span style={{ width: 44, height: 44, flex: "0 0 44px", borderRadius: 11, background: "#F1F2F5", color: "#B9BEC7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Inbox size={18} strokeWidth={1.7} />
    </span>
  );
}

/* TASK C · หัวข้อชื่อตู้ — ชื่อเล่นเด่น (ใหญ่) + รหัสเป็นรอง (เล็ก) เมื่อมีชื่อเล่น · ไม่มี → โชว์รหัสเหมือนเดิม. */
function MachineHeaderTitle({ prefix, machine }: { prefix: string; machine: AppMachine | null }) {
  if (!machine) {
    return <div style={{ fontSize: 14.5, fontWeight: 700 }}>{prefix} · <span className="num">—</span></div>;
  }
  if (machine.nickname) {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prefix} · {machine.nickname}</div>
        <div style={{ fontSize: 10.5, color: "#B0B6BF", fontWeight: 600 }} className="num">{machine.code}</div>
      </div>
    );
  }
  return <div style={{ fontSize: 14.5, fontWeight: 700 }}>{prefix} · <span className="num">{machine.code}</span></div>;
}

/* TASK C · sheet ตั้ง "ชื่อเล่น" ตู้ (bottom-sheet · mirror ReturnDollsSheet) — text field + บันทึก/ยกเลิก.
 * บันทึก → renameMachineNickname({machineId,nickname}) ใน startTransition · {ok:false} โชว์ error ·
 * สำเร็จ → router.refresh() (server ส่งชื่อใหม่กลับ) + ปิด. ว่าง = ล้างชื่อเล่น (server รับ ""). */
function NicknameSheet({ machine, onClose }: { machine: AppMachine; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(machine.nickname ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await renameMachineNickname({ machineId: machine.id, nickname: name.trim() });
        if (!res.ok) {
          setError(res.error || "ตั้งชื่อไม่สำเร็จ · ลองใหม่อีกครั้ง");
          return;
        }
        router.refresh(); // reload loader → machine.nickname อัปเดตทั้งรายการ/หัวข้อ
        onClose();
      } catch {
        setError("ตั้งชื่อไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ตั้งชื่อเล่นตู้ ${machine.code}`}
      style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
    >
      <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }}
        style={{ position: "absolute", inset: 0, background: "rgba(15,18,26,0.42)", border: "none", cursor: pending ? "default" : "pointer" }} />
      <div style={{ position: "relative", background: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 18px 22px", boxShadow: "0 -8px 30px rgba(0,0,0,0.18)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "#E3E6EA", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#EEF0FE", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>ตั้งชื่อเล่นตู้</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตู้ <span className="num">{machine.code}</span> · {machine.branch}</div>
          </div>
          <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }} className="co-tap"
            style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={17} color="#5A6270" strokeWidth={2.2} />
          </button>
        </div>

        <FieldLabel>ชื่อเล่น (จำง่าย — เว้นว่างเพื่อล้างชื่อ)</FieldLabel>
        <input type="text" value={name} maxLength={60} placeholder="เช่น ตู้หน้าประตู, ตู้คิตตี้"
          onChange={(e) => setName(e.target.value)} autoFocus
          style={{ width: "100%", fontSize: 16, fontWeight: 600, padding: "12px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />

        {error && (
          <div style={{ marginTop: 10, background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={() => { if (!pending) onClose(); }}
            style={{ flex: "0 0 auto", minHeight: 50, fontSize: 14, fontWeight: 700, color: "#5A6270", background: "#F1F2F5", border: "none", padding: "0 20px", borderRadius: 13, cursor: pending ? "default" : "pointer" }}>
            ยกเลิก
          </button>
          <button type="button" onClick={save} disabled={pending}
            className={pending ? "" : "co-tap"}
            style={{ flex: 1, minHeight: 50, fontSize: 14.5, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: 14, borderRadius: 13, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}>
            {pending ? "กำลังบันทึก…" : "บันทึกชื่อ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigPanel() {
  const rows = [
    { code: "RS-03", status: "ตั้งค่าแล้ว", note: "ความแรง 50% · รอเจ้าของตรวจ", ok: true },
    { code: "BK-02", status: "รอตั้งค่า", note: "ตู้ยากไป (เก็บ ฿480 ออก 0) ต้องปรับ", ok: false },
    { code: "RS-07", status: "ตั้งค่าแล้ว", note: "ความแรง 48% · ปกติ", ok: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <ComingSoonBanner text="หน้าตั้งค่าตู้ยังไม่เปิดใช้จริง — เป็นตัวอย่างหน้าตา · เร็ว ๆ นี้" />
      {rows.map((cf) => (
        <div key={cf.code} style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>{cf.code}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 11px", borderRadius: 20, background: cf.ok ? "#E7F4EC" : "#FCF1E2", color: cf.ok ? "#15803D" : "#B45309" }}>{cf.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#6B7280" }}>{cf.note}</div>
          {!cf.ok && (
            <button type="button" disabled style={{ width: "100%", fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#B45309", border: "none", padding: 9, borderRadius: 9, cursor: "not-allowed", marginTop: 9, opacity: 0.5 }}>ตั้งค่าตู้นี้ตอนนี้ (เร็ว ๆ นี้)</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── TOUR (3 steps เบิก → เติม → คืน) ─────────────────────────── */
const TOUR_PRODUCTS = [
  { key: "kitty", name: "ซานริโอ้ คิตตี้", def: 90 },
  { key: "mochi", name: "โมจิหมีขาว", def: 80 },
  { key: "brown", name: "หมีน้ำตาล S", def: 80 },
  { key: "kuma", name: "คุมะ ไซส์ M", def: 50 },
];
const TOUR_MACHINES = [
  { code: "7-LP", branch: "ลาดพร้าว", need: 36 }, { code: "7-RS", branch: "รังสิต", need: 40 },
  { code: "7-BK", branch: "บางแค", need: 28 }, { code: "7-SN", branch: "ศรีนครินทร์", need: 34 },
  { code: "7-ON", branch: "อ่อนนุช", need: 30 }, { code: "7-NB", branch: "นนทบุรี", need: 32 },
  { code: "7-BN", branch: "บางนา", need: 30 }, { code: "7-RK", branch: "รามคำแหง", need: 30 },
];

function TourPanel({ tourStep, setTourStep }: { tourStep: number; setTourStep: (n: number) => void }) {
  const [draw, setDraw] = useState<Record<string, number>>(() =>
    Object.fromEntries(TOUR_PRODUCTS.map((p) => [p.key, p.def])),
  );
  const [filled, setFilled] = useState<Record<string, boolean>>({});

  const totalDrawn = TOUR_PRODUCTS.reduce((a, p) => a + (draw[p.key] || 0), 0);
  const usedDolls = TOUR_MACHINES.filter((m) => filled[m.code]).reduce((a, m) => a + m.need, 0);
  const filledCount = TOUR_MACHINES.filter((m) => filled[m.code]).length;
  const bagLeft = Math.max(0, totalDrawn - usedDolls);
  const fillPct = Math.round((filledCount / TOUR_MACHINES.length) * 100);

  const pill = (n: number) => {
    const active = tourStep === n, done = tourStep > n;
    return { flex: 1, textAlign: "center" as const, fontSize: 11, fontWeight: 700, padding: "7px 4px", borderRadius: 8, background: active ? "#4F46E5" : done ? "#E7F4EC" : "#F1F2F5", color: active ? "#fff" : done ? "#15803D" : "#9AA1AB" };
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <span style={pill(0)}>1 · เบิก</span>
        <span style={pill(1)}>2 · เติม</span>
        <span style={pill(2)}>3 · คืน</span>
      </div>

      {tourStep === 0 && (
        <div>
          <div style={{ background: "#EEF0FE", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#4F46E5", lineHeight: 1.5 }}>เบิกตุ๊กตาจากคลังกลางก่อนออกทัวร์ — ปรับจำนวนให้พอสำหรับ 8 ตู้ 7-11</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {TOUR_PRODUCTS.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "11px 13px" }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <button type="button" onClick={() => setDraw((d) => ({ ...d, [p.key]: Math.max(0, (d[p.key] || 0) - 10) }))} style={{ width: 30, height: 30, borderRadius: 9, background: "#F1F2F5", border: "none", fontSize: 18, fontWeight: 700, color: "#454B54", cursor: "pointer" }}>−</button>
                <span className="num" style={{ width: 42, textAlign: "center", fontSize: 15, fontWeight: 700 }}>{draw[p.key]}</span>
                <button type="button" onClick={() => setDraw((d) => ({ ...d, [p.key]: (d[p.key] || 0) + 10 }))} style={{ width: 30, height: 30, borderRadius: 9, background: "#EEF0FE", border: "none", fontSize: 18, fontWeight: 700, color: "#4F46E5", cursor: "pointer" }}>+</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#1A1D21", color: "#fff", borderRadius: 12, padding: "13px 16px", marginTop: 16 }}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>รวมเบิกจากคลังกลาง</span>
            <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{totalDrawn} ตัว</span>
          </div>
          <button type="button" onClick={() => setTourStep(1)} style={tourBtn("#4F46E5")}>ยืนยันเบิก · เริ่มไล่เติม →</button>
        </div>
      )}

      {tourStep === 1 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: "#9AA1AB" }}>ตุ๊กตาในกระเป๋า (เหลือ)</div><div className="num" style={{ fontSize: 20, fontWeight: 700, color: "#4F46E5" }}>{bagLeft} ตัว</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#9AA1AB" }}>เติมแล้ว</div><div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{filledCount}/{TOUR_MACHINES.length} ตู้</div></div>
          </div>
          <div style={{ height: 7, background: "#EDEFF2", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}><span style={{ display: "block", height: "100%", width: `${fillPct}%`, background: "#4F46E5", borderRadius: 6, transition: "width .2s" }} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {TOUR_MACHINES.map((m) => {
              const done = !!filled[m.code];
              return (
                <button key={m.code} type="button" onClick={() => setFilled((s) => ({ ...s, [m.code]: !s[m.code] }))}
                  style={{ display: "flex", alignItems: "center", gap: 11, background: done ? "#F2FBF5" : "#fff", border: `1px solid ${done ? "#BFE6CB" : "#E8EAED"}`, borderRadius: 12, padding: "11px 13px", cursor: "pointer", textAlign: "left" }}>
                  <span className="num" style={{ width: 42, height: 42, flex: "0 0 42px", borderRadius: 11, background: "#F1F2F7", color: "#B45309", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.code}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>7-11 {m.branch}</div><div style={{ fontSize: 11, color: "#9AA1AB" }}>เติม {m.need} ตัว</div></div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: done ? "#E7F4EC" : "#F1F2F7", color: done ? "#15803D" : "#9AA1AB", whiteSpace: "nowrap" }}>{done ? <>เติมแล้ว <Check size={13} strokeWidth={2.8} /></> : "แตะเพื่อเติม"}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setTourStep(2)} style={tourBtn("#15803D")}>ไปคืนของเหลือ →</button>
        </div>
      )}

      {tourStep === 2 && (
        <div>
          <div style={{ background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#B45309", lineHeight: 1.5 }}>คืนตุ๊กตาที่เหลือกลับคลังกลาง — ระบบกระทบยอด เบิก = เติม + คืน อัตโนมัติ</div>
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr", padding: "10px 14px", fontSize: 10.5, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
              <span>สินค้า</span><span style={{ textAlign: "right" }}>เบิก</span><span style={{ textAlign: "right" }}>เติม</span><span style={{ textAlign: "right" }}>คืน</span>
            </div>
            {TOUR_PRODUCTS.map((p) => {
              const drawn = draw[p.key] || 0;
              const used = totalDrawn > 0 ? Math.round((usedDolls * drawn) / totalDrawn) : 0;
              return (
                <div key={p.key} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr", padding: "11px 14px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span className="num" style={{ textAlign: "right" }}>{drawn}</span>
                  <span className="num" style={{ textAlign: "right", color: "#15803D" }}>{used}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: "#B45309" }}>{Math.max(0, drawn - used)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 9, marginBottom: 6 }}>
            <div style={{ flex: 1, background: "#F8F9FB", borderRadius: 11, padding: 11, textAlign: "center" }}><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>เบิกไป</div><div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{totalDrawn}</div></div>
            <div style={{ flex: 1, background: "#F2FBF5", borderRadius: 11, padding: 11, textAlign: "center" }}><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>เติมไป</div><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#15803D" }}>{usedDolls}</div></div>
            <div style={{ flex: 1, background: "#FCF8EC", borderRadius: 11, padding: 11, textAlign: "center" }}><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>คืนคลัง</div><div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#B45309" }}>{bagLeft}</div></div>
          </div>
          <button type="button" onClick={() => { setTourStep(0); setFilled({}); }} style={tourBtn("#4F46E5")}>ยืนยันคืน · จบทัวร์</button>
        </div>
      )}
    </div>
  );
}

const tourBtn = (bg: string) =>
  ({ width: "100%", fontSize: 14.5, fontWeight: 700, color: "#fff", background: bg, border: "none", padding: 14, borderRadius: 13, cursor: "pointer", marginTop: 14 } as const);

/* ─────────────────── B1 · PHOTO HUB — "รีบถ่ายรูปก่อน" (รวมทุกช่องในที่เดียว) ───────────────────
 * พนักงานหลายคนอยากรีบถ่ายรูปทุกมุมของตู้ในที่เดียว แล้วค่อยกลับมากรอกตัวเลข.
 * หน้านี้รวม PhotoSlot ทุกช่อง (ก่อนเติม/หลังเติม/มิเตอร์เหรียญ×2/มิเตอร์ตุ๊กตา×2/เงินสด)
 * → ถ่ายช่องไหนก่อน-หลังก็ได้ → "บันทึกค้าง · ไปตู้ต่อไป" (reuse saveDraft) เพื่อรัวไปตู้ถัดไป.
 * UI REGROUP อย่างเดียว: ใช้ Photos model + upload pipeline เดิม (onPhoto/onCapture ตัวเดียวกับ wizard).
 * รูปยังถ่ายในขั้น wizard ปกติได้เหมือนเดิม (ไม่ได้เอาออก). money-safe: ไม่มีการเขียน DB event ที่นี่. */
function PhotoHubScreen(props: {
  machine: AppMachine | null;
  orgId: string;
  usingDemo: boolean;
  eventScopeId: string;
  photos: Photos;
  onPhoto: (k: keyof Photos, url: string) => void;
  onCapture: (k: keyof Photos) => void;
  onSaveDraft: () => void; // บันทึกค้าง (เก็บรูป+ฟอร์ม) → ไปหน้าหลัก เก็บตู้อื่นต่อ
  uploadPending: boolean; // FIX-1 · ยังมีรูปอัปโหลดค้าง → disable ปุ่มบันทึกค้าง (กันรูปหาย)
  onContinue: () => void; // ไปกรอกตัวเลขต่อ (เข้า wizard ขั้น 1)
  onBack: () => void;
}) {
  const { machine, photos } = props;
  // นับรูปที่ถ่ายแล้ว (มี url) — โชว์ความคืบหน้า "ถ่ายแล้ว N/7"
  const slotKeys: (keyof Photos)[] = ["before", "after", "coinGear", "coinDigi", "dollGear", "dollDigi", "cash"];
  const takenCount = slotKeys.filter((k) => !!photos[k]).length;
  // demo ไม่มี backend upload → บันทึกค้างจริงไม่ได้ (saveDraft ข้าม demo อยู่แล้ว) · ปุ่มยังกดดู flow ได้
  const slot = (key: keyof Photos, label: string, phase: Phase) => (
    <PhotoSlot label={label} value={photos[key]}
      onChange={(url) => props.onPhoto(key, url)} onCaptured={() => props.onCapture(key)}
      orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase={phase} disabled={props.usingDemo} />
  );
  const groupTitle = (t: string) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", margin: "2px 0 2px" }}>{t}</div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* header กระชับ (back + ชื่อตู้ + จำนวนที่ถ่าย) */}
      <div style={{ padding: "4px 18px 10px", borderBottom: "1px solid #EAECEF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <button type="button" onClick={props.onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>ถ่ายรูปก่อน · <span className="num">{machine?.code ?? "—"}</span></div>
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{machine ? `${machine.branch} · ${machine.zone}` : ""}</div>
          </div>
          <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "4px 10px", borderRadius: 20 }}>ถ่ายแล้ว {takenCount}/7</span>
        </div>
      </div>

      {/* body — ทุกช่องถ่ายรูปในที่เดียว (ถ่ายช่องไหนก่อนก็ได้) */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 20px" }}>
        <div style={{ display: "flex", gap: 9, background: "#F5F5FE", border: "1px solid #D9D6F5", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <span style={{ flex: "0 0 20px", color: "#4F46E5", marginTop: 1 }}><Camera size={18} strokeWidth={2} /></span>
          <span style={{ fontSize: 11.5, color: "#4338CA", lineHeight: 1.5 }}>
            ถ่ายรูปทุกมุมของตู้รวดเดียวตรงนี้ (ช่องไหนก่อนก็ได้ · ข้ามได้) แล้วกด <b>บันทึกค้าง · ไปตู้ต่อไป</b> เพื่อรีบไปตู้ถัดไป — กลับมากรอกตัวเลขในที่ร่มทีหลัง
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupTitle("สินค้าในตู้")}
            {slot("before", "ก่อนเติม (สินค้าในตู้)", "stock")}
            {slot("after", "หลังเติม (สินค้าในตู้)", "stock_after")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupTitle("มิเตอร์เหรียญ (เฟือง + ดิจิตอล)")}
            {slot("coinGear", "มิเตอร์เหรียญ · เฟือง (บน)", "meter_after")}
            {slot("coinDigi", "มิเตอร์เหรียญ · ดิจิตอล (ล่าง)", "meter_after")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupTitle("มิเตอร์ตุ๊กตา (เฟือง + ดิจิตอล)")}
            {slot("dollGear", "มิเตอร์ตุ๊กตา · เฟือง (บน)", "prize_meter")}
            {slot("dollDigi", "มิเตอร์ตุ๊กตา · ดิจิตอล (ล่าง)", "prize_meter")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groupTitle("เงินสด")}
            {slot("cash", "เงินสดที่นับได้", "cash")}
          </div>
        </div>
      </div>

      {/* bottom bar — บันทึกค้าง (รัวไปตู้ต่อไป) เป็น primary · กรอกตัวเลขต่อ เป็น secondary */}
      <div style={{ padding: "14px 18px 22px", borderTop: "1px solid #EAECEF", background: "#fff" }}>
        {/* FIX-1 · disable ตอน demo หรือมีรูปอัปโหลดค้าง (uploadPending) → กันบันทึกก่อนรูปขึ้น = รูปหาย */}
        {(() => {
          const saveDisabled = props.usingDemo || props.uploadPending;
          return (
            <button type="button" onClick={props.onSaveDraft} disabled={saveDisabled}
              className={saveDisabled ? "" : "co-tap co-pbtn"}
              style={{ width: "100%", minHeight: 50, fontSize: 15, fontWeight: 700, color: "#fff", border: "none", padding: "14px 16px", borderRadius: 13, cursor: saveDisabled ? "not-allowed" : "pointer", background: "#B45309", opacity: saveDisabled ? 0.55 : 1, boxShadow: saveDisabled ? "none" : "0 8px 18px -10px rgba(27,30,42,0.5)" }}>
              {props.uploadPending ? "⏳ กำลังอัปโหลดรูป… รอสักครู่" : "บันทึกค้าง · ไปตู้ต่อไป"}
            </button>
          );
        })()}
        {props.usingDemo && (
          <div style={{ fontSize: 10.5, color: "#9AA1AB", textAlign: "center", marginTop: 6 }}>โหมดตัวอย่าง — บันทึกค้างจริงได้เมื่อมีตู้ในระบบ</div>
        )}
        <button type="button" onClick={props.onContinue} style={{ width: "100%", minHeight: 44, fontSize: 13, fontWeight: 600, color: "#4F46E5", border: "none", padding: "11px 0 2px", background: "transparent", cursor: "pointer" }}>
          กรอกตัวเลขต่อเลย (นับ → เติม → มิเตอร์ → เงินสด)
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── FLOW (6-step wizard) ─────────────────────────── */
type ReconData = { dollDelta: number; expectedCash: number; dollMatch: boolean; cashMatch: boolean; meterEqualOk: boolean; allMatch: boolean };

function FlowScreen(props: {
  orgId: string;
  usingDemo: boolean;
  eventScopeId: string;
  machine: AppMachine | null;
  step: number;
  stepLabel: string;
  form: Form;
  setNum: (key: keyof Form) => (v: string) => void;
  dispensed: number;
  afterFill: number;
  photos: Photos;
  onPhoto: (k: keyof Photos, url: string) => void;
  onCapture: (k: keyof Photos) => void;
  photoRequired: boolean;
  photoBlocks: boolean;
  countBlocks: boolean;
  meterDeferred: boolean;
  toggleDefer: () => void;
  onSkipBroken: () => void; // ตู้เสีย/อ่านมิเตอร์ไม่ได้ → แจ้งซ่อม & ข้าม
  skipPending: boolean;
  resumed: boolean;
  meterGroupVals: { dollMeterEqual: boolean; coinMeterEqual: boolean };
  recon: ReconData;
  tooHard: boolean;
  configSent: boolean;
  sendConfig: () => void;
  skus: CollectSku[];
  onProduct: (v: string) => void;
  onCategory: (v: string) => void;
  // R4 · สินค้าคลังสาขา (ตู้นี้) + handler เลือกจาก picker. [] → fallback dropdown เดิม.
  branchProducts: BranchStockProduct[];
  // 🆕 net "ของบนชั้นจริง" ต่อ productId (คลัง − ในตู้) — picker เติมใช้ clamp/โชว์ให้ตรง server guard
  refillNetById: Record<string, number>;
  onPickRefill: (productId: string, name: string) => void;
  // WAVE-3b · R4 · คลัง active ของสาขานี้ (picker "เติมจากคลัง") + handler เลือกห้อง. picker โผล่เฉพาะ >1 ห้อง.
  branchWarehouses: BranchWarehouse[];
  onPickWarehouse: (warehouseId: string) => void;
  // 🆕 เติมหลาย SKU — ไลน์ที่เลือกไว้ + ยอดรวม (ตรงกับ server) + handlers เพิ่ม/แก้จำนวน/ลบ.
  refillLines: RefillLine[];
  refillTotal: number;
  onAddRefillLine: (productId: string, name: string) => void;
  onSetRefillLineQty: (productId: string, qty: number) => void;
  onRemoveRefillLine: (productId: string) => void;
  // N5 · ด่านเงินไม่ตรง (verdict=SHORT) · null = ไม่มีด่าน.
  mismatchGate: { active: boolean; onConfirmShort: (reason: string, note: string) => void; onCancel: () => void } | null;
  onBack: () => void;
  onExitToList: () => void; // FIX-3 · กลับหน้ารายการตู้กลางคัน (เลือกตู้อื่น)
  primary: { label: string; color: string; action: () => void };
  secondary: { label: string; action: () => void } | null;
  pending: boolean;
  primaryDisabled: boolean;
}) {
  const { step, form: f, dispensed, afterFill, photos, meterDeferred, recon, machine } = props;
  const stepIndicator = step <= 5 ? `ขั้นที่ ${step}/5` : "เสร็จ";
  // TASK C · sheet ตั้งชื่อเล่นตู้ (เปิดจากปุ่ม ✎ ในหัว) — ปิดเมื่อ demo (ไม่มี backend)
  const [nicknameOpen, setNicknameOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* header — กระชับ (back + ชื่อตู้ + ขั้น) ให้เนื้อหาขึ้นถึง ⅓ บน */}
      <div style={{ padding: "4px 18px 10px", borderBottom: "1px solid #EAECEF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          {/* back = ย้อนทีละขั้น (พฤติกรรมเดิม) */}
          <button type="button" onClick={props.onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          {/* TASK C · ชื่อเล่นเด่น + รหัสเป็นรอง (เมื่อไม่มีชื่อเล่น → โชว์รหัสเหมือนเดิม) + ปุ่ม ✎ ตั้งชื่อ */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <MachineHeaderTitle prefix="เก็บเงิน" machine={machine} />
              {machine && !props.usingDemo && (
                <button type="button" aria-label="ตั้งชื่อเล่นตู้" onClick={() => setNicknameOpen(true)} className="co-tap"
                  style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "3px 8px", borderRadius: 20, cursor: "pointer" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  ตั้งชื่อ
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{props.stepLabel}</div>
          </div>
          {/* FIX-3 · "เลือกตู้อื่น" — กลับหน้ารายการตู้กลางคัน (คง session สาขา · ไม่ปิดรอบ). โชว์ระหว่างกรอก (1-5) */}
          {step <= 5 ? (
            <button type="button" onClick={props.onExitToList} className="co-tap"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto", fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", padding: "6px 11px", borderRadius: 20, cursor: "pointer" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
              เลือกตู้อื่น
            </button>
          ) : (
            <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "4px 10px", borderRadius: 20 }}>{stepIndicator}</span>
          )}
        </div>
        {step <= 5 && <StepStrip step={step} />}
      </div>

      {/* body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 20px" }}>
        {step === 1 && (
          <div>
            <div style={{ background: "#F1F2F7", borderRadius: 12, padding: "13px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
              <span style={{ fontSize: 12.5, color: "#5A6270" }}>รอบที่แล้วในตู้มีตุ๊กตา <b className="num" style={{ color: "#1A1D21" }}>{f.last} ตัว</b></span>
            </div>
            <FieldLabel>ตุ๊กตาคงเหลือในตู้ (ก่อนเติม)</FieldLabel>
            {/* FIX-2 · พิมพ์เลขได้ตรง ๆ (เช่น 90) + ปุ่ม −/+ ปรับทีละตัว */}
            <CountField value={f.left} onChange={props.setNum("left")} placeholder="นับแล้วกรอก" />
            <div style={{ marginTop: 10 }}>
              <PhotoSlot label={`ถ่ายรูปสินค้าในตู้ก่อนเติม ${props.photoRequired ? "(บังคับ)" : "(ถ่ายได้-ข้ามได้)"}`} value={photos.before}
                onChange={(url) => props.onPhoto("before", url)} onCaptured={() => props.onCapture("before")}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock" disabled={props.usingDemo} required={props.photoRequired} />
            </div>
            <div style={{ fontSize: 12, color: "#8A909A", display: "flex", alignItems: "center", gap: 7, marginTop: 14 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A909A" strokeWidth="2"><path d="M12 3v6" /><path d="M8 9h8l-1.2 4.2a3 3 0 0 1-2.88 2.18h-.84a3 3 0 0 1-2.88-2.18Z" /><path d="M12 15.5V21" /><path d="M8.5 21h7" /></svg>
              {/* แสดงผลตุ๊กตาออกเฉพาะเมื่อ "นับเหลือ" แล้ว (กันโชว์ค่าหลอกตอนช่องยังว่าง) */}
              {f.left != null
                ? <>ตุ๊กตาออกจากตู้รอบนี้ <b className="num" style={{ color: "#1A1D21" }}>{dispensed} ตัว</b></>
                : <>กรอกจำนวนที่นับได้ — ระบบจะคำนวณตุ๊กตาที่ออกให้</>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ display: "flex", gap: 9, background: "#EEF0FE", borderRadius: 11, padding: "11px 13px", marginBottom: 16 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 17px", marginTop: 1 }}><path d="M12 5v14M5 12h14" /></svg>
              <span style={{ fontSize: 11.5, color: "#3F3AC0", lineHeight: 1.45 }}>เลือก<b>สินค้าที่เติม</b> (เติมได้<b>หลายตัว</b>) แล้วระบุ<b>กี่ตัว</b>ต่อสินค้า · ถ่ายรูปยืนยันหลังเติม (รูปที่ 2)</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* WAVE-3b · R4 · เลือกคลัง (ห้อง) ที่หยิบของมาเติม — โผล่เฉพาะสาขาที่มี >1 ห้อง.
                  สาขา ≤1 ห้อง → ไม่โชว์ (default คลังหลัก · พฤติกรรมเดิมเป๊ะ · zero friction). วางบนสุด (ใช้ร่วมทุกไลน์). */}
              {props.branchWarehouses.length > 1 && (
                <div>
                  <FieldLabel>เติมจากคลัง</FieldLabel>
                  <select
                    value={f.refillWarehouseId ?? (props.branchWarehouses.find((w) => w.isMain)?.id ?? props.branchWarehouses[0]?.id ?? "")}
                    onChange={(e) => props.onPickWarehouse(e.target.value)}
                    style={selectStyle}
                  >
                    {props.branchWarehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}{w.isMain ? " (คลังหลัก)" : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* 🆕 R4-multi · มีสินค้าคลังสาขาจริง → รายการเติมหลาย SKU (การ์ดต่อไลน์: รูป+ชื่อ+คงคลัง+จำนวน).
                  ไม่มี (demo/ว่าง) → fallback dropdown + จำนวนเดียว (พฤติกรรมเดิม · ไม่ hard-block). */}
              {props.branchProducts.length > 0 ? (
                <RefillLinesEditor
                  products={props.branchProducts}
                  netById={props.refillNetById}
                  lines={props.refillLines}
                  onAdd={props.onAddRefillLine}
                  onSetQty={props.onSetRefillLineQty}
                  onRemove={props.onRemoveRefillLine}
                />
              ) : (
                <>
                  <div>
                    {/* FIX-4 · ป้ายชัดว่า "เติมตุ๊กตาอะไร" — สาขานี้ไม่มีสต็อกในระบบ → เลือกจากรายชื่อ SKU */}
                    <FieldLabel>เติมตุ๊กตาอะไร</FieldLabel>
                    <select value={f.product} onChange={(e) => props.onProduct(e.target.value)} style={selectStyle}>
                      {props.skus.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                      {props.skus.every((s) => s.name !== f.product) && <option value={f.product}>{f.product}</option>}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>เติมเข้าไปกี่ตัว</FieldLabel>
                    {/* FIX-2 · พิมพ์เลขได้ตรง ๆ + ปุ่ม −/+ ปรับทีละตัว */}
                    <CountField value={f.refill} onChange={props.setNum("refill")} size={18} placeholder="กรอกจำนวนที่เติม" />
                  </div>
                </>
              )}
              {/* รวมหลังเติม = ก่อนเติม(นับ) + เติมรวมทุก SKU → โชว์เมื่อนับก่อนเติมแล้ว (กันค่าหลอก) */}
              {f.left != null ? (
                <div style={{ background: "#EEF0FE", borderRadius: 11, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>รวมหลังเติม (ก่อนเติม {f.left} + เติม {props.refillTotal})</span>
                  <span className="num" style={{ fontSize: 20, fontWeight: 700, color: "#4F46E5" }}>{afterFill} ตัว</span>
                </div>
              ) : (
                <div style={{ background: "#F6F7FA", borderRadius: 11, padding: "13px 16px", fontSize: 12.5, color: "#9AA1AB" }}>
                  นับตุ๊กตาก่อนเติม (ขั้นก่อนหน้า) — ระบบจะรวมยอดหลังเติมให้
                </div>
              )}
              <PhotoSlot label={`ถ่ายรูปสินค้าในตู้หลังเติม ${props.photoRequired ? "(บังคับ)" : "(ถ่ายได้-ข้ามได้)"}`} value={photos.after}
                onChange={(url) => props.onPhoto("after", url)} onCaptured={() => props.onCapture("after")}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock_after" disabled={props.usingDemo} required={props.photoRequired} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {props.resumed && (
              // B2 · resume ร่างที่เก็บค้าง — reducer คืน form (จำนวน+เงิน) + photos จาก draft ครบ
              // (ดู case "resume": photos: {...a.draft.photos}). copy เดิมบอก "รูปต้องถ่ายใหม่" = ผิด → แก้ให้ตรงจริง.
              <div style={{ display: "flex", gap: 9, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "12px 13px", marginBottom: 12 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.2" style={{ flex: "0 0 17px", marginTop: 1 }}><path d="M20 6 9 17l-5-5" /></svg>
                <span style={{ fontSize: 11.5, color: "#15803D", lineHeight: 1.5 }}>กลับมากรอกมิเตอร์ของตู้ที่<b>เก็บค้างไว้</b> — <b>รูปและตัวเลขที่กรอกไว้ยังอยู่ครบ</b> กรอกเลขมิเตอร์ให้ครบเพื่อปิดรอบ</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 9, background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "11px 13px", marginBottom: 14 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 17px", marginTop: 1 }}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
              <span style={{ fontSize: 11.5, color: "#7A5510", lineHeight: 1.45 }}>มิเตอร์มี 2 ชุด — <b>เฟือง (บน)</b> และ <b>ดิจิตอล (ล่าง)</b> ต้องขึ้น<b>เท่ากัน</b>เพื่อกันพลาด ถ่ายรูปแต่ละชุด หรือ<b>กดข้าม</b>มากรอกในที่ร่ม</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <MeterGroup title="มิเตอร์ตุ๊กตา" prev={f.dollPrev} equalOk={props.meterGroupVals.dollMeterEqual} deferred={meterDeferred}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} usingDemo={props.usingDemo} photoRequired={props.photoRequired}
                rows={[
                  { label: "เฟือง (บน)", value: f.dollGear, onChange: props.setNum("dollGear"), photo: photos.dollGear, onPhoto: (url) => props.onPhoto("dollGear", url), onCaptured: () => props.onCapture("dollGear"), phase: "prize_meter" },
                  { label: "ดิจิตอล (ล่าง)", value: f.dollDigi, onChange: props.setNum("dollDigi"), photo: photos.dollDigi, onPhoto: (url) => props.onPhoto("dollDigi", url), onCaptured: () => props.onCapture("dollDigi"), phase: "prize_meter" },
                ]} />
              <MeterGroup title="มิเตอร์เหรียญ" prev={f.coinPrev} equalOk={props.meterGroupVals.coinMeterEqual} deferred={meterDeferred}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} usingDemo={props.usingDemo} photoRequired={props.photoRequired}
                rows={[
                  { label: "เฟือง (บน)", value: f.coinGear, onChange: props.setNum("coinGear"), photo: photos.coinGear, onPhoto: (url) => props.onPhoto("coinGear", url), onCaptured: () => props.onCapture("coinGear"), phase: "meter_after" },
                  { label: "ดิจิตอล (ล่าง)", value: f.coinDigi, onChange: props.setNum("coinDigi"), photo: photos.coinDigi, onPhoto: (url) => props.onPhoto("coinDigi", url), onCaptured: () => props.onCapture("coinDigi"), phase: "meter_after" },
                ]} />
              {/* B2 · cash-first, meter-later — ปุ่มเด่นชัดว่า "ถ่ายรูปมิเตอร์ไว้ก่อน → ไปกรอกเงินสด → บันทึกค้าง → กลับมากรอกเลขทีหลัง".
                  ปิดช่องมิเตอร์ (deferred) แต่ยังเดินต่อไปขั้นเงินสดได้ · ตัวเลขจริงยังบังคับก่อน "ปิดรอบ" (money-safe). */}
              <button type="button" onClick={props.toggleDefer} className="co-tap"
                style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "13px 15px", minHeight: 56, borderRadius: 13, cursor: "pointer", textAlign: "left", border: `1.5px solid ${meterDeferred ? "#F0D8AE" : "#C7C3F0"}`, background: meterDeferred ? "#FCF1E2" : "#F5F5FE" }}>
                <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: meterDeferred ? "#F6E3C4" : "#E7E5FB", color: meterDeferred ? "#B45309" : "#4F46E5" }}>
                  {meterDeferred
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
                    : <Camera size={20} strokeWidth={2} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: meterDeferred ? "#B45309" : "#4338CA" }}>
                    {meterDeferred ? "ข้ามมิเตอร์ไว้แล้ว · ไปนับเงินสดต่อได้เลย" : "ถ่ายรูปมิเตอร์ไว้ก่อน · กรอกเลขทีหลัง"}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: meterDeferred ? "#7A5510" : "#6B7280", lineHeight: 1.4, marginTop: 2 }}>
                    {meterDeferred ? "กด “นับเงินสด” แล้วจะบันทึกค้างให้ · กลับมากรอกเลขในที่ร่มทีหลัง" : "รีบ? ถ่ายรูปมิเตอร์ไว้ แล้วไปเก็บเงิน → บันทึกค้าง → กลับมากรอกเลขทีหลัง"}
                  </span>
                </span>
              </button>

              {/* ตู้เสีย/อ่านมิเตอร์ไม่ได้ → แจ้งซ่อม & ข้าม (ไม่บังคับกรอกมิเตอร์ครบ · ไม่ทำ session ค้าง) */}
              <button type="button" disabled={props.skipPending}
                onClick={() => {
                  if (props.skipPending) return;
                  const ok = window.confirm(`ตู้ ${machine?.code ?? "นี้"} เสีย/อ่านมิเตอร์ไม่ได้?\nระบบจะแจ้งซ่อมตู้นี้และข้ามไปเก็บตู้ถัดไป`);
                  if (ok) props.onSkipBroken();
                }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: 11, borderRadius: 11, fontSize: 12.5, fontWeight: 600, cursor: props.skipPending ? "wait" : "pointer", border: "1.5px solid #F3D4D0", background: "#FDF6F5", color: "#B42318", opacity: props.skipPending ? 0.6 : 1 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                {props.skipPending ? "กำลังแจ้งซ่อม…" : "ตู้นี้เสีย/อ่านมิเตอร์ไม่ได้ — แจ้งซ่อม & ข้าม"}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <FieldLabel>เงินสดที่นับได้จริง (บาท)</FieldLabel>
              <BigInput value={f.cash} onChange={props.setNum("cash")} placeholder="นับเงินแล้วกรอก" />
              <div style={{ marginTop: 10 }}>
                {/* FIX-5 · รูปเงินสด "ไม่บังคับ" เสมอ (ถ่ายได้-ข้ามได้) — required=false ไม่ว่านโยบายจะเปิดไหม.
                    เงินสดกระทบยอดกับมิเตอร์อยู่แล้ว · รูปเป็นหลักฐานเสริม ไม่ควรบล็อกการส่งรอบ. */}
                <PhotoSlot label="ถ่ายรูปเงินสด (ถ่ายได้-ข้ามได้)" value={photos.cash}
                  onChange={(url) => props.onPhoto("cash", url)} onCaptured={() => props.onCapture("cash")}
                  orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="cash" disabled={props.usingDemo} required={false} />
              </div>
            </div>
            <div style={{ borderTop: "1px solid #EEF0F2", paddingTop: 15 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2"><path d="M12 3v6" /><path d="M8 9h8l-1.2 4.2a3 3 0 0 1-2.88 2.18h-.84a3 3 0 0 1-2.88-2.18Z" /><path d="M12 15.5V21" /><path d="M8.5 21h7" /></svg>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>สินค้าในตู้นี้</span>
                <span style={{ fontSize: 11, color: "#9AA1AB" }}>ตั้งราคา/ประเภท</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#F6F7FA", borderRadius: 11, padding: "11px 14px", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "#9AA1AB" }}>สินค้าที่เติม:</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#4F46E5" }}>{f.product}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <FieldLabel small>ประเภท</FieldLabel>
                  <select value={f.category} onChange={(e) => props.onCategory(e.target.value)} style={selectStyle}>
                    {["ลิขสิทธิ์", "ตุ๊กตาทั่วไป", "ของเล่น/พรีเมียม"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel small>ราคาขายสินค้า (บาท) — ใช้ตัดสต็อก &amp; ดูต้นทุนคีบ</FieldLabel>
                  <BigInput value={f.price} onChange={props.setNum("price")} size={16} placeholder="ระบุราคา" />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          meterDeferred ? (
            // B2 · cash-first path มาถึง step 5 ทั้งที่ยังไม่กรอกมิเตอร์ → หน้าจอ "พร้อมบันทึกค้าง".
            // primary bar ด้านล่าง = "บันทึกค้างไว้ · ไปเก็บตู้อื่น" (saveDraft · เก็บ form+รูปครบ) ·
            // secondary = "กรอกเลขมิเตอร์ตอนนี้เลย". money-safe: ยังไม่ปิดรอบจนกว่าจะกรอกมิเตอร์.
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "20px 8px" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#FCF1E2", color: "#B45309", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 700, marginBottom: 6 }}>เก็บเงินครบแล้ว · เหลือเลขมิเตอร์</div>
              <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, maxWidth: 270, marginBottom: 16 }}>
                รูปมิเตอร์ที่ถ่ายไว้ · จำนวนตุ๊กตา · เงินสด — <b style={{ color: "#1A1D21" }}>เก็บไว้ครบแล้ว</b>. กด <b style={{ color: "#B45309" }}>บันทึกค้างไว้</b> ด้านล่างเพื่อไปเก็บตู้อื่นต่อ แล้วค่อยกลับมากรอกเลขมิเตอร์ในที่ร่มทีหลัง
              </div>
              {/* สรุปสั้น ๆ ของที่เก็บไว้แล้ว (อ่านปราดเดียว · กันกังวลว่าข้อมูลหาย) */}
              <div style={{ display: "flex", gap: 9, width: "100%", maxWidth: 300 }}>
                <div style={{ flex: 1, background: "#F2FBF5", border: "1px solid #CDE9D7", borderRadius: 12, padding: "11px 8px" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>เงินสด</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#15803D" }}>฿{n0(f.cash).toLocaleString("en-US")}</div>
                </div>
                <div style={{ flex: 1, background: "#F6F7FA", border: "1px solid #E8EAED", borderRadius: 12, padding: "11px 8px" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>ตุ๊กตาออก</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "#1A1D21" }}>{dispensed}</div>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 18px", borderRadius: 15, color: "#fff", background: recon.allMatch ? "linear-gradient(135deg,#15914A,#1FA559)" : "linear-gradient(135deg,#C0392B,#D8503F)" }}>
                <span style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {recon.allMatch ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                  )}
                </span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{recon.allMatch ? "มิเตอร์ & ตุ๊กตา ตรงกัน" : "พบยอดไม่ตรง"}</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>{recon.allMatch ? "เงินสดเทียบกับมิเตอร์เป็นค่าประมาณ — ระบบจะกระทบยอดจริงให้" : "กรุณาตรวจสอบตุ๊กตา/มิเตอร์ก่อนส่ง"}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                <ReconRow title="มิเตอร์เฟือง = ดิจิตอล" a={`ตุ๊กตา ${props.meterGroupVals.dollMeterEqual ? "ตรง" : "ต่างกัน"}`} b={`เหรียญ ${props.meterGroupVals.coinMeterEqual ? "ตรง" : "ต่างกัน"}`} ok={recon.meterEqualOk} />
                <ReconRow title="มิเตอร์ตุ๊กตา ↔ ตุ๊กตาที่หาย" a={`มิเตอร์เพิ่ม ${recon.dollDelta} ครั้ง`} b={`ตุ๊กตาหาย ${dispensed} ตัว`} ok={recon.dollMatch} />
                {/* ADVISORY: ราคา/เกมจริงต่อตู้ยังไม่ส่งมา client (เดา ฿10) → โชว์เป็น "ประมาณ" ไม่ฟันธงแดง · ตัวจริง server เช็ค */}
                <ReconRow title="เงินสด ↔ มิเตอร์เหรียญ" a={`นับได้ ฿${n0(f.cash)}`} b={`ประมาณ ฿${recon.expectedCash} (ที่ ฿10/เกม)`} ok={recon.cashMatch} advisory />
              </div>

              {props.tooHard && (
                <div style={{ marginTop: 14, background: "#FCF1E2", border: "1px solid #F0D8AE", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#7A5510" }}>ตู้นี้อาจตั้งยากเกินไป</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#7A5510", lineHeight: 1.5, marginBottom: 11 }}>เก็บเงินได้ <b className="num">฿{n0(f.cash)}</b> แต่ตุ๊กตาออก <b>0 ตัว</b> เสี่ยงเสียลูกค้า ต้องการเสนอปรับความแรงการคีบไหม?</div>
                  {props.configSent ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "#15803D", background: "#E7F4EC", borderRadius: 10, padding: "11px 14px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>ส่งคำขอตั้งค่าแล้ว · สถานะ “รอตรวจ”
                    </div>
                  ) : (
                    <button type="button" onClick={props.sendConfig} style={{ width: "100%", fontSize: 13, fontWeight: 600, color: "#fff", background: "#B45309", border: "none", padding: 11, borderRadius: 10, cursor: "pointer" }}>เสนอตั้งค่าตู้ใหม่ (ส่งให้เจ้าของตรวจ)</button>
                  )}
                </div>
              )}

              {/* N5 · ด่านเงินขาด — server คืน needsReason (verdict=SHORT) → ต้องเลือกเหตุผลก่อนส่งซ้ำ.
                   verdict=SHORT เสมอเมื่อ needsReason (server กด OVER/OK/round-1 ผ่านเอง). */}
              {props.mismatchGate?.active && (
                <div style={{ marginTop: 14 }}>
                  <MismatchGate
                    verdict="SHORT"
                    onConfirmShort={props.mismatchGate.onConfirmShort}
                    onProceed={props.mismatchGate.onCancel}
                  />
                </div>
              )}
            </div>
          )
        )}

        {step === 6 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: 36 }}>
            <div style={{ position: "relative", marginBottom: 18 }}>
              <div style={{ position: "absolute", inset: -10, borderRadius: "50%", background: "#E7F4EC", opacity: 0.55 }} />
              <div style={{ position: "relative", width: 88, height: 88, borderRadius: "50%", background: "#15803D", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 28px -10px rgba(21,128,61,0.55)" }}>
                <Check size={44} strokeWidth={2.4} />
              </div>
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>บันทึกรอบเก็บเงินแล้ว</div>
            <div style={{ fontSize: 12.5, color: "#9AA1AB", lineHeight: 1.55, maxWidth: 260, marginBottom: 18 }}>ส่งข้อมูลเข้าระบบหลังบ้านเรียบร้อย · ตู้ <span className="num">{machine?.code ?? "—"}</span></div>
            <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 300 }}>
              <div style={{ flex: 1, background: "#F2FBF5", border: "1px solid #CDE9D7", borderRadius: 13, padding: "13px 10px" }}>
                <div style={{ fontSize: 10.5, color: "#6B7280", marginBottom: 3 }}>เก็บเงิน</div>
                <div className="num" style={{ fontSize: 19, fontWeight: 700, color: "#15803D" }}>฿{n0(f.cash).toLocaleString("en-US")}</div>
              </div>
              <div style={{ flex: 1, background: "#F6F7FA", border: "1px solid #E8EAED", borderRadius: 13, padding: "13px 10px" }}>
                <div style={{ fontSize: 10.5, color: "#6B7280", marginBottom: 3 }}>ตุ๊กตาออก</div>
                <div className="num" style={{ fontSize: 19, fontWeight: 700, color: "#1A1D21" }}>{dispensed} <span style={{ fontSize: 12, fontWeight: 600, color: "#9AA1AB" }}>ตัว</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* bottom bar — sticky · พื้นทึบ · ปุ่มหลักเต็มกว้าง แตะถนัด (≥48px) */}
      <div style={{ padding: "14px 18px 22px", borderTop: "1px solid #EAECEF", background: "#fff" }}>
        {props.countBlocks && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 12px", fontSize: 11.5, fontWeight: 600, color: "#B45309", lineHeight: 1.4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 15px" }}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            {props.step === 1 ? "นับตุ๊กตาที่เหลือก่อน"
              : props.step === 2 ? "กรอกจำนวนที่เติมก่อน"
                : props.step === 3 ? "อ่านเลขมิเตอร์ให้ครบทั้ง 4 ช่องก่อน"
                  : "นับเงินสด + กรอกราคาก่อน"}
          </div>
        )}
        {props.photoBlocks && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 10, padding: "9px 12px", fontSize: 11.5, fontWeight: 600, color: "#B42318", lineHeight: 1.4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 15px" }}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></svg>
            ต้องถ่ายรูปก่อน
          </div>
        )}
        <button type="button" onClick={props.primary.action} disabled={props.primaryDisabled}
          className={props.primaryDisabled ? "" : "co-tap co-pbtn"}
          style={{ width: "100%", minHeight: 50, fontSize: 15, fontWeight: 700, color: "#fff", border: "none", padding: "14px 16px", borderRadius: 13, cursor: props.primaryDisabled ? "not-allowed" : "pointer", background: props.primary.color, opacity: props.primaryDisabled ? 0.55 : 1, boxShadow: props.primaryDisabled ? "none" : "0 8px 18px -10px rgba(27,30,42,0.5)" }}>
          {props.primary.label}
        </button>
        {props.secondary && (
          <button type="button" onClick={props.secondary.action} style={{ width: "100%", minHeight: 44, fontSize: 13, fontWeight: 600, color: "#6B7280", border: "none", padding: "11px 0 2px", background: "transparent", cursor: "pointer" }}>
            {props.secondary.label}
          </button>
        )}
      </div>

      {/* TASK C · sheet ตั้งชื่อเล่นตู้ (overlay) — เปิดจากปุ่ม ✎ ในหัว */}
      {nicknameOpen && machine && (
        <NicknameSheet machine={machine} onClose={() => setNicknameOpen(false)} />
      )}
    </div>
  );
}

/* ─────────────────────────── small UI helpers ─────────────────────────── */
// แถบความคืบหน้า 5 ขั้น (อ่านปราดเดียว) — เสร็จ=ติ๊ก · กำลังทำ=เด่น · เหลือ=จาง.
// VISUAL ONLY: อ่านค่า step จาก reducer ตรง ๆ ไม่แตะ step logic.
const STEP_STRIP = [
  { n: 1, t: "นับ" },
  { n: 2, t: "เติม" },
  { n: 3, t: "มิเตอร์" },
  { n: 4, t: "เงินสด" },
  { n: 5, t: "กระทบยอด" },
];
function StepStrip({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
      {STEP_STRIP.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              <span style={{ height: 3, flex: 1, borderRadius: 3, background: i === 0 ? "transparent" : step > s.n - 1 ? "#4F46E5" : "#E4E6EC" }} />
              <span style={{
                flex: "0 0 auto", width: active ? 22 : 18, height: active ? 22 : 18, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10.5, fontWeight: 700,
                background: done ? "#4F46E5" : active ? "#4F46E5" : "#F1F2F5",
                color: done || active ? "#fff" : "#9AA1AB",
                boxShadow: active ? "0 0 0 4px rgba(79,70,229,0.14)" : "none",
                transition: "all .15s",
              }}>
                {done ? <Check size={12} strokeWidth={3} /> : <span className="num">{s.n}</span>}
              </span>
              <span style={{ height: 3, flex: 1, borderRadius: 3, background: i === STEP_STRIP.length - 1 ? "transparent" : step > s.n ? "#4F46E5" : "#E4E6EC" }} />
            </div>
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, color: active ? "#4F46E5" : done ? "#6B7280" : "#B6BBC4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{s.t}</span>
          </div>
        );
      })}
    </div>
  );
}

// สปินเนอร์เล็ก — ใช้บนตู้ที่กำลังเปิดรอบ. ใช้ Tailwind `animate-spin` (มี @keyframes spin ในตัว).
function Spinner({ color = "#4F46E5", size = 15 }: { color?: string; size?: number }) {
  return <Loader2 className="animate-spin" style={{ width: size, height: size, color }} />;
}

function Icon({ paths, size = 17 }: { paths: string[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const QUICK_MENU: { key: Exclude<Panel, null>; label: string; d: string[] }[] = [
  { key: "history", label: "ประวัติของฉัน", d: ["M3 3v18h18", "m19 9-5 5-4-4-3 3"] },
  { key: "repair", label: "แจ้งซ่อม", d: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"] },
  { key: "stock", label: "นับสต็อก", d: ["m7.5 4.27 9 5.15", "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5M12 22V12"] },
  // N6 · รับสินค้า (ใบกระจายขาเข้า)
  { key: "receive", label: "รับสินค้า", d: ["M16 16h6", "M19 13v6", "M12 3 2 8l10 5 10-5-10-5z", "M2 8v8l10 5", "M12 13v9"] },
];

// แบนเนอร์ "เร็ว ๆ นี้" — บอกชัดว่าหน้านี้ยังเป็นตัวอย่าง ไม่บันทึกจริง (กันพนักงานเข้าใจผิดว่าส่งแล้ว)
function ComingSoonBanner({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "10px 13px", fontSize: 11.5, fontWeight: 600, color: "#7A5510", lineHeight: 1.45 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 16px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
      {text}
    </div>
  );
}

// ปุ่มที่ยังไม่ทำงาน → disable + ป้าย "เร็ว ๆ นี้" (ไม่ให้กดแล้วนึกว่าส่งสำเร็จ)
function ComingSoonButton({ label }: { label: string }) {
  return (
    <button type="button" disabled style={{ width: "100%", fontSize: 14, fontWeight: 700, color: "#fff", background: "#A8AEB8", border: "none", padding: 13, borderRadius: 12, cursor: "not-allowed", opacity: 0.75 }}>
      {label}
    </button>
  );
}

function FieldLabel({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <label style={{ fontSize: small ? 12 : 12.5, fontWeight: 600, color: "#454B54", display: "block", marginBottom: small ? 5 : 6 }}>{children}</label>;
}

const selectStyle = { width: "100%", fontSize: 15, fontWeight: 600, padding: "12px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", cursor: "pointer" } as const;

function BigInput({ value, onChange, size = 20, placeholder = "นับแล้วกรอก" }: { value: Counted; onChange: (v: string) => void; size?: number; placeholder?: string }) {
  // null = ยังไม่กรอก → ช่องว่าง + placeholder (ไม่โชว์ 0 หลอกว่ากรอกแล้ว)
  return (
    <input type="number" inputMode="numeric" pattern="[0-9]*" value={value == null ? "" : String(value)} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} className="num"
      style={{ width: "100%", fontSize: size, fontWeight: 700, padding: "13px 14px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />
  );
}

/* FIX-2 · ช่องนับที่ "พิมพ์เลขได้" + ปุ่ม −/+ (สำหรับ นับตุ๊กตา step 1 / เติม step 2).
 * เดิมมีแต่ปุ่มปรับทีละตัว → กรอก "90" ตรง ๆ ไม่ได้ ต้องกดหลายสิบครั้ง. เพิ่ม input พิมพ์ได้ตรงกลาง.
 * ใช้ inputMode="numeric" + strip อักขระที่ไม่ใช่ตัวเลข (mirror RepairPanel) กันคีย์บอร์ดมือถือใส่ตัวอักษร/จุด.
 * onChange = setNum(key) เดิม (รับ string · ว่าง=null) → −/+ ส่ง string ตัวเลขใหม่ (ต่ำสุด 0). */
function CountField({ value, onChange, size = 20, placeholder = "นับแล้วกรอก" }: { value: Counted; onChange: (v: string) => void; size?: number; placeholder?: string }) {
  const cur = value == null ? 0 : value;
  const nudge = (delta: number) => onChange(String(Math.max(0, cur + delta)));
  const btnStyle = {
    width: 52, height: 52, flex: "0 0 52px", borderRadius: 12, border: "1.5px solid #E3E6EA",
    background: "#F6F7FA", fontSize: 24, fontWeight: 700, color: "#454B54",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <button type="button" aria-label="ลด" onClick={() => nudge(-1)} className="co-tap" style={btnStyle}>−</button>
      {/* type=text + inputMode=numeric → คีย์บอร์ดตัวเลข + พิมพ์ "90" ได้ตรง ๆ · strip ให้เหลือแต่ตัวเลข */}
      <input type="text" inputMode="numeric" pattern="[0-9]*"
        value={value == null ? "" : String(value)} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} className="num"
        style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: size, fontWeight: 700, padding: "13px 10px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />
      <button type="button" aria-label="เพิ่ม" onClick={() => nudge(1)} className="co-tap" style={btnStyle}>+</button>
    </div>
  );
}

/* 🆕 2026-07-11 · RefillLinesEditor — เติมตุ๊กตา "หลาย SKU" ต่อตู้ (CEO: 1 ตู้มีได้หลายตัว).
 * แต่ละไลน์ = สินค้าคลังสาขา 1 ตัว (รูป+ชื่อ+คงคลัง) + จำนวนที่เติม (พิมพ์ได้ + −/+ · clamp ≤ คงคลัง).
 * "+ เพิ่ม SKU อีก" = เปิด BranchStockPicker เลือกตัวใหม่ (กันเลือกซ้ำ · ตัวที่เลือกแล้วถูกกรอง/disable).
 * รวมเติม = Σ qty (โชว์บาร์ล่าง). ไม่บล็อกเมื่อคลังหมด (server enforce) — เตือน amber เฉย ๆ. */
function RefillLinesEditor({ products, netById, lines, onAdd, onSetQty, onRemove }: {
  products: BranchStockProduct[];
  netById: Record<string, number>;
  lines: RefillLine[];
  onAdd: (productId: string, name: string) => void;
  onSetQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}) {
  // เปิด/ปิด picker เลือก SKU (โชว์ตอน "+ เพิ่ม SKU" · ครั้งแรกยังไม่มีไลน์ = เปิดค้างให้เลือกเลย)
  const [adding, setAdding] = useState(false);
  const pickedIds = new Set(lines.map((l) => l.productId));
  // 🆕 remap "คงคลัง" → net "ของบนชั้นจริง" (คลัง − ในตู้) ให้ตรงกับ server guard เติม (net-per-room).
  const netProducts = products.map((p) => ({ ...p, warehouse: Math.max(0, netById[p.id] ?? 0) }));
  // ตัวที่ยังไม่ถูกเลือก + มีของบนชั้น (net>0) — net≤0 ซ่อน (กันเพิ่มแล้วกรอกไม่ได้) · หมด = ปิดปุ่มเพิ่ม
  const remaining = netProducts.filter((p) => !pickedIds.has(p.id) && p.warehouse > 0);
  const total = lines.reduce((s, l) => s + Math.max(0, l.qty), 0);
  const showPicker = adding || lines.length === 0; // ครั้งแรก: เปิด picker ให้เลือกเลย

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <FieldLabel>เติมตุ๊กตาอะไร (จากสต็อกสาขา) · เลือกได้หลายตัว</FieldLabel>

      {/* ไลน์ที่เลือกแล้ว — การ์ดต่อ SKU (รูป + ชื่อ + คงคลัง + จำนวน + ลบ) */}
      {lines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lines.map((l) => {
            const prod = netProducts.find((p) => p.id === l.productId);
            const warehouse = prod?.warehouse ?? 0; // net ของบนชั้นจริง
            const over = l.qty > warehouse; // เกินของบนชั้น → เตือน amber (ไม่บล็อก · server กันจริง)
            return (
              <div key={l.productId} style={{ border: `1.5px solid ${over ? "#F0D8AE" : "#E8EAED"}`, background: over ? "#FEFBF3" : "#fff", borderRadius: 14, padding: "11px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <DollThumb imageUrl={prod?.imageUrl ?? null} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: over ? "#B45309" : "#9AA1AB" }} className="num">บนชั้น (พร้อมเติม) {warehouse} ตัว</div>
                  </div>
                  {/* ลบไลน์นี้ */}
                  <button type="button" aria-label="ลบสินค้านี้" onClick={() => onRemove(l.productId)} className="co-tap"
                    style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <X size={16} color="#9AA1AB" strokeWidth={2.2} />
                  </button>
                </div>
                {/* จำนวนที่เติม — พิมพ์ได้ + −/+ · clamp [0, คงคลัง] */}
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
                  <button type="button" aria-label="ลด" onClick={() => onSetQty(l.productId, Math.max(0, l.qty - 1))} disabled={l.qty <= 0} className="co-tap"
                    style={{ width: 46, height: 46, flex: "0 0 46px", borderRadius: 11, border: "1.5px solid #E3E6EA", background: "#F6F7FA", fontSize: 22, fontWeight: 700, color: "#454B54", display: "flex", alignItems: "center", justifyContent: "center", cursor: l.qty <= 0 ? "not-allowed" : "pointer", opacity: l.qty <= 0 ? 0.5 : 1 }}>−</button>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"
                    value={l.qty === 0 ? "" : String(l.qty)}
                    onChange={(e) => {
                      // strip อักขระที่ไม่ใช่ตัวเลข + clamp ไม่ให้เกินคงคลัง (mirror CountField · money-safe)
                      const raw = e.target.value.replace(/[^0-9]/g, "");
                      onSetQty(l.productId, raw === "" ? 0 : Math.min(warehouse, Number(raw)));
                    }}
                    className="num"
                    style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 18, fontWeight: 700, padding: "11px 10px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />
                  <button type="button" aria-label="เพิ่ม" onClick={() => onSetQty(l.productId, Math.min(warehouse, l.qty + 1))} disabled={l.qty >= warehouse} className="co-tap"
                    style={{ width: 46, height: 46, flex: "0 0 46px", borderRadius: 11, border: "none", background: "#4F46E5", color: "#fff", fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: l.qty >= warehouse ? "not-allowed" : "pointer", opacity: l.qty >= warehouse ? 0.5 : 1 }}>+</button>
                </div>
                {over && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, fontWeight: 600, color: "#B45309", background: "#FCF1E2", borderRadius: 8, padding: "6px 10px" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                    เกินของบนชั้น ({warehouse}) — ปรับจำนวนก่อนบันทึก
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* เพิ่ม SKU — picker การ์ด (โชว์เมื่อกด "+ เพิ่ม" หรือยังไม่มีไลน์) · กันซ้ำ (แสดงเฉพาะ remaining) */}
      {showPicker ? (
        remaining.length > 0 ? (
          <div style={{ border: "1.5px dashed #C7C3F0", background: "#FAFAFE", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4338CA", marginBottom: 9 }}>เลือกสินค้าที่จะเติม</div>
            <BranchStockPicker
              products={remaining}
              value={null}
              onPick={(pid) => {
                const p = remaining.find((x) => x.id === pid);
                if (p) onAdd(pid, p.name);
                setAdding(false); // เลือกแล้ว → ปิด picker (กดเพิ่มอีกได้)
              }}
            />
            {lines.length > 0 && (
              <button type="button" onClick={() => setAdding(false)} className="co-tap"
                style={{ width: "100%", marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "#6B7280", background: "transparent", border: "none", padding: "8px 0 2px", cursor: "pointer" }}>
                ยกเลิก
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: "#9AA1AB", textAlign: "center", padding: "10px 0" }}>เลือกครบทุกสินค้าในคลังแล้ว</div>
        )
      ) : (
        remaining.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} className="co-tap co-lift"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", minHeight: 48, borderRadius: 12, border: "1.5px dashed #C7C3F0", background: "#F5F5FE", color: "#4338CA", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
            เพิ่ม SKU อีก
          </button>
        )
      )}

      {/* running total — รวมเติมทุก SKU (ตรงกับที่ server จะคิด) */}
      <div style={{ fontSize: 11, color: "#8A909A", lineHeight: 1.45 }}>
        เลขบนชั้น = ของว่างพร้อมเติม (หักที่อยู่ในตู้แล้ว) · เติมเข้าตู้ ระบบหักออกจากคลังให้
      </div>
      {lines.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F6F7FA", borderRadius: 11, padding: "11px 14px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5A6270" }}>รวมเติม ({lines.length} รายการ)</span>
          <span className="num" style={{ fontSize: 17, fontWeight: 700, color: "#4F46E5" }}>{total} ตัว</span>
        </div>
      )}
    </div>
  );
}

type Phase = "meter_before" | "cash" | "meter_after" | "stock" | "prize_meter" | "stock_after";

/**
 * Optional photo slot — wraps the REAL <PhotoCaptureButton> (1-tap camera → R2 url).
 * Skipping is fine (value stays ""); shows a soft "ถ่ายได้-ข้ามได้" hint, never blocks.
 * In demo preview (no real session/upload backend) we render a disabled informational box.
 */
function PhotoSlot({ label, value, onChange, onCaptured, orgId, machineCode, eventScopeId, phase, disabled, required }: {
  label: string; value: string; onChange: (url: string) => void; onCaptured?: () => void;
  orgId: string; machineCode: string; eventScopeId: string; phase: Phase; disabled?: boolean; required?: boolean;
}) {
  if (disabled || !orgId || !machineCode) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: "1.5px dashed #C9CFD8", background: "#FAFBFC", color: "#9AA1AB" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></svg>
        {label}
      </div>
    );
  }
  return (
    <div>
      <PhotoCaptureButton label={label} value={value} onChange={onChange} onCaptured={onCaptured}
        orgId={orgId} machineCode={machineCode} eventScopeId={eventScopeId} phase={phase} />
      {!value && (
        required
          ? <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#B42318", fontWeight: 700, marginTop: 5, background: "#FCEDEC", borderRadius: 6, padding: "2px 7px" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              ต้องถ่ายรูปก่อน
            </div>
          : <div style={{ fontSize: 10.5, color: "#9AA1AB", marginTop: 5 }}>ยังไม่ถ่าย · ข้ามได้ (ไม่บังคับ)</div>
      )}
    </div>
  );
}

type MeterRow = {
  label: string; value: Counted; onChange: (v: string) => void;
  photo: string; onPhoto: (url: string) => void; onCaptured: () => void; phase: Phase;
};
function MeterGroup({ title, prev, equalOk, deferred, rows, orgId, machineCode, eventScopeId, usingDemo, photoRequired }: {
  title: string; prev: number; equalOk: boolean; deferred: boolean; rows: MeterRow[];
  orgId: string; machineCode: string; eventScopeId: string; usingDemo: boolean; photoRequired: boolean;
}) {
  return (
    <div style={{ border: "1px solid #E8EAED", borderRadius: 13, padding: "13px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: equalOk ? "#E7F4EC" : "#FCEDEC", color: equalOk ? "#15803D" : "#B42318" }}>
          {equalOk
            ? <><Check size={13} strokeWidth={2.6} /> เฟือง = ดิจิตอล</>
            : <><X size={13} strokeWidth={2.6} /> ไม่เท่ากัน เช็คอีกครั้ง</>}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {rows.map((r) => {
          const canCapture = !usingDemo && !!orgId && !!machineCode;
          return (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 12, color: "#6B7280", flex: "0 0 78px" }}>{r.label}</span>
                <input type="number" inputMode="numeric" value={r.value == null ? "" : String(r.value)} placeholder="อ่านมิเตอร์" disabled={deferred}
                  onChange={(e) => r.onChange(e.target.value)} className="num"
                  style={{ width: "100%", fontSize: 16, fontWeight: 700, padding: "10px 12px", border: "1.5px solid #E3E6EA", borderRadius: 10, background: deferred ? "#F1F2F5" : "#fff", color: deferred ? "#AEB4BD" : "#1A1D21" }} />
                {canCapture && r.photo && (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 46, height: 44, flex: "0 0 46px", borderRadius: 10, border: "1.5px solid #BBE3C8", background: "#F2FAF5", color: "#15803D" }}>
                    <Check size={18} strokeWidth={2.6} />
                  </span>
                )}
              </div>
              {canCapture && !deferred && (
                <PhotoCaptureButton label={r.photo ? "ถ่ายมิเตอร์แล้ว · แตะถ่ายใหม่" : `ถ่ายรูปมิเตอร์ ${photoRequired ? "(บังคับอย่างน้อย 1 รูป)" : "(ถ่ายได้-ข้ามได้)"}`}
                  value={r.photo} onChange={r.onPhoto} onCaptured={r.onCaptured}
                  orgId={orgId} machineCode={machineCode} eventScopeId={eventScopeId} phase={r.phase} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 9 }}>รอบที่แล้ว <span className="num">{prev}</span></div>
    </div>
  );
}

function ReconRow({ title, a, b, ok, advisory }: { title: string; a: string; b: string; ok: boolean; advisory?: boolean }) {
  // 3 โทน: ok=เขียว · advisory ที่ไม่ตรง=เหลือง (คำแนะนำ ไม่ฟันธง) · ไม่ตรง(hard)=แดง
  const soft = advisory && !ok; // เหลือง
  const border = ok ? "#CDE9D7" : soft ? "#F0E2BE" : "#F3D4D0";
  const bg = ok ? "#F2FAF5" : soft ? "#FCF8EC" : "#FDF3F2";
  const fg = ok ? "#15803D" : soft ? "#B45309" : "#B42318";
  const verdict = ok ? "ตรงกัน" : soft ? "ประมาณ · ตรวจหน้างาน" : "ไม่ตรง";
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: fg }}>
          {ok ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : soft ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
          )}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: fg }}>{verdict}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5A6270" }}>
        <span>{a}</span><span style={{ color: "#C2C7CF" }}>↔</span><span>{b}</span>
      </div>
    </div>
  );
}

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
import { Loader2, ChevronRight, ChevronLeft, Inbox, Check, X, Camera, PackageOpen, PackagePlus, ImageDown, History, RefreshCw } from "lucide-react";
import { PhoneFrame, EmptyState } from "@/components/clawfleet/os/kit";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import {
  startBranchSession,
  submitBranchEvent,
  closeBranchSession,
  renameMachineNickname,
  attachEventPhotos,
} from "@/lib/clawfleet/actions";
import { createRepairTicket } from "@/lib/clawfleet/repair-actions";
import { createBranchProduct } from "@/lib/clawfleet/product-setup-actions";
import { submitStockCount, confirmShipmentReceived, returnDollsToStock, refillDollsToMachine } from "@/lib/clawfleet/stock-actions";
import { confirmTransfer } from "@/lib/dc/transfer-actions";
import type { RepairTicketRow } from "@/lib/clawfleet/repair-queries";
import type { CfReceivedDoc, CfCountRow } from "@/lib/clawfleet/stock-queries";
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
  sku: string; // รหัสสินค้า (SKU) — โชว์บนรายการเติม/นับ (item 6 · CEO: "ต้องโชว์ว่าเป็น SKU อะไร")
  imageUrl: string | null;
  warehouse: number; // คงคลังสาขา (ไม่รวมในตู้)
  defaultPriceCoins: number; // ราคาขาย (coins/เล่น · 1 coin ≈ 10 บาท) — DISPLAY เท่านั้น (item 9)
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
  // ── doc-first (CEO 2026-07-16) · หัวใบ: เห็นเป็น "ใบ" ก่อน กดแล้วค่อยเห็นรายละเอียด ──
  docCode?: string | null; // เลขใบจริง (TF-…) · cf_delivery ไม่มี → UI โชว์ "ใบกระจาย"
  fromName?: string | null; // ส่งมาจากไหน (ชื่อคลังต้นทาง / fromLocation)
  senderName?: string | null; // ใครส่ง
  note?: string | null; // หมายเหตุบนใบส่ง
  poCode?: string | null; // เลขใบ PO ที่ใบโอนอ้าง (มีเฉพาะ dc + อ้าง PO)
  sentAt?: Date | null; // ส่งมาวันไหน (dispatchedAt / createdAt)
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
  unitCostCents?: number | null; // ราคาทุน/ตัว (บาท×100) — โชว์อย่างเดียว (ดีไซน์ใหม่)
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
  shortReason?: string; // เหตุผล "เงินขาด" (ด่านกันโกง server) — ห้ามใช้เก็บอย่างอื่น
  notes?: string; // หมายเหตุทั่วไป (เช่น "ไม่แนบรูป: ...") — ไม่กระทบด่านเงินขาด
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
  // ราคาขายตุ๊กตาต่อตู้ (สตางค์) — โชว์ "ขาย ฿" ในหน้าเปลี่ยนตุ๊กตา (mockup SW-03)
  sellPriceCents: number | null;
};

const DEMO_BRANCH_ID = "demo-branch-rs";
const DEMO_SKUS: CollectSku[] = [
  { id: "demo-sku-1", sku: "KT-01", name: "ซานริโอ้ คิตตี้" },
  { id: "demo-sku-2", sku: "BR-01", name: "หมีบราวน์ L" },
  { id: "demo-sku-3", sku: "MJ-01", name: "โมจิหมีขาว" },
  { id: "demo-sku-4", sku: "KM-01", name: "คุมะ ไซส์ M" },
];

const DEMO_MACHINES: AppMachine[] = [
  { id: "demo-RS-03", code: "RS-03", nickname: null, branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 10, lastDollMeter: 105, lastCoinMeter: 210, product: "ซานริโอ้ คิตตี้", awaitingSetup: false , sellPriceCents: 25000 },
  { id: "demo-RS-04", code: "RS-04", nickname: null, branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 12, lastDollMeter: 88, lastCoinMeter: 540, product: "โมจิหมีขาว", awaitingSetup: false , sellPriceCents: 25000 },
  { id: "demo-RS-07", code: "RS-07", nickname: null, branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 9, lastDollMeter: 150, lastCoinMeter: 300, product: "หมีบราวน์ L", awaitingSetup: false , sellPriceCents: 25000 },
  { id: "demo-RS-05", code: "RS-05", nickname: null, branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 11, lastDollMeter: 120, lastCoinMeter: 410, product: "คุมะ ไซส์ M", awaitingSetup: false , sellPriceCents: 25000 },
  { id: "demo-BK-02", code: "BK-02", nickname: null, branch: "บางแค", zone: "โซน C", branchId: DEMO_BRANCH_ID, lastStock: 8, lastDollMeter: 212, lastCoinMeter: 880, product: "หมีน้ำตาล S", awaitingSetup: false , sellPriceCents: 25000 },
  { id: "demo-LP-01", code: "LP-01", nickname: null, branch: "ลาดพร้าว", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 7, lastDollMeter: 64, lastCoinMeter: 150, product: "ซานริโอ้ คิตตี้", awaitingSetup: false , sellPriceCents: 25000 },
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
          sellPriceCents: m.sellPriceCents,
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
/** เติม field ที่ Form เพิ่งเพิ่ม ให้ร่างเก่าที่ค้างใน localStorage (เขียนโดยเวอร์ชันก่อนหน้า).
 *  ⚠️ ห้ามลืม: พนักงานที่ "บันทึกค้างไว้" ก่อน deploy จะ resume ร่างที่ไม่มี field ใหม่ →
 *  อ่านตรง ๆ = undefined = จอขาวคาหน้างาน (เงิน/ตุ๊กตาที่กรอกไว้หายทั้งรอบ). */
function normalizeForm(form: Form): Form {
  return {
    ...form,
    refillLines: Array.isArray(form.refillLines) ? form.refillLines : [],
    returnedTotal: typeof form.returnedTotal === "number" ? form.returnedTotal : 0,
    remainBySku: form.remainBySku && typeof form.remainBySku === "object" ? form.remainBySku : {},
  };
}
function loadDrafts(key: string): Record<string, Draft> {
  if (typeof window === "undefined") return {}; // SSR guard
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, Draft> = {};
    for (const [k, d] of Object.entries(parsed as Record<string, Draft>)) {
      if (!d || typeof d !== "object" || !d.form) continue; // ร่างเสีย → ข้าม (ดีกว่าพังทั้งแอป)
      out[k] = { ...d, form: normalizeForm(d.form), photos: { ...blankPhotos, ...(d.photos ?? {}) } };
    }
    return out;
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
    // snapshot เก่า (ก่อนมี refillLines/remainBySku) → เติม default ให้ครบ · FlowScreen จะ fallback
    // เป็นช่องนับรวมเมื่อไม่มีเลขรายตัว (กันเลขรายตัวเก่าเขียนทับ left ที่นับจริงไว้แล้ว)
    const form: Form = normalizeForm(snap.form as Form);
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
  // ดีไซน์ใหม่ · ตุ๊กตาที่ "คืนเข้าชั้น" ระหว่างรอบนี้ (ไม่ใช่ลูกค้าคีบ) — ใช้หัก "ตุ๊กตาออก" ให้ตรงกับที่ server
  // กระทบยอด (server หัก interim cf_return_dolls ให้เอง) · ไม่ถูกส่งใน submit → สัญญาเดินเงินเดิมไม่เปลี่ยน
  returnedTotal: number;
  // ดีไซน์ใหม่ · ที่นับได้ "รายตัว/SKU" (productId → จำนวนที่พิมพ์). left = Σ ค่านี้ (money-safe).
  // ⚠️ ต้องอยู่ใน Form เพราะ Draft/WipSnapshot เก็บ form ทั้งก้อน → บันทึกค้าง/กลับมาทำต่อ เลขรายตัวไม่หาย
  //    (ถ้าเก็บเป็น state ใน FlowScreen อย่างเดียว: resume แล้วรายตัวจะกลับเป็นยอดในระบบ ขณะที่ left = ที่นับไว้
  //     → แตะ −/+ ทีเดียว left ถูกเขียนทับด้วยผลรวมเก่า = ตุ๊กตาออกเพี้ยนหลายสิบตัว)
  remainBySku: Record<string, string>;
};

/** field ที่พนักงานต้องนับ/อ่านเอง (ไม่ใช่ค่าจากระบบ) */
const COUNTED_KEYS = ["left", "refill", "price", "dollGear", "dollDigi", "coinGear", "coinDigi", "cash"] as const;
type CountedKey = (typeof COUNTED_KEYS)[number];
/** ค่าที่ใช้คำนวณ: null → 0 (เฉพาะตอน "พรีวิว" เท่านั้น · submit จะ gate ไม่ให้ null หลุด) */
const n0 = (v: Counted): number => (v == null ? 0 : v);
const isFilled = (v: Counted): boolean => v != null;

/** ดีไซน์ใหม่ · มิเตอร์ 4 ช่องเรียง 2×2 (เงินบน/เงินล่าง/ตุ๊กตาบน/ตุ๊กตาล่าง) — ตามตัวอย่าง.
 *  key/photoKey ชี้ field เดิมใน Form/Photos ตรง ๆ → ค่าที่ส่ง server ไม่เปลี่ยน. */
const METER_CELLS = [
  { key: "coinGear", photoKey: "coinGear", label: "เงิน · บน (เฟือง)", pair: "coin", phase: "meter_after" },
  { key: "coinDigi", photoKey: "coinDigi", label: "เงิน · ล่าง (ดิจิตอล)", pair: "coin", phase: "meter_after" },
  { key: "dollGear", photoKey: "dollGear", label: "ตุ๊กตา · บน (เฟือง)", pair: "doll", phase: "prize_meter" },
  { key: "dollDigi", photoKey: "dollDigi", label: "ตุ๊กตา · ล่าง (ดิจิตอล)", pair: "doll", phase: "prize_meter" },
] as const satisfies ReadonlyArray<{
  key: CountedKey; photoKey: keyof Photos; label: string; pair: "coin" | "doll"; phase: Phase;
}>;

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
    returnedTotal: 0, // ยังไม่คืนอะไรตอนเปิดรอบ
    remainBySku: {}, // FlowScreen seed จากตุ๊กตาในตู้ตอนเปิด (ยังไม่รู้ SKU ตรงนี้)
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
  // ดีไซน์ใหม่ · แตะแถบขั้นเพื่อกระโดดไป-กลับได้ (ไม่มีด่านระหว่างทางแล้ว · WIP autosave เก็บให้อยู่แล้ว)
  | { type: "goStep"; step: number }
  | { type: "fillMeterNow" }
  | { type: "sendConfig" }
  // ดีไซน์ใหม่ · คืนตุ๊กตาเข้าชั้นระหว่างรอบ (สะสมไว้หัก "ตุ๊กตาออก" ให้ตรง server)
  | { type: "addReturned"; qty: number }
  // ดีไซน์ใหม่ · ที่นับรายตัว/SKU (เก็บใน form → ติดไปกับร่าง/WIP อัตโนมัติ)
  | { type: "setRemainBySku"; map: Record<string, string> }
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
        // [STEP] map WIP เก่า (1-5) → ขั้นจริงใหม่ {1,3,5} (2→1 · 4→3).
        step: a.snapshot.step <= 2 ? 1 : a.snapshot.step <= 4 ? 3 : 5,
      };
    case "next":
      // [STEP] (CEO 2026-07-13) รวม 5→3 สเต็ป · ขั้น "จริง" = 1(นับ+เติม) · 3(มิเตอร์+เงินสด) · 5(กระทบยอด).
      // next กระโดด 1→3→5→6 (ขั้น 2/4 ถูกรวม render เข้ากับ 1/3 ไม่ใช่ current step แล้ว).
      return { ...s, step: s.step >= 5 ? 6 : s.step >= 3 ? 5 : 3 };
    case "back":
      // [STEP] back กระโดด 5→3→1→home (0).
      return { ...s, step: s.step >= 5 ? 3 : s.step >= 3 ? 1 : 0 };
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
      // เริ่มที่ 1 (แตะจาก catalog = ตั้งใจเติมอย่างน้อย 1 · ตาม mockup) — เดิมเริ่ม 0 ต้องกด + ซ้ำ
      const line: RefillLine = { productId: a.productId, name: a.name, qty: 1 };
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
    case "goStep":
      // เฉพาะขั้นกรอกจริง {1,3,5} · ห้ามกระโดดข้ามไปหน้า "เสร็จ" (6) ที่ต้องผ่าน submit เท่านั้น
      return a.step === 1 || a.step === 3 || a.step === 5 ? { ...s, step: a.step } : s;
    case "fillMeterNow":
      return { ...s, step: 3, meterDeferred: false };
    case "sendConfig":
      return { ...s, configSent: true };
    // ดีไซน์ใหม่ · สะสมจำนวนที่คืนเข้าชั้นระหว่างรอบ (หัก "ออก" ตอนพรีวิว · server หัก interim ให้เองตอนกระทบยอด)
    case "addReturned":
      return { ...s, form: { ...s.form, returnedTotal: (s.form.returnedTotal ?? 0) + a.qty } };
    case "setRemainBySku":
      return { ...s, form: { ...s.form, remainBySku: a.map } };
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
  // CEO 2026-07-18 · ชนิดรายการ (ป้ายในประวัติ): เก็บเงิน / เปลี่ยนตุ๊กตา / ตั้งค่าครั้งแรก
  kind?: "collect" | "swap" | "baseline";
  code: string;
  nickname?: string | null;
  time: string;
  cashBaht: number; // เงินที่นับได้จริง (actual)
  // #1 CEO 2026-07-19 · เงินที่ "ควรได้" จากมิเตอร์ + ส่วนต่าง (+เกิน / −ขาด) — reconcile จริงจาก server
  expectedCashBaht?: number;
  cashDiffBaht?: number;
  ok: boolean; // = เงินตรงมิเตอร์ (|ขาด/เกิน| ≤ ฿20) เมื่อมี reconcile · ไม่งั้น fallback ไม่มีธง anomaly
  branch?: string; // สาขาของตู้ (ช่วยจำว่าเก็บที่ไหน)
  date?: string; // YYYY-MM-DD ของรอบ (ตามเวลาไทย) — ใช้จัดกลุ่มตามวัน
  coinMeter?: number; // เลขมิเตอร์เหรียญที่บันทึกไว้ (หลักฐานตัวเลขที่กรอก · = after)
  dollMeter?: number; // เลขมิเตอร์ตุ๊กตา (= after)
  // มิเตอร์ "ก่อน" + บน/ล่าง กายภาพ (CEO 2026-07-19: ใบต้องเห็นมิเตอร์ บน/ล่าง + คิด delta ได้)
  coinMeterBefore?: number; // มิเตอร์เหรียญปิดรอบก่อน → delta = after − before = ยอดจริง
  meterMoneyTop?: number; meterMoneyBottom?: number; // มิเตอร์เงิน บน/ล่าง (กายภาพ)
  meterDollTop?: number; meterDollBottom?: number; // มิเตอร์ตุ๊กตา บน/ล่าง (กายภาพ)
  refillQty?: number; // จำนวนที่เติมเข้าตู้รอบนี้
  // รายละเอียดรอบ (โชว์ในหน้า detail หน้าเดียว)
  stockBefore?: number;
  stockAfter?: number;
  dollsOut?: number;
  shortReason?: string; // เหตุผลเงินขาด / ไม่แนบรูป
  photos?: { url: string; label: string }[]; // รูปหลักฐาน (มี url จริง) — กดดูขยายได้
  // swap
  swapReturned?: number;
  swapRefilled?: number;
  // item 8 · รอบตั้งต้น (baseline) — ป้าย "การตั้งค่าครั้งแรก" (indigo)
  isBaseline?: boolean;
  // item 5/8 · รูปหลักฐานยังไม่ครบ — ป้าย "รูปยังไม่ครบ" (amber) + ปุ่ม "แนบรูปเพิ่ม"
  photosMissing?: boolean;
  // item 5 · id ของ event (แนบรูปเพิ่มทีหลัง → attachEventPhotos)
  eventId?: string;
  // item 5 · ชนิด event (INITIAL = baseline → phase รูปคนละชุด · COLLECTION = รอบปกติ)
  eventType?: string;
};

type Props = {
  orgId: string;
  branches: GroupCollectBranch[];
  skus: CollectSku[];
  // นโยบายถ่ายรูป (จาก org settings) — true = บังคับถ่ายก่อนไปต่อ, false = ถ่ายได้-ข้ามได้
  photoRequired: boolean;
  // ชื่อพนักงานที่ล็อกอิน (โชว์ทักทาย) — "" = ไม่ทราบ → ใช้ default
  userName: string;
  // จำนวนตู้ (distinct) ที่ "ฉัน" เก็บเสร็จจริงวันนี้ (จาก cf_collection_events) → progress bar
  closedTodayCount: number;
  // "วันนี้" ตามเวลาไทย (คิดที่ server กัน tz drift) — ใช้กรอง "เก็บแล้ววันนี้". optional: ไม่ส่ง → fallback client clock
  todayYmd?: string;
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
  // F3 · ประวัติ "ใบนับสต๊อก" แยกตาม branchId (จาก CfStockCount · READ-ONLY) — แท็บ "ประวัติใบนับ" ในหน้านับสต๊อก. optional default {}.
  countsByBranch?: Record<string, CfCountRow[]>;
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

export function StaffAppClient({ orgId, branches, skus, photoRequired, userName, closedTodayCount, todayYmd, history, selectedDate, myRecentTickets = [], assignedOnly = false, awaitingSetupIds = [], branchProducts = {}, inboundByBranch = {}, warehousesByBranch = {}, onHandByBranch = {}, receivedByBranch = {}, countsByBranch = {}, inMachineByMachine = {}, netAvailableByBranch = {} }: Props) {
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
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} userName={userName} closedTodayCount={closedTodayCount} todayYmd={todayYmd} history={history} viewDate={viewDate} myRecentTickets={myRecentTickets} assignedOnly={assignedOnly} branchProducts={branchProducts} inboundByBranch={inboundByBranch} warehousesByBranch={warehousesByBranch} onHandByBranch={onHandByBranch} receivedByBranch={receivedByBranch} countsByBranch={countsByBranch} inMachineByMachine={inMachineByMachine} netAvailableByBranch={netAvailableByBranch} />
  );
  const appMobile = (
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} userName={userName} closedTodayCount={closedTodayCount} todayYmd={todayYmd} history={history} viewDate={viewDate} myRecentTickets={myRecentTickets} assignedOnly={assignedOnly} branchProducts={branchProducts} inboundByBranch={inboundByBranch} warehousesByBranch={warehousesByBranch} onHandByBranch={onHandByBranch} receivedByBranch={receivedByBranch} countsByBranch={countsByBranch} inMachineByMachine={inMachineByMachine} netAvailableByBranch={netAvailableByBranch} />
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
  todayYmd?: string; // "วันนี้" (เวลาไทย · จาก server) → กรอง "เก็บแล้ววันนี้"
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
  // F3 · ประวัติใบนับ แยกตาม branchId (แท็บ "ประวัติใบนับ" ในหน้านับสต๊อก)
  countsByBranch: Record<string, CfCountRow[]>;
  // 🆕 ตุ๊กตาในตู้ตอนนี้ (แยกตาม machineId) + ของว่างในคลังต่อสินค้า (แยกตาม branchId) — sheet คืนตุ๊กตา
  inMachineByMachine: Record<string, InMachineDoll[]>;
  netAvailableByBranch: Record<string, Record<string, number>>;
};

// "stock" panel เดิม = นับสต๊อก (N3) · เพิ่ม "receive" (N6 รับสินค้า) เข้า quick-menu
type Panel = "history" | "repair" | "stock" | "receive" | "config" | "tour" | null;

function StaffApp({ orgId, machines, skus, usingDemo, photoRequired, userName, closedTodayCount, todayYmd, history, viewDate, myRecentTickets, assignedOnly, branchProducts, inboundByBranch, warehousesByBranch, onHandByBranch, receivedByBranch, countsByBranch, inMachineByMachine, netAvailableByBranch }: StaffAppProps) {
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
  // item 7 · เปิด sheet คืนในโหมด "เปลี่ยน" (header hint "คืนตัวเก่าก่อน แล้วเติมใหม่" + ปุ่มเติมต่อหลังคืน).
  const [returnChangeMode, setReturnChangeMode] = useState(false);
  // ชิ้น 2 (CEO 2026-07-13) · เติมตุ๊กตา "อย่างเดียว" — ตู้ที่กำลังเปิด sheet เติม (null = ปิด).
  const [refillMachineId, setRefillMachineId] = useState<string | null>(null);
  // FIX-1 · money-safe บันทึกค้าง: ถ้ากด "บันทึกค้าง" ก่อน upload รูปเสร็จ → ร่างจะเก็บรูปเป็น "" (หาย).
  // → กันไม่ให้ saveDraft ทำงานตราบใดที่ยังมีรูปอัปโหลดค้าง (photosCaptured มี แต่ photos ยังว่าง).
  // แต่ต้องมี "ทางออก": ถ้า upload ค้างนานเกิน (เน็ตตก/ล้ม) → หลัง ~8 วิ ปล่อยให้บันทึกได้ (offline-tolerant
  // ตามปรัชญา sentinel เดิม · ร่างจะเก็บ url ที่มาทันเท่านั้น · retry อัปโหลดวิ่งต่อเบื้องหลัง).
  const [allowSaveDespitePending, setAllowSaveDespitePending] = useState(false);
  // CEO 2026-07-18 · กดยืนยันแล้วรูปยังอัปไม่เสร็จ → ค้างเป็น "รอส่งอัตโนมัติ" แทนบล็อกให้กดซ้ำเอง
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);
  // CEO 2026-07-18 · เหตุผลที่ปิดรอบโดยไม่มีรูป (นโยบายบังคับ) — มีค่า = ผ่านด่านรูปได้ · เก็บลง shortReason
  const [photoSkipReason, setPhotoSkipReason] = useState<string | null>(null);
  const [photoReasonOpen, setPhotoReasonOpen] = useState(false);

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
  // ชิ้น 2 · เติมตุ๊กตาอย่างเดียว — ตู้ + สินค้าคลังสาขา + net "ของบนชั้นจริง" ของสาขานั้น
  const refillMachine = useMemo(
    () => machines.find((m) => m.id === refillMachineId) ?? null,
    [machines, refillMachineId],
  );
  const refillProducts = useMemo(
    () => (refillMachine ? branchProducts[refillMachine.branchId] ?? [] : []),
    [branchProducts, refillMachine],
  );
  const refillNet = useMemo(
    () => (refillMachine ? netAvailableByBranch[refillMachine.branchId] ?? {} : {}),
    [netAvailableByBranch, refillMachine],
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
  // ดีไซน์ใหม่ · หัก "ที่คืนเข้าชั้นระหว่างรอบ" ออก — ตัวที่คืนไม่ใช่ลูกค้าคีบ
  //   mirror server: prizeOut = stockBefore + refill − stockAfter − interim(cf_return_dolls)
  //   → ตรงกับมิเตอร์ตุ๊กตา (มิเตอร์เดินเฉพาะตัวที่ออกจริง) · จอ = server (money-safe)
  const returnedThisRound = f.returnedTotal ?? 0;
  const dispensed = Math.max(0, f.last - n0(f.left) - returnedThisRound);
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

  /* ── ดีไซน์ใหม่ (CEO 2026-07-15) · "ถัดไป = เซฟ" — ขั้น 1/2 ไม่บล็อกเลย ──────────────
   * เดิม: ไม่เติม/ไม่ถ่ายรูป → กดถัดไปไม่ได้ → พนักงานติดหน้างาน (ตุ๊กตาหมดก็ไม่ได้เติม · รีบ).
   * ใหม่: เดินหน้าได้ตลอด · WIP autosave (400ms) เก็บทุกช่อง+รูปให้อยู่แล้ว → ข้อมูลไม่หาย.
   * ด่านเดียวที่เหลือ = ตอน "ปิดรอบจริง" (ขั้น 3) ซึ่งต้องมีเลขครบ ไม่งั้นยอดเงินเข้าระบบผิด
   * → ยังไม่ครบ = ไม่ปิดรอบ แต่ "บันทึกค้างไว้" ให้แทน (ไปตู้ต่อ · กลับมากรอกทีหลัง). */
  const meterFilled = isFilled(f.dollGear) && isFilled(f.dollDigi) && isFilled(f.coinGear) && isFilled(f.coinDigi);
  /* ── รูป: ไม่บล็อกการ "เดินหน้า" อีกต่อไป (CEO 2026-07-15: "รูปยังไม่ต้องแนบก็ได้ กดถัดไปก่อนได้") ──
   * แต่ยังบังคับ "ตอนปิดรอบ" เมื่อองค์กรเปิดนโยบายบังคับถ่าย (photoRequired · ค่าเริ่มต้น=เปิด) —
   * ไม่งั้นสวิตช์ในหน้าตั้งค่าจะกลายเป็นปุ่มหลอก (เปิดอยู่ แต่ปิดรอบได้โดยไม่มีรูปหลักฐานสักใบ)
   * และรอบที่เงินไม่ตรงจะไม่มีรูปให้ตรวจย้อนเลย. รูปมิเตอร์ = ไม่บังคับ (ใช้ตอนอ่านเลขไม่ออก · ตามตัวอย่าง). */
  const stockPhotosOk = !!state.photosCaptured.before && !!state.photosCaptured.after;
  const photoRequiredMissing = photoRequired && !stockPhotosOk;
  // เลขที่ server ใช้คิดเงินครบไหม (นับเหลือ + เงินสด + มิเตอร์ 4 ช่อง) — ขาด = ปิดรอบไม่ได้จริง (กันยอด 0 หลอก)
  const numbersReady = isFilled(f.left) && isFilled(f.cash) && meterFilled;
  // CEO 2026-07-18 · รูปบังคับแต่ไม่ถ่าย → ปิดรอบได้ "ถ้าใส่เหตุผล" (ไม่บล็อกตาย · เก็บ shortReason ไว้ตรวจ)
  const needPhotoReason = numbersReady && photoRequiredMissing;
  // ปิดรอบได้เลย = เลขครบ + (รูปครบ หรือ ใส่เหตุผลข้ามรูปแล้ว)
  const submitReady = numbersReady && (!photoRequiredMissing || !!photoSkipReason);
  const meterReady = submitReady;
  // ยังไม่ครบอะไรบ้าง → บอกตรง ๆ ที่ขั้นกระทบยอด (พร้อมปุ่มบันทึกค้าง · ไม่ทิ้งงาน)
  const missingForSubmit: string[] = [];
  if (!isFilled(f.left)) missingForSubmit.push("นับตุ๊กตาที่เหลือ");
  if (!isFilled(f.cash)) missingForSubmit.push("เงินสดที่เก็บได้");
  if (!meterFilled) missingForSubmit.push("เลขมิเตอร์ 4 ช่อง");
  if (photoRequiredMissing) missingForSubmit.push("รูปก่อน/หลังเติม (นโยบายบริษัท)");

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
    setPhotoSkipReason(null); setPhotoReasonOpen(false); setAutoSubmitPending(false); // เปิดตู้ใหม่ = เริ่มเหตุผลรูปใหม่
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

  // CEO 2026-07-18 · ปิดรอบไม่มีรูป: ตั้ง reason แล้วยิงเลย (ส่ง reason ตรง กัน state ยังไม่อัปเดตในทิคเดียว)
  function submitRoundWithPhotoReason(reason: string) {
    submitRound(reason);
  }

  /* ── submit the round: REAL → submitBranchEvent + closeBranchSession; DEMO → optimistic ──
   * photoReasonArg = เหตุผลปิดรอบไม่มีรูป (ส่งตรงจากปุ่ม · bypass ด่านรูป) — ปกติอ่านจาก state */
  function submitRound(photoReasonArg?: string) {
    if (!machine) return;
    setError(null);
    const effPhotoReason = photoReasonArg ?? photoSkipReason;

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
    // safety net: ช่องที่ server ใช้คิดเงินต้องกรอกครบก่อนปิดรอบ → กันส่ง 0 ปลอมเข้าระบบ anti-cheat.
    // ⚠️ "เติมกี่ตัว" ไม่อยู่ในด่านนี้แล้ว (CEO 2026-07-15): ไม่เติม = เติม 0 ตัว ซึ่งถูกต้องอยู่แล้ว
    //    (refillTotal coalesce null→0) — เดิมบังคับให้กรอกช่องเติม ทำให้รอบที่ "ไม่ได้เติม" ส่งไม่ได้.
    // เลขต้องครบเสมอ · รูปข้ามได้ถ้ามีเหตุผล (effPhotoReason) ตามนโยบาย CEO 2026-07-18
    const okToClose = numbersReady && (!photoRequiredMissing || !!effPhotoReason);
    if (!okToClose) {
      setError(`ยังกรอกไม่ครบ: ${missingForSubmit.join(" · ")} — กรอกให้ครบก่อนปิดรอบ (หรือกดบันทึกค้างไว้)`);
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
        // CEO 2026-07-18 · เดิมบล็อกให้กดเองซ้ำ ("รอสักครู่แล้วกดอีกครั้ง") = พนักงานงงว่ากดไม่ได้.
        // ใหม่: จำเจตนา "ส่ง" ไว้ → พอ url รูปครบ (queue อัปเสร็จเอง) useEffect จะยิง submit ให้อัตโนมัติ
        //       กดครั้งเดียวจบ · รูปไม่หาย (ส่ง url จริงครบ). ระหว่างรอโชว์สปินเนอร์บนปุ่ม.
        setAutoSubmitPending(true);
        setError(null);
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
      // CEO 2026-07-18 · ปิดรอบโดยไม่มีรูป → เก็บเหตุผลใน `notes` (ไม่ใช่ shortReason!)
      //   ⚠️ shortReason = ช่องเหตุผล "เงินขาด" ที่ server ใช้เป็นด่านกันโกง — ถ้าเอามาใส่เหตุผลรูป
      //   จะทำให้รอบที่เงินขาดจริงข้ามด่าน (server เห็น shortReason มีค่า = ผ่าน). notes ปลอดภัย ไม่แตะด่าน.
      ...(effPhotoReason ? { notes: `ไม่แนบรูป: ${effPhotoReason}` } : {}),
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

  // CEO 2026-07-18 · auto-submit — พอกดยืนยันแล้วรูปยังอัปไม่เสร็จ (autoSubmitPending) รอจน url ครบ
  // (uploadingCount===0) แล้วยิง submitRound ให้เอง · กดครั้งเดียวจบ ไม่ต้องกดซ้ำ · รูปไม่หาย.
  // ยกเลิกอัตโนมัติเมื่อ: ออกจากขั้นกระทบยอด · กำลังส่งอยู่ · หมดเวลา escape (เน็ตล้ม → กลับไปเป็นบล็อกให้กดเอง)
  useEffect(() => {
    if (!autoSubmitPending) return;
    // set-state ใน effect ตั้งใจ (orchestrate auto-submit) — pattern เดียวกับ effect อื่นในไฟล์นี้
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.step !== 5 || pending) { setAutoSubmitPending(false); return; }
    if (uploadingCount === 0) {
      setAutoSubmitPending(false);
      submitRound();
    } else if (allowSaveDespitePending) {
      // 8 วิ แล้วยังอัปไม่เสร็จ (เน็ตตก) → เลิกออโต้ · แจ้งให้กดเอง (queue ยัง retry อยู่)
      setAutoSubmitPending(false);
      setError("รูปยังส่งไม่ขึ้น (เน็ตช้า) · กด “ยืนยัน” อีกครั้งเมื่อสัญญาณกลับมา — รูปไม่หาย ระบบส่งซ้ำให้เอง");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmitPending, uploadingCount, allowSaveDespitePending, state.step, pending]);

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

  /* ── bottom-bar primary/secondary buttons (ดีไซน์ใหม่ · ป้ายบอกปลายทางเหมือนตัวอย่าง) ── */
  let primaryLabel = "ถัดไป";
  let primaryColor = "#4F46E5";
  let primaryAction: () => void = () => dispatch({ type: "next" });
  // ปุ่มรองใต้ปุ่มหลัก — ตอนนี้ไม่มีขั้นไหนใช้ (การ์ดแก้ inline แทนการเด้งข้ามขั้น) · คงโครงไว้เผื่ออนาคต
  const secondaryLabel = "";
  const secondaryAction: (() => void) | null = null;

  if (state.step === 1) {
    primaryLabel = "ถัดไป · มิเตอร์ + เงินสด";
  } else if (state.step === 3) {
    primaryLabel = "ถัดไป · กระทบยอด";
  } else if (state.step === 5) {
    if (needPhotoReason && !photoSkipReason) {
      // CEO 2026-07-18 · เลขครบแล้ว ขาดแค่รูป (นโยบายบังคับ) → กดปิดรอบได้ แต่ต้องใส่เหตุผลก่อน
      primaryLabel = "ปิดรอบ · ไม่มีรูป (ใส่เหตุผล)";
      primaryColor = "#B45309";
      primaryAction = () => setPhotoReasonOpen(true);
    } else if (!submitReady) {
      // นโยบายผสม (CEO 2026-07-16 · mockup-match): เลขยังไม่ครบ → ปุ่มหลักเทา no-op ตาม mockup
      // ("ยังมี N จุดผิด · แก้ให้ครบก่อน") — กรอกได้ในการ์ดแดงบนหน้านี้เลย ไม่ต้องเด้งไปไหน
      // · "บันทึกค้างไว้" ยังอยู่เป็นปุ่มรอง (FlowScreen โชว์ให้ที่ขั้น 5 เมื่อไม่พร้อม) — งานไม่ทิ้ง
      primaryLabel = `ยังมี ${missingForSubmit.length} จุดผิด · แก้ให้ครบก่อน`;
      primaryColor = "#F1F2F5";
      primaryAction = () => {};
    } else {
      // แดง = เตือน ไม่ได้ห้ามส่ง (CEO 2026-07-13) → กดยืนยันได้เสมอเมื่อเลขครบ
      // autoSubmitPending = กดแล้ว รอรูปอัปเสร็จ → โชว์ "กำลังส่งรูป…" ระบบยิงให้เอง (CEO 2026-07-18)
      primaryLabel = pending ? "กำลังส่ง..." : autoSubmitPending ? "⏳ กำลังส่งรูป… เดี๋ยวบันทึกให้เลย" : allMatch ? "ยืนยันกระทบยอด" : "ยืนยันส่งข้อมูล (มีจุดไม่ตรง)";
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
  const primaryDisabled = pending || autoSubmitPending || (savingDraftStep && uploadPending);

  // [STEP] label ตามขั้นจริงใหม่ {1,3,5,6}
  const stepLabels: Record<number, string> = {
    1: "นับ + เติมตุ๊กตา",
    3: "มิเตอร์ + เงินสด",
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
          // สินค้า "ในตู้นี้" ต้อง scope ต่อตู้จริง (inMachineByMachine) ไม่ใช่ทั้งสาขา —
          // เดิมส่ง branchProducts[branchId] → สินค้าของตู้อื่นในสาขารั่วมาโชว์ทุกตู้
          // (เช่น "หมี" ที่ใส่ตู้ A โผล่ตู้ B) + ยังถูก submit เป็น loadout ตั้งต้นตู้นี้ผิด ๆ.
          products={(inMachineByMachine[baselineMachine.id] ?? []).map((p) => ({
            id: p.productId,
            name: p.name,
            imageUrl: p.imageUrl,
          }))}
          // CEO 2026-07-16 · ของที่ "มีในคลังสาขา" (เช่น เพิ่งรับจากใบโอน DC) ต้องเลือกเข้าตู้ได้
          //   — แยก prop จาก products (ในตู้นี้) → ไม่ทำ loadout ตั้งต้นเพี้ยน (บั๊กสินค้ารั่วข้ามตู้เดิม)
          branchStock={branchProducts[baselineMachine.branchId] ?? []}
          // ★ NET shelf (คลัง − ในตู้ทุกตู้) = เลขเดียวกับที่ server กันหยิบเกิน (ห้ามใช้ GROSS warehouse
          //   — bug-class gross-vs-net 2026-07-12: จอบอก 10 แต่ server ให้หยิบได้ 4)
          netById={netAvailableByBranch[baselineMachine.branchId] ?? {}}
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
          todayYmd={todayYmd}
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
          onReturn={(m) => { setError(null); setReturnChangeMode(false); setReturnMachineId(m.id); }}
          // [C] "เปลี่ยน" → เปิด sheet "เปลี่ยน/เติม" (return+refill · รอบเก็บเงินจริง reconcile ให้ · ชิ้น 3).
          onChange={(m) => { setError(null); setRefillMachineId(m.id); }}
          onRefillOnly={(m) => { setError(null); setRefillMachineId(m.id); }}
          onSetup={() => {
            // ดีไซน์ใหม่ · CTA ตั้งค่าตู้ใหม่ → เปิด BaselineForm ให้ตู้ที่ยังรอตั้งค่า (AWAITING_SETUP) ตัวแรก.
            const need = machines.find((m) => m.awaitingSetup && !isDemo(m.id));
            if (need) { setError(null); setBaselineMachineId(need.id); return; }
            setError("ยังไม่มีตู้ใหม่ที่รอตั้งค่า · ตู้ที่เพิ่มเข้ามาใหม่จะขึ้นตรงนี้ให้ตั้งค่าครั้งแรก");
          }}
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
          countsByBranch={countsByBranch}
        />
      ) : (
        <FlowScreen
          orgId={orgId}
          usingDemo={usingDemo}
          eventScopeId={`${state.sessionId ?? "demo"}-${machine?.id ?? "none"}`}
          machine={machine}
          inMachineDolls={state.machineId ? (inMachineByMachine[state.machineId] ?? []) : []}
          step={state.step}
          stepLabel={stepLabels[state.step] ?? ""}
          form={f}
          setNum={setNum}
          dispensed={dispensed}
          afterFill={afterFill}
          photos={state.photos}
          photosCaptured={state.photosCaptured}
          onPhoto={(k, url) => dispatch({ type: "setPhoto", key: k, url })}
          onCapture={(k) => dispatch({ type: "capturePhoto", key: k })}
          photoRequired={photoRequired}
          onGoStep={(n) => dispatch({ type: "goStep", step: n })}
          missingForSubmit={missingForSubmit}
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
          // item 7 · "record & go" — บันทึกค้าง (form+รูป) ไปตู้ต่อ โดยไม่ต้องผ่านมิเตอร์/รูปก่อน.
          //  reuse saveDraft เดิม (resume ที่ step 3 มิเตอร์ · money-safe: รอบยังไม่ปิดจนกรอกมิเตอร์).
          //  uploadPending → รอ upload รูปเสร็จก่อน (กันรูปหายตอน resume). demo → ไม่มี backend → ซ่อน.
          onSaveDraft={saveDraft}
          saveDraftBlocked={uploadPending}
          // ดีไซน์ใหม่ · คืนตุ๊กตาเข้าชั้นระหว่างรอบ → สะสมไว้หัก "ตุ๊กตาออก" (server หัก interim ให้เองตอนกระทบยอด)
          onReturned={(qty) => dispatch({ type: "addReturned", qty })}
          onSetRemainBySku={(map) => dispatch({ type: "setRemainBySku", map })}
        />
      )}

      {/* CEO 2026-07-18 · ปิดรอบไม่มีรูป → เลือกเหตุผลก่อน (เก็บลง shortReason · แล้วยิง submit ให้เลย) */}
      {photoReasonOpen && (
        <PhotoSkipReasonSheet
          onCancel={() => setPhotoReasonOpen(false)}
          onConfirm={(reason) => {
            setPhotoSkipReason(reason);
            setPhotoReasonOpen(false);
            // ตั้ง reason แล้วยิง submit ทันที (submitReady จะเป็น true หลัง state อัปเดต) — ใช้ arg ตรง กัน stale
            submitRoundWithPhotoReason(reason);
          }}
        />
      )}

      {/* 🆕 คืนตุ๊กตาจากตู้เข้าคลัง — bottom-sheet overlay (ราย SKU + รูป + ยืนยันจำนวนเดิม)
          item 7 · changeMode → header hint "คืนตัวเก่าก่อน แล้วเติมใหม่" + ปุ่มเติมต่อ (reuse flow เติม · ไม่มี write ใหม่) */}
      {returnMachine && (
        <ReturnDollsSheet
          machine={returnMachine}
          dolls={returnDolls}
          netAvailable={returnNetAvailable}
          usingDemo={usingDemo}
          changeMode={returnChangeMode}
          onClose={() => setReturnMachineId(null)}
          onRefill={() => {
            // ปิด sheet แล้วเปิด flow เก็บ/เติมของตู้เดิม (reuse refill flow · ไม่มี write ใหม่)
            const m = returnMachine;
            setReturnMachineId(null);
            openMachine(m);
          }}
        />
      )}
      {/* ชิ้น 2 · sheet เติมตุ๊กตาอย่างเดียว (โหลดคลัง→ตู้ · refillDollsToMachine) */}
      {refillMachine && (
        <RefillDollsSheet
          machine={refillMachine}
          products={refillProducts}
          netById={refillNet}
          dolls={inMachineByMachine[refillMachine.id] ?? []}
          orgId={orgId}
          usingDemo={usingDemo}
          onClose={() => setRefillMachineId(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── HOME ─────────────────────────── */
function HomeScreen(props: {
  userName: string;
  todayYmd?: string; // "วันนี้" (เวลาไทย · server) → กรอง "เก็บแล้ววันนี้"
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
  // item 7 · "เปลี่ยน" — เปิด sheet คืน (โหมดเปลี่ยน · header hint + ปุ่มเติมต่อ) · reuse flow คืน+เติม (ไม่มี write ใหม่)
  onChange: (m: AppMachine) => void;
  // ชิ้น 2 · "เติม" — เปิด sheet เติมตุ๊กตาอย่างเดียว (โหลดคลัง→ตู้ · ไม่ต้องทำรอบเก็บเงินเต็ม)
  onRefillOnly: (m: AppMachine) => void;
  // ดีไซน์ใหม่ · CTA "ตั้งค่าตู้ใหม่ (ครั้งแรก)" บนหน้าหลัก → เปิด BaselineForm ให้ตู้ที่รอตั้งค่า
  onSetup: () => void;
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
  // F1 · คลังตอนนี้ต่อสินค้า · F2 · ประวัติรับแล้ว · F3 · ประวัติใบนับ — แยกตาม branchId
  onHandByBranch: Record<string, Record<string, number>>;
  receivedByBranch: Record<string, CfReceivedDoc[]>;
  countsByBranch: Record<string, CfCountRow[]>;
}) {
  const { userName, panel, setPanel, routeTotal, routeDone, routePct, machines, drafts, draftList, onOpen, onChange, onSetup, inMachineByMachine, pending, openingId, skippedIds, assignedOnly } = props;
  // N3/N6 · สาขาของพนักงาน (ตู้ตัวแรกในรายการ) → ใช้เลือกสินค้าคลัง/ใบรับของสาขานั้น.
  // route ถูกกรองเป็นสาขาเดียวของพนักงานอยู่แล้ว (assignedOnly/single-branch) → ใช้ branchId ตู้แรก.
  const primaryBranchId = machines.find((m) => !isDemo(m.id))?.branchId ?? "";
  const stockProducts = props.branchProducts[primaryBranchId] ?? [];
  const stockWarehouses = props.warehousesByBranch[primaryBranchId] ?? []; // WAVE-3b · N3 picker "นับคลัง"
  const inboundDeliveries = props.inboundByBranch[primaryBranchId] ?? [];
  // F1 · คลังตอนนี้ต่อสินค้าของสาขานี้ · F2 · ประวัติรับแล้วของสาขานี้ (ส่งเข้าหน้ารับสินค้า)
  const onHandByProduct = props.onHandByBranch[primaryBranchId] ?? {};
  const receivedDocs = props.receivedByBranch[primaryBranchId] ?? [];
  // F3 · ประวัติใบนับของสาขานี้ (ส่งเข้าหน้านับสต๊อก → แท็บ "ประวัติใบนับ")
  const countDocs = props.countsByBranch[primaryBranchId] ?? [];
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
  // ดีไซน์ใหม่ · วันที่ไทยย่อ (มุมขวาหัวสีม่วง) + ชื่อสาขา (ถ้าหลายสาขา = "N สาขา")
  const todayLabel = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  const branchLabel = branchGroups.length === 1 ? branchGroups[0][0] : `${branchGroups.length} สาขา`;
  // "วันนี้" เวลาไทย (จาก server กัน tz drift · fallback client clock ถ้าไม่ส่ง)
  const todayYmd = props.todayYmd ?? clientTodayBangkokYmd();
  // 🔴 FIX (CEO 2026-07-19) · ตู้ "เก็บแล้ววันนี้" = รอบ COLLECTION ที่ date === วันนี้เท่านั้น
  //   เดิมวน history ทั้ง 45 วัน ไม่กรองวัน → ตู้ที่เก็บเมื่อวาน/40 วันก่อนขึ้น "เก็บแล้ว" ค้าง → พนักงานข้ามเก็บ = เงินตกหล่น.
  const doneCodesToday = useMemo(() => {
    const set = new Set<string>();
    for (const h of props.history) {
      if (h.date !== todayYmd) continue; // ← กรองเฉพาะวันนี้ (ข้ามวัน = รีเซ็ตเป็น "รอเก็บ" เก็บใหม่ได้)
      if (!h.isBaseline && (h.eventType === "COLLECTION" || h.eventType === undefined)) set.add(h.code);
    }
    return set;
  }, [props.history, todayYmd]);
  // CEO 2026-07-19 · "ดูใบ" ต้องเปิดใบรอบนั้นเลย (ไม่เด้งเข้า list) → เก็บ row ที่จะเปิด detail ค้างไว้
  //   ส่งต่อให้ HistoryPanel เปิด detail อัตโนมัติเมื่อสลับเข้าแท็บประวัติ.
  const [historyFocus, setHistoryFocus] = useState<StaffHistoryRow | null>(null);
  // เปิดใบ "รอบเก็บล่าสุดวันนี้" ของตู้ code นี้ (มี eventId · ไม่ใช่ swap/baseline) — history เรียงใหม่→เก่าแล้ว
  const openDocFor = (code: string) => {
    const row = props.history.find(
      (h) => h.code === code && h.date === todayYmd && !h.isBaseline && (h.eventType === "COLLECTION" || h.eventType === undefined),
    );
    if (row) { setHistoryFocus(row); props.setPanel("history"); }
    else props.setPanel("history"); // fallback: ไม่เจอ row → เปิด list เฉย ๆ (ไม่ค้าง)
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {panel === null ? (
        <>
          {/* ── indigo header · ทักทาย + ความคืบหน้ารอบ (ดีไซน์ใหม่) ── */}
          <div style={{ flex: "0 0 auto", padding: "10px 20px 20px", background: "linear-gradient(160deg,#4F46E5,#5B4FE8)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700, color: "#fff" }}>{avatarChar}</div>
              <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#C9C7F6" }}>{greet}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
              </div>
              <div style={{ textAlign: "right", color: "#fff", flex: "0 0 auto" }}>
                <div className="num" style={{ fontSize: 12, color: "#C9C7F6" }}>{todayLabel}</div>
                <div style={{ fontSize: 12, fontWeight: 600, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branchLabel}</div>
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.13)", borderRadius: 16, padding: "15px 17px", marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "#E4E3FB", fontWeight: 600 }}>รอบเก็บเงินวันนี้</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>{routeDone}/{routeTotal} ตู้</span>
              </div>
              <div style={{ height: 8, background: "rgba(255,255,255,0.22)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${routePct}%`, background: "#fff", borderRadius: 6 }} />
              </div>
            </div>
          </div>

          {/* ── scroll body ── */}
          <div className="scr" style={{ flex: 1, overflowY: "auto", padding: "16px 18px 24px" }}>
            {/* quick actions · 4 การ์ดสี (ดีไซน์ใหม่) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9, marginBottom: 18 }}>
              {([
                { key: "history" as const, label: "ประวัติเก็บ", bg: "#EEF0FE", color: "#4F46E5", d: ["M12 8v4l3 2", "M3.05 11a9 9 0 1 1 .5 4", "M3 3v5h5"] },
                { key: "repair" as const, label: "แจ้งซ่อม", bg: "#FCF1E2", color: "#B45309", d: ["M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2-2 2.7-2.7z"] },
                { key: "stock" as const, label: "นับสต๊อก", bg: "#E7F4EC", color: "#15803D", d: ["M20 7 12 3 4 7v10l8 4 8-4z", "M4 7l8 4 8-4M12 11v10"] },
                { key: "receive" as const, label: "รับสินค้า", bg: "#EAF1FB", color: "#2563C9", d: ["M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.3 7 12 12l8.7-5M12 22V12"] },
              ]).map((a) => (
                <button key={a.key} type="button" onClick={() => setPanel(a.key)} className="co-tap co-lift"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minHeight: 74, background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "12px 4px", cursor: "pointer" }}>
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: a.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={a.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {a.d.map((dd, i) => (<path key={i} d={dd} />))}
                    </svg>
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "#454B54", textAlign: "center", lineHeight: 1.2 }}>{a.label}</span>
                </button>
              ))}
            </div>

            {/* setup CTA · ตั้งค่าตู้ใหม่ (ครั้งแรก) (ดีไซน์ใหม่ · แทนปุ่มทัวร์เดิม) */}
            <button type="button" onClick={onSetup} className="co-tap co-lift"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", border: "1px solid #E3E6EA", cursor: "pointer", background: "#fff", borderRadius: 14, padding: "13px 15px", marginBottom: 18 }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, background: "#EEF0FE", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 40px" }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.9"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg>
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>ตั้งค่าตู้ใหม่ (ครั้งแรก)</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#9AA1AB" }}>ตั้งชื่อตู้ · เพิ่มสินค้า · ราคา · มิเตอร์</span>
              </span>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#C2C7CF" strokeWidth="2.4"><path d="M9 18l6-6-6-6" /></svg>
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
                    const isAwaiting = m.awaitingSetup;
                    const dolls = inMachineByMachine[m.id] ?? [];
                    // เก็บแล้ววันนี้ (จาก history) → ป้าย "เก็บแล้ว" + ปุ่ม "ดูใบ" (ดีไซน์ใหม่)
                    const isDone = !isDraft && !isSkipped && !isAwaiting && doneCodesToday.has(m.code);
                    const st = isSkipped
                      ? { tag: "แจ้งซ่อมแล้ว", tagC: "#B42318", tagBg: "#FCEDEC", badgeBg: "#FCEDEC", badgeC: "#B42318", border: "#F3D4D0", dot: "#D8503F", hint: "ตู้เสีย · แจ้งซ่อม & ข้ามในรอบนี้" }
                      : isAwaiting
                        ? { tag: "ตั้งค่าครั้งแรก", tagC: "#5A6270", tagBg: "#F1F2F7", badgeBg: "#F1F2F7", badgeC: "#5A6270", border: "#E1E3E9", dot: "#A9AEB8", hint: "ตู้ใหม่ · แตะเพื่อบันทึกยอดตั้งต้น" }
                        : isDraft
                          ? { tag: "ค้างมิเตอร์", tagC: "#B45309", tagBg: "#FCF1E2", badgeBg: "#FCF1E2", badgeC: "#B45309", border: "#F0E2BE", dot: "#E8A33D", hint: "ถ่ายรูป+นับแล้ว · รอกรอกเลขมิเตอร์" }
                          : isDone
                            ? { tag: "เก็บแล้ว", tagC: "#15803D", tagBg: "#E7F4EC", badgeBg: "#F1F2F5", badgeC: "#9AA1AB", border: "#E8EAED", dot: "#15803D", hint: "เก็บเงินแล้ววันนี้" }
                            : { tag: "รอเก็บ", tagC: "#4F46E5", tagBg: "#EEF0FE", badgeBg: "#EEF0FE", badgeC: "#4F46E5", border: "#DADBF8", dot: "#4F46E5", hint: "แตะเพื่อเริ่มเก็บเงิน" };
                    const dimmed = pending && !isOpening;
                    const title = m.nickname?.trim() || m.branch;
                    return (
                      <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: dimmed ? 0.5 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: `1px solid ${isOpening ? "#C7C3F0" : st.border}`, borderRadius: 13, padding: "9px 10px" }}>
                          <span style={{ position: "relative", flex: "0 0 38px" }}>
                            <span className="num" style={{ width: 38, height: 38, borderRadius: 10, background: st.badgeBg, color: st.badgeC, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.code}</span>
                            <span style={{ position: "absolute", top: -2, right: -2, width: 11, height: 11, borderRadius: "50%", background: st.dot, border: "2px solid #fff" }} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                            <div style={{ fontSize: 10.5, color: "#9AA1AB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isOpening ? "กำลังเปิดรอบ…" : `${m.branch} · ${m.zone}`}</div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: st.tagBg, color: st.tagC, whiteSpace: "nowrap" }}>{st.tag}</span>
                          {isOpening ? (
                            <span style={{ width: 52, flex: "0 0 52px", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#4F46E5" /></span>
                          ) : isSkipped ? null : isAwaiting ? (
                            <RowActionBtn onClick={() => onOpen(m)} disabled={pending} bg="#4F46E5" color="#fff" label="ตั้งค่า"
                              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg>} />
                          ) : isDraft ? (
                            <RowActionBtn onClick={() => onOpen(m)} disabled={pending} bg="#FCF1E2" color="#B45309" label="กรอกต่อ"
                              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>} />
                          ) : isDone ? (
                            // CEO 2026-07-19 · เก็บแล้ววันนี้ → "ดูใบ" (เปิดใบรอบนั้นเลย) + "เก็บซ้ำ" (เก็บได้หลายรอบ/วัน)
                            <>
                              <RowActionBtn onClick={() => openDocFor(m.code)} bg="#E7F4EC" color="#15803D" label="ดูใบ"
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.5" /></svg>} />
                              <RowActionBtn onClick={() => onOpen(m)} disabled={pending} bg="#EEF0FE" color="#4F46E5" label="เก็บซ้ำ"
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.2"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>} />
                            </>
                          ) : (
                            <>
                              <RowActionBtn onClick={() => onOpen(m)} disabled={pending} bg="#4F46E5" color="#fff" label="เก็บเงิน"
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="2" y="7" width="20" height="12" rx="2" /><path d="M2 11h20M7 15h4" /></svg>} />
                              <RowActionBtn onClick={() => onChange(m)} disabled={pending} bg="#EEF0FE" color="#4F46E5" label="เปลี่ยน/เติม"
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.2"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>} />
                            </>
                          )}
                        </div>
                        {/* item 8 · "ตอนนี้ในตู้" — chips ราย SKU จาก server ledger · display-only */}
                        <InMachineStrip dolls={dolls} isSkipped={isSkipped} isAwaiting={isAwaiting} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          </div>
        </>
      ) : (
        <PanelScreen panel={panel} onBack={() => { setPanel(null); setHistoryFocus(null); }} tourStep={props.tourStep} setTourStep={props.setTourStep} skus={props.skus} history={props.history} viewDate={props.viewDate} usingDemo={props.usingDemo} orgId={props.orgId} repairMachines={props.repairMachines} myRecentTickets={props.myRecentTickets} branchId={primaryBranchId} branchCode={machines.find((m) => m.branchId === primaryBranchId)?.code ?? ""} stockProducts={stockProducts} stockWarehouses={stockWarehouses} inboundDeliveries={inboundDeliveries} onHandByProduct={onHandByProduct} receivedDocs={receivedDocs} countDocs={countDocs} historyFocus={historyFocus} onHistoryFocusConsumed={() => setHistoryFocus(null)} />
      )}
    </div>
  );
}

/* ดีไซน์ใหม่ · ปุ่มลัดในแถวตู้ (52px · ไอคอน+ป้าย) — เก็บเงิน/เปลี่ยน-เติม/ตั้งค่า/กรอกต่อ/ดูใบ */
function RowActionBtn({ onClick, disabled, bg, color, label, icon }: {
  onClick: () => void; disabled?: boolean; bg: string; color: string; label: string; icon: React.ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={disabled ? "" : "co-tap"}
      style={{ width: 52, flex: "0 0 52px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "6px 2px", borderRadius: 10, border: "none", background: bg, cursor: disabled ? "wait" : "pointer" }}>
      {icon}
      <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1, color }}>{label}</span>
    </button>
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
  // F3 · ประวัติใบนับ (แท็บ "ประวัติใบนับ" ในหน้านับสต๊อก)
  countDocs: CfCountRow[];
  // CEO 2026-07-19 · "ดูใบ" จากหน้าหลัก → เปิด detail รอบนี้อัตโนมัติในแท็บประวัติ (null = ไม่เจาะจง)
  historyFocus?: StaffHistoryRow | null;
  onHistoryFocusConsumed?: () => void;
}) {
  const { panel, onBack } = props;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* header — แถบขาว back + ชื่อ (ดีไซน์ใหม่ · panel chrome) */}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: "1px solid #EAECEF", background: "#fff" }}>
        <button type="button" onClick={onBack} className="co-tap" style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{PANEL_TITLE[panel]}</span>
      </div>
      {/* scroll body */}
      <div className="scr" style={{ flex: 1, overflowY: "auto", padding: "14px 18px 24px" }}>
        {panel === "history" && <HistoryPanel history={props.history} usingDemo={props.usingDemo} orgId={props.orgId} initialFocus={props.historyFocus ?? null} onFocusConsumed={props.onHistoryFocusConsumed} />}
        {panel === "repair" && <RepairPanel orgId={props.orgId} machines={props.repairMachines} usingDemo={props.usingDemo} myRecentTickets={props.myRecentTickets} />}
        {panel === "stock" && <StockCountPanel orgId={props.orgId} usingDemo={props.usingDemo} branchId={props.branchId} branchCode={props.branchCode} products={props.stockProducts} warehouses={props.stockWarehouses} countDocs={props.countDocs} />}
        {panel === "receive" && <GoodsReceivePanel orgId={props.orgId} usingDemo={props.usingDemo} branchCode={props.branchCode} deliveries={props.inboundDeliveries} onHandByProduct={props.onHandByProduct} receivedDocs={props.receivedDocs} />}
        {panel === "config" && <ConfigPanel />}
        {panel === "tour" && <TourPanel tourStep={props.tourStep} setTourStep={props.setTourStep} />}
      </div>
    </div>
  );
}

/* ─────────────────── N1 · หน้าจอ "ตั้งค่าครั้งแรก" (แทน 6-step wizard สำหรับตู้ AWAITING_SETUP) ─────────────────── */
function BaselineScreen({ machine, orgId, products, branchStock = [], netById = {}, onBack, onDone }: {
  machine: AppMachine; orgId: string; products: { id: string; name: string; imageUrl: string | null }[];
  // ของในคลังสาขา (ยังไม่อยู่ตู้นี้ · เช่น เพิ่งรับจากใบโอน) → picker "เลือกจากคลัง" ใน AddProductSheet
  branchStock?: BranchStockProduct[];
  // NET ว่างจริงบนชั้น ต่อ productId (= เลขที่ server enforce ตอน refill)
  netById?: Record<string, number>;
  onBack: () => void; onDone: () => void;
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
          // ★ ส่ง NET (ว่างจริงบนชั้น) เป็นตัวเลขที่จอโชว์/แคป — ไม่ใช่ GROSS warehouse (จอ = server)
          branchStock={branchStock.map((p) => ({ id: p.id, name: p.name, sku: p.sku, imageUrl: p.imageUrl, warehouse: netById[p.id] ?? 0 }))}
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
// CEO 2026-07-18 · ป้ายชนิดรายการในประวัติ (เก็บเงิน / เปลี่ยนตุ๊กตา / ตั้งค่าครั้งแรก)
// มิเตอร์ 1 ประเภท ในหน้า detail — โชว์ รอบก่อน→รอบนี้ (+delta) + กายภาพ บน/ล่าง
//   ⚠️ ใช้ `!= null` ทุกจุด (มิเตอร์ = 0 เป็นค่าจริง ห้าม truthy) — QA/BE/FIN จับ
function MeterDetailRow({ label, before, after, top, bottom }: {
  label: string; before?: number; after?: number; top?: number; bottom?: number;
}) {
  const n = (v: number) => v.toLocaleString("en-US");
  const hasBoth = before != null && after != null;
  const delta = hasBoth ? Math.max(0, (after as number) - (before as number)) : null;
  const hasPhysical = top != null || bottom != null;
  if (after == null && !hasPhysical) return null; // ไม่มีข้อมูลมิเตอร์เลย → ไม่โชว์
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#9AA1AB", flex: "0 0 auto" }}>{label}</span>
        {hasBoth ? (
          <span style={{ fontSize: 12, color: "#5A6270" }}>
            <span className="num">{n(before as number)}</span> → <b className="num" style={{ color: "#1A1D21" }}>{n(after as number)}</b>
            {delta != null && <b className="num" style={{ color: "#15803D", marginLeft: 6 }}>(+{n(delta)})</b>}
          </span>
        ) : after != null ? (
          <b className="num" style={{ fontSize: 12.5, color: "#1A1D21" }}>{n(after)}</b>
        ) : null}
      </div>
      {hasPhysical && (
        <div style={{ fontSize: 10.5, color: "#9AA1AB", paddingLeft: 2 }}>
          กายภาพ: บน <span className="num" style={{ color: "#5A6270" }}>{top != null ? n(top) : "—"}</span> · ล่าง <span className="num" style={{ color: "#5A6270" }}>{bottom != null ? n(bottom) : "—"}</span>
        </div>
      )}
    </div>
  );
}

function historyKindTag(h: StaffHistoryRow): { label: string; c: string; bg: string } {
  const kind = h.kind ?? (h.isBaseline ? "baseline" : "collect");
  if (kind === "swap") return { label: "เปลี่ยนตุ๊กตา", c: "#4F46E5", bg: "#EEF0FE" };
  if (kind === "baseline") return { label: "ตั้งค่าครั้งแรก", c: "#B45309", bg: "#FCF1E2" };
  return { label: "เก็บเงิน", c: "#15803D", bg: "#E7F4EC" };
}

function HistoryPanel({ history, usingDemo, orgId, initialFocus = null, onFocusConsumed }: { history: StaffHistoryRow[]; usingDemo: boolean; orgId: string; initialFocus?: StaffHistoryRow | null; onFocusConsumed?: () => void }) {
  const todayYmd = clientTodayBangkokYmd();
  // โหมดตัวอย่าง (ยังไม่มีข้อมูลจริง) → โชว์ตัวอย่างแต่ติดป้ายชัดว่าเป็นตัวอย่าง (ไม่หลอกว่าเป็นของจริง)
  const demoRows: StaffHistoryRow[] = [
    { kind: "collect", code: "RS-03", branch: "รังสิต", date: todayYmd, time: "14:20", cashBaht: 300, coinMeter: 210, dollsOut: 3, stockBefore: 10, stockAfter: 7, ok: true, photos: [] },
    { kind: "swap", code: "LP-01", branch: "ลาดพร้าว", date: todayYmd, time: "13:50", cashBaht: 0, swapReturned: 2, swapRefilled: 5, ok: true },
    { kind: "collect", code: "RS-07", branch: "รังสิต", date: shiftYmd(todayYmd, -1), time: "12:10", cashBaht: 540, coinMeter: 302, dollsOut: 4, ok: false },
  ];
  const rows = usingDemo ? demoRows : history;

  // item 5 · แถวที่กำลังเปิด sheet "แนบรูปเพิ่ม" + set ของ eventId ที่แนบครบแล้ว (เคลียร์ป้ายทันที)
  const [attachRow, setAttachRow] = useState<StaffHistoryRow | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  // CEO 2026-07-18 · กดแถว → เปิด detail (สรุปหน้าเดียว + ดูรูปขยาย) · รูปที่กำลังขยาย (lightbox)
  const [detail, setDetail] = useState<StaffHistoryRow | null>(initialFocus);
  const [zoom, setZoom] = useState<{ url: string; label: string } | null>(null);
  // CEO 2026-07-19 · "ดูใบ" จากหน้าหลัก → เปิด detail ใบนั้นทันทีเมื่อ mount/เปลี่ยน focus (แล้ว clear ที่ parent)
  useEffect(() => {
    if (initialFocus) { setDetail(initialFocus); onFocusConsumed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocus]);

  // จัดกลุ่มตามวัน (รายการเรียงใหม่→เก่าอยู่แล้ว) → หัววัน + การ์ด
  const groups: { date: string; label: string; items: StaffHistoryRow[] }[] = [];
  for (const h of rows) {
    const d = h.date ?? todayYmd;
    let g = groups.find((x) => x.date === d);
    if (!g) { g = { date: d, label: ymdLabelThai(d, todayYmd), items: [] }; groups.push(g); }
    g.items.push(h);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {usingDemo && (
        <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — รายการจริงจะขึ้นเมื่อเก็บเงินผ่านระบบ" />
      )}

      {!usingDemo && rows.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
          <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="ยังไม่มีประวัติการเก็บ"
            sub="เมื่อคุณเก็บเงิน / เปลี่ยนตุ๊กตาจบตู้ รายการจะขึ้นที่นี่ (ย้อนหลัง 45 วัน)" />
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#9AA1AB", padding: "0 2px" }}>{g.label}</div>
            {g.items.map((h, i) => {
              const tag = historyKindTag(h);
              const isSwap = (h.kind ?? "collect") === "swap";
              const stillMissing = !!h.photosMissing && !(h.eventId && resolvedIds.has(h.eventId));
              return (
                <button key={`${h.code}-${h.time}-${i}`} type="button" onClick={() => setDetail(h)} className="co-tap"
                  style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", flex: "0 0 auto" }}>{h.nickname || h.code}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tag.bg, color: tag.c }}>{tag.label}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10.5, color: "#9AA1AB" }} className="num">{h.time}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#5A6270", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isSwap
                        ? `${h.swapReturned ? `คืน ${h.swapReturned} ` : ""}${h.swapRefilled ? `เติม ${h.swapRefilled} ` : ""}ตัว`.trim()
                        : <>เก็บได้ <b className="num" style={{ color: "#15803D" }}>฿{h.cashBaht.toLocaleString("en-US")}</b>{h.dollsOut != null ? <> · ตุ๊กตาออก <span className="num">{h.dollsOut}</span></> : null}</>}
                      {h.branch ? <span style={{ color: "#B6BBC4" }}> · {h.branch}</span> : null}
                    </span>
                    {stillMissing && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#FCF1E2", color: "#B45309", whiteSpace: "nowrap" }}>รูปยังไม่ครบ</span>
                    )}
                    {!isSwap && !h.isBaseline && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: h.ok ? "#E7F4EC" : "#FCEDEC", color: h.ok ? "#15803D" : "#B42318" }}>{h.ok ? "ตรง" : "ไม่ตรง"}</span>
                    )}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C2C7CF" strokeWidth="2.4" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
                  </div>
                </button>
              );
            })}
          </div>
        ))
      )}

      {/* CEO 2026-07-18 · detail รอบเดียว — สรุปหน้าเดียว + ดูรูปขยาย + แนบรูปเพิ่ม (แก้ไข = แนบรูปอย่างเดียว) */}
      {detail && (
        <div role="dialog" aria-modal="true" onClick={() => setDetail(null)}
          style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(20,22,28,0.5)", display: "flex", alignItems: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "88%", overflowY: "auto", background: "#F4F5F7", borderRadius: "20px 20px 0 0", padding: "16px 18px 24px" }}>
            <div style={{ width: 40, height: 4, borderRadius: 4, background: "#D8DCE2", margin: "0 auto 14px" }} />
            {(() => {
              const tag = historyKindTag(detail);
              const isSwap = (detail.kind ?? "collect") === "swap";
              const dayLabel = ymdLabelThai(detail.date ?? todayYmd, todayYmd);
              const stillMissing = !!detail.photosMissing && !(detail.eventId && resolvedIds.has(detail.eventId));
              const canAttach = !usingDemo && !!detail.eventId && !isSwap;
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{detail.nickname || detail.code}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: tag.bg, color: tag.c }}>{tag.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#9AA1AB", marginBottom: 14 }}>{detail.branch ? `${detail.branch} · ` : ""}{dayLabel} · {detail.time}</div>

                  {/* สรุปตัวเลข */}
                  <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "14px 16px", marginBottom: 12 }}>
                    {isSwap ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px 12px" }}>
                        <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>คืนเข้าสโตร์</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#C0392B" }}>{detail.swapReturned ?? 0} ตัว</div></div>
                        <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>เติมเข้าตู้</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#15803D" }}>+{detail.swapRefilled ?? 0} ตัว</div></div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px 12px" }}>
                          <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>เก็บได้จริง</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#15803D" }}>฿{detail.cashBaht.toLocaleString("en-US")}</div></div>
                          <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ตุ๊กตาออกไป</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#4F46E5" }}>{detail.dollsOut ?? "—"} ตัว</div></div>
                          {detail.stockBefore != null && <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>รอบก่อนมี</div><div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{detail.stockBefore} ตัว</div></div>}
                          {detail.stockAfter != null && <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ตอนนี้ในตู้</div><div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{detail.stockAfter} ตัว</div></div>}
                        </div>
                        {/* #1 CEO 2026-07-19 · เทียบเงินจริง: ควรได้ (จากมิเตอร์) vs นับได้ → ขาด/เกิน (เลข reconcile จาก server) */}
                        {detail.expectedCashBaht != null && (
                          <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: detail.ok ? "#F0FAF3" : "#FEF3F2", border: `1px solid ${detail.ok ? "#CDEBD7" : "#F3D4D0"}`, borderRadius: 10, padding: "9px 12px" }}>
                            <span style={{ fontSize: 11, color: "#6B7280" }}>ควรได้ (มิเตอร์) <b className="num" style={{ color: "#1A1D21" }}>฿{detail.expectedCashBaht.toLocaleString("en-US")}</b></span>
                            <span style={{ fontSize: 11, color: "#6B7280" }}>· นับได้ <b className="num" style={{ color: "#1A1D21" }}>฿{detail.cashBaht.toLocaleString("en-US")}</b></span>
                            <span style={{ flex: 1 }} />
                            {detail.cashDiffBaht != null && detail.cashDiffBaht !== 0 ? (
                              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: detail.cashDiffBaht < 0 ? "#B42318" : "#B45309" }}>
                                {detail.cashDiffBaht < 0 ? `ขาด ฿${Math.abs(detail.cashDiffBaht).toLocaleString("en-US")}` : `เกิน ฿${detail.cashDiffBaht.toLocaleString("en-US")}`}
                              </span>
                            ) : (
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#15803D" }}>ตรงพอดี</span>
                            )}
                          </div>
                        )}
                        {/* มิเตอร์ (CEO 2026-07-19) · เห็น บน/ล่าง + รอบก่อน→รอบนี้ (+delta = ยอดจริง) + เติม */}
                        <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid #F0F1F4", display: "flex", flexDirection: "column", gap: 9 }}>
                          <MeterDetailRow label="มิเตอร์เหรียญ" before={detail.coinMeterBefore} after={detail.coinMeter} top={detail.meterMoneyTop} bottom={detail.meterMoneyBottom} />
                          <MeterDetailRow label="มิเตอร์ตุ๊กตา" after={detail.dollMeter} top={detail.meterDollTop} bottom={detail.meterDollBottom} />
                          {detail.refillQty != null && detail.refillQty > 0 && (
                            <div style={{ fontSize: 11.5, color: "#6B7280" }}>เติมเข้าตู้รอบนี้ <b className="num" style={{ color: "#15803D" }}>+{detail.refillQty.toLocaleString("en-US")}</b> ตัว</div>
                          )}
                        </div>
                        {detail.shortReason && (
                          <div style={{ marginTop: 10, background: "#FCF6EC", border: "1px solid #F0D9A8", borderRadius: 10, padding: "8px 11px", fontSize: 11.5, color: "#8A5A12" }}>หมายเหตุ: {detail.shortReason}</div>
                        )}
                      </>
                    )}
                  </div>

                  {/* รูปหลักฐาน — กดขยายได้ (CEO: ดูรูปขยาย · ให้ครบ) */}
                  {!isSwap && (
                    <>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 8 }}>รูปหลักฐาน {detail.photos && detail.photos.length > 0 ? `(${detail.photos.length})` : ""}</div>
                      {detail.photos && detail.photos.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                          {detail.photos.map((ph) => (
                            <button key={ph.url} type="button" onClick={() => setZoom(ph)} className="co-tap"
                              style={{ border: "1px solid #E3E6EA", borderRadius: 10, overflow: "hidden", padding: 0, cursor: "pointer", background: "#fff" }}>
                              <img src={ph.url} alt={ph.label} style={{ width: "100%", height: 82, objectFit: "cover", display: "block" }} />
                              <div style={{ fontSize: 9.5, color: "#6B7280", padding: "4px 5px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ph.label}</div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 11, padding: "14px 12px", fontSize: 12, color: "#9AA1AB", textAlign: "center", marginBottom: 12 }}>รอบนี้ยังไม่มีรูปหลักฐาน</div>
                      )}
                      {canAttach && (
                        <button type="button" onClick={() => { setAttachRow(detail); setDetail(null); }} className="co-tap"
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "12px", borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${stillMissing ? "#F0D8AE" : "#C7C3F0"}`, background: stillMissing ? "#FFFBF3" : "#F5F5FE", color: stillMissing ? "#B45309" : "#4338CA" }}>
                          <Camera size={16} strokeWidth={2.2} />
                          {stillMissing ? "แนบรูปที่ยังขาด" : "แนบรูปเพิ่ม / ถ่ายใหม่"}
                        </button>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* lightbox ดูรูปขยายเต็มจอ */}
      {zoom && (
        <div onClick={() => setZoom(null)} className="co-tap" style={{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(10,12,16,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{zoom.label}</div>
          <img src={zoom.url} alt={zoom.label} style={{ maxWidth: "100%", maxHeight: "78%", objectFit: "contain", borderRadius: 12 }} />
          <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 12 }}>แตะที่ไหนก็ได้เพื่อปิด</div>
        </div>
      )}

      {/* item 5 · sheet แนบรูปเพิ่มทีหลัง (ถ่ายรูปที่ขาด → attachEventPhotos → เคลียร์ป้าย) */}
      {attachRow && attachRow.eventId && (
        <AttachPhotosSheet
          orgId={orgId}
          eventId={attachRow.eventId}
          machineCode={attachRow.code}
          isBaseline={attachRow.eventType === "INITIAL" || attachRow.isBaseline === true}
          onClose={() => setAttachRow(null)}
          onResolved={(eventId) => {
            setResolvedIds((prev) => { const n = new Set(prev); n.add(eventId); return n; });
            setAttachRow(null);
          }}
        />
      )}
    </div>
  );
}


/* ─────────────── item 5 · แนบรูปเพิ่มทีหลัง (attach later) ───────────────
 * พนักงานถ่ายรูปหลักฐานไม่ทันตอนเก็บ (รีบ/เน็ตตก) → กลับมาแนบเพิ่มจากหน้าประวัติ.
 * ถ่ายช่องที่ขาด (reuse PhotoCaptureButton · upload R2) → เก็บ url ต่อ "คอลัมน์ DB" →
 * กด "บันทึกรูปที่แนบ" → attachEventPhotos (เขียนเฉพาะคอลัมน์ที่ยังว่าง · idempotent).
 * รูปเงินสดไม่แสดง (optional · ไม่นับใน "ครบ/ไม่ครบ"). */
// phase = ป้ายจัดหมวด upload R2 (subset ของ union ใน PhotoCaptureButton) — ตรงกับ slot ที่ใช้แนบ
type AttachPhase =
  | "meter_after" | "prize_meter" | "stock" | "stock_after"
  | "money_meter_top" | "money_meter_bottom" | "doll_meter_top" | "doll_meter_bottom"
  | "machine" | "baseline_stock";
type AttachSlot = {
  col: string; // คอลัมน์ DB ที่ attachEventPhotos จะเขียน
  label: string;
  phase: AttachPhase;
};
// COLLECTION — 4 รูปหลักฐาน (มิเตอร์เหรียญ/ตุ๊กตา/สต็อกก่อน/สต็อกหลัง)
const ATTACH_SLOTS_COLLECTION: AttachSlot[] = [
  { col: "photoMeterAfterUrl", label: "มิเตอร์เหรียญ", phase: "meter_after" },
  { col: "photoPrizeMeterUrl", label: "มิเตอร์ตุ๊กตา", phase: "prize_meter" },
  { col: "photoStockUrl", label: "สต็อกก่อนเติม", phase: "stock" },
  { col: "photoMeterBeforeUrl", label: "สต็อกหลังเติม", phase: "stock_after" },
];
// INITIAL/baseline — 4 มิเตอร์กายภาพ + รูปตู้ + สต็อกตั้งต้น
const ATTACH_SLOTS_BASELINE: AttachSlot[] = [
  { col: "photoMoneyMeterTopUrl", label: "มิเตอร์เงิน (บน)", phase: "money_meter_top" },
  { col: "photoMoneyMeterBottomUrl", label: "มิเตอร์เงิน (ล่าง)", phase: "money_meter_bottom" },
  { col: "photoDollMeterTopUrl", label: "มิเตอร์ตุ๊กตา (บน)", phase: "doll_meter_top" },
  { col: "photoDollMeterBottomUrl", label: "มิเตอร์ตุ๊กตา (ล่าง)", phase: "doll_meter_bottom" },
  { col: "photoMachineUrl", label: "รูปตู้", phase: "machine" },
  { col: "photoStockUrl", label: "สต็อกตั้งต้น", phase: "baseline_stock" },
];

function AttachPhotosSheet({ orgId, eventId, machineCode, isBaseline, onClose, onResolved }: {
  orgId: string; eventId: string; machineCode: string; isBaseline: boolean;
  onClose: () => void; onResolved: (eventId: string) => void;
}) {
  const slots = isBaseline ? ATTACH_SLOTS_BASELINE : ATTACH_SLOTS_COLLECTION;
  // url ที่ถ่ายได้ ต่อคอลัมน์ (ว่าง = ยังไม่ถ่าย). eventScopeId ผูกกับ event เดิม (upload key ไม่ชนรอบใหม่)
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const eventScopeId = `attach-${eventId}`;
  const capturedCount = Object.values(urls).filter(Boolean).length;

  function save() {
    // เก็บเฉพาะ url จริง (ถ่ายแล้ว upload เสร็จ) — ยังไม่มีเลย → เตือนให้ถ่ายก่อน
    const photos: Record<string, string> = {};
    for (const s of slots) if (urls[s.col]) photos[s.col] = urls[s.col];
    if (Object.keys(photos).length === 0) {
      setError("ยังไม่มีรูปที่ถ่าย · ถ่ายอย่างน้อย 1 รูปก่อนบันทึก");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await attachEventPhotos({ eventId, photos });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // ครบแล้ว (ไม่ขาดรูป) → เคลียร์ป้ายในลิสต์ · ยังขาดอยู่ → ปิด sheet เฉย ๆ (แนบได้บางส่วน)
        if (!res.data.photosMissing) {
          onResolved(eventId);
        } else {
          onClose();
        }
      } catch {
        // action reject จริง (เน็ต/เซิร์ฟล่ม) — ต่างจาก business error ด้านบน
        setError("บันทึกไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,22,28,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: "18px 18px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#FCF1E2", color: "#B45309", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Camera size={19} strokeWidth={2.1} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>แนบรูปเพิ่ม · ตู้ {machineCode}</div>
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>ถ่ายรูปหลักฐานที่ยังขาด แล้วกดบันทึก (ตัวเลขที่ส่งไปแล้วไม่เปลี่ยน)</div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 9, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={17} strokeWidth={2.2} color="#454B54" />
          </button>
        </div>

        {error && (
          <div style={{ margin: "10px 0 0", background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 10, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0 4px" }}>
          {slots.map((s) => (
            <PhotoCaptureButton
              key={s.col}
              label={s.label}
              value={urls[s.col] ?? ""}
              onChange={(url) => setUrls((p) => ({ ...p, [s.col]: url }))}
              orgId={orgId}
              machineCode={machineCode}
              eventScopeId={eventScopeId}
              phase={s.phase}
            />
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: "#9AA1AB", margin: "8px 0 14px" }}>ถ่ายช่องไหนก่อนก็ได้ · ช่องที่มีรูปอยู่แล้วในระบบจะไม่ถูกทับ</div>

        <button type="button" onClick={save} disabled={pending || capturedCount === 0} className={pending || capturedCount === 0 ? "" : "co-tap"}
          style={{ width: "100%", minHeight: 48, fontSize: 15, fontWeight: 700, color: "#fff", border: "none", borderRadius: 12, cursor: pending || capturedCount === 0 ? "not-allowed" : "pointer", background: "#B45309", opacity: pending || capturedCount === 0 ? 0.55 : 1 }}>
          {pending ? "กำลังบันทึก…" : capturedCount === 0 ? "ถ่ายรูปก่อน" : `บันทึกรูปที่แนบ (${capturedCount})`}
        </button>
      </div>
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
            {/* mockup PANEL-repair: เลือกตู้เป็นการ์ดแตะ (ไม่ใช่ dropdown) — เห็นทุกตู้ในแวบเดียว */}
            <label style={lbl}>เลือกตู้ที่เสีย</label>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
              {realMachines.map((m) => {
                const on = machineId === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setMachineId(m.id)} className="co-tap"
                    style={{ flex: "0 0 auto", minWidth: 96, textAlign: "left", border: `1.5px solid ${on ? "#4F46E5" : "#E8EAED"}`, background: on ? "#F5F5FE" : "#fff", borderRadius: 11, padding: "8px 11px", cursor: "pointer" }}>
                    <span className="num" style={{ display: "block", fontSize: 12, fontWeight: 700, color: on ? "#4F46E5" : "#1A1D21" }}>{m.nickname ?? m.code}</span>
                    <span style={{ display: "block", fontSize: 10, color: "#9AA1AB", marginTop: 1 }}>{m.code}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            {/* mockup: อาการเสียเป็นชิปแตะเร็ว (เลือกแล้ว = ทึบม่วง) */}
            <label style={lbl}>อาการเสีย</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {REPAIR_SYMPTOMS.map((o) => {
                const on = symptom === o;
                return (
                  <button key={o} type="button" onClick={() => setSymptom(o)} className="co-tap"
                    style={{ fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 20, border: `1.5px solid ${on ? "#4F46E5" : "#E3E6EA"}`, background: on ? "#4F46E5" : "#fff", color: on ? "#fff" : "#5A6270", cursor: "pointer" }}>
                    {o}
                  </button>
                );
              })}
            </div>
            {symptom === "อื่นๆ" && (
              <input type="text" value={otherSymptom} onChange={(e) => setOtherSymptom(e.target.value)}
                placeholder="พิมพ์อาการที่พบ…"
                style={{ width: "100%", fontSize: 13.5, padding: "10px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", marginTop: 8 }} />
            )}
          </div>
          <div>
            <label style={lbl}>แนบรูปอาการเสีย (ถ่ายได้-ข้ามได้)</label>
            <PhotoCaptureButton slim
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
function StockCountPanel({ orgId, usingDemo, branchId, branchCode, products, warehouses, countDocs }: {
  orgId: string; usingDemo: boolean; branchId: string; branchCode: string; products: BranchStockProduct[];
  // WAVE-3b · N3 · คลัง active ของสาขานี้ — picker "นับคลัง" โผล่เฉพาะเมื่อ >1 ห้อง (default คลังหลัก).
  warehouses: BranchWarehouse[];
  // F3 · ประวัติใบนับล่าสุดของสาขานี้ (READ-ONLY · แท็บ "ประวัติใบนับ")
  countDocs: CfCountRow[];
}) {
  // F3 · แท็บ "นับใหม่" | "ประวัติใบนับ" — default = นับใหม่ (งานหลัก)
  const [tab, setTab] = useState<"count" | "history">("count");
  // CEO 2026-07-18 · ต้อง "สร้างใบนับ" ก่อน แล้วนับทั้งตู้/คลังรวดเดียว (ให้รู้สึกเป็นเอกสาร ไม่งงว่านับทีละตัวกดส่ง)
  const [sheetStarted, setSheetStarted] = useState(false);
  // CEO 2026-07-18 · แตะรูปสินค้า → ดูขยาย (lightbox)
  const [zoomImg, setZoomImg] = useState<{ url: string; name: string } | null>(null);
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
        setOkMsg("ส่งใบนับให้ผู้จัดการอนุมัติแล้ว · ยอดจะปรับหลังอนุมัติ");
        setCounts({});
        setPhotos({});
        setClientKey(genClientKey()); // ใบใหม่รอบหน้า
        setSheetStarted(false); // ปิดใบ → กลับหน้าเริ่ม (สร้างใบใหม่)
      } catch (e) {
        console.error("[clawos] submitStockCount threw:", e);
        setError("บันทึกไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  // demo → ยังไม่มีข้อมูลจริง (ไม่มีทั้งนับจริง+ประวัติ) → banner เดียว
  if (usingDemo) {
    return <ComingSoonBanner text="กำลังแสดงตัวอย่าง (ยังไม่มีข้อมูลจริง) — นับสต๊อกจริงได้เมื่อมีสินค้าในคลังสาขา" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* F3 · segment control — นับใหม่ | ประวัติใบนับ (N) */}
      <div style={{ display: "flex", gap: 6, background: "#F1F2F5", padding: 4, borderRadius: 12 }}>
        <SegmentBtn active={tab === "count"} onClick={() => setTab("count")} label="นับใหม่" />
        <SegmentBtn active={tab === "history"} onClick={() => setTab("history")} label={`ประวัติใบนับ (${countDocs.length})`} />
      </div>

      {tab === "history" ? (
        <CountHistoryList countDocs={countDocs} />
      ) : products.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
          <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="คลังสาขานี้ยังไม่มีสินค้า" sub="รับสินค้าเข้าคลังก่อน แล้วค่อยนับสต๊อก" />
        </div>
      ) : !sheetStarted ? (
        // CEO 2026-07-18 · หน้าเริ่ม "สร้างใบนับ" — กดก่อน แล้วค่อยนับทั้งคลังรวดเดียว (เหมือนเปิดเอกสารใหม่)
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "18px 16px", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#EEF0FE", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 5 }}>สร้างใบนับสต๊อก</div>
            <div style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.5, marginBottom: 16 }}>เปิดใบใหม่ 1 ใบ แล้วนับ<b>ทั้งคลัง {products.length} รายการรวดเดียว</b> · ส่งจบเป็นใบเดียว ผู้จัดการอนุมัติก่อนปรับยอด</div>
            <button type="button" onClick={() => { setSheetStarted(true); setOkMsg(null); setError(null); }} className="co-tap"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 50, fontSize: 15, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", borderRadius: 13, cursor: "pointer" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
              สร้างใบนับใหม่
            </button>
          </div>
          {okMsg && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#15803D", fontWeight: 600 }}>
              <Check size={15} strokeWidth={2.6} />{okMsg}
            </div>
          )}
          {countDocs.length > 0 && (
            <button type="button" onClick={() => setTab("history")} style={{ fontSize: 12.5, fontWeight: 600, color: "#4F46E5", background: "none", border: "none", cursor: "pointer" }}>
              ดูประวัติใบนับ ({countDocs.length}) →
            </button>
          )}
        </div>
      ) : (
      <>
      {/* หัวใบนับ — บอกว่ากำลังนับทั้งคลัง (เอกสารเดียว) */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#EEF0FE", borderRadius: 11, padding: "10px 13px" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 17px" }}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#4F46E5", lineHeight: 1.4 }}>ใบนับใหม่ · นับให้ครบทั้ง {products.length} รายการ แล้วส่งเป็นใบเดียว</span>
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
          product={{ id: p.id, name: p.name, imageUrl: p.imageUrl, sku: p.sku, defaultPriceCoins: p.defaultPriceCoins }}
          value={counts[p.id] ?? null}
          onChange={(n) => setCounts((c) => ({ ...c, [p.id]: n }))}
          expected={p.warehouse}
          orgId={orgId}
          machineCode={branchCode}
          eventScopeId={`stockcount-${branchId}`}
          photoUrl={photos[p.id] ?? ""}
          onPhoto={(url) => setPhotos((ph) => ({ ...ph, [p.id]: url }))}
          onImageTap={(url, name) => setZoomImg({ url, name })}
        />
      ))}
      <button type="button" onClick={submit} disabled={!canSubmit || pending}
        className={!canSubmit || pending ? "" : "co-tap"}
        style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, color: "#fff", background: !canSubmit ? "#A8AEB8" : "#4F46E5", border: "none", padding: 13, borderRadius: 12, cursor: !canSubmit || pending ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1 }}>
        {pending ? "กำลังส่ง…" : countedLines.length > 0 ? `ส่งผลนับ ${countedLines.length} รายการให้ผู้จัดการ` : "นับอย่างน้อย 1 รายการก่อน"}
      </button>
      </>
      )}

      {/* CEO 2026-07-18 · lightbox ดูรูปสินค้าขยาย */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} className="co-tap" style={{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(10,12,16,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{zoomImg.name}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomImg.url} alt={zoomImg.name} style={{ maxWidth: "100%", maxHeight: "78%", objectFit: "contain", borderRadius: 12 }} />
          <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 12 }}>แตะที่ไหนก็ได้เพื่อปิด</div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── F3 · ประวัติใบนับ (list of CfCountRow → การ์ด + ดาวน์โหลดใบนับ PNG) ─────────────────── */
function CountHistoryList({ countDocs }: { countDocs: CfCountRow[] }) {
  if (countDocs.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
        <EmptyState icon={<History size={30} strokeWidth={1.6} />} title="ยังไม่มีประวัติใบนับ" sub="เมื่อนับสต๊อกและส่งแล้ว ใบนับจะเก็บไว้ที่นี่ (ไม่หาย)" />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, color: "#8A909A", lineHeight: 1.5 }}>
        ใบนับที่ส่งแล้ว · กด &ldquo;ดูใบนับ&rdquo; เพื่อดาวน์โหลดเป็นรูป (ส่งลงไลน์ได้)
      </div>
      {countDocs.map((doc) => (
        <CountHistoryCard key={doc.id} doc={doc} />
      ))}
    </div>
  );
}

// F3 · สถานะใบนับ → ป้าย (สี + ข้อความไทย). PENDING = เด่นสุด (ยังไม่ตัดยอด · รอผจก.)
function countStatusPill(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "APPLIED": return { label: "ปรับยอดแล้ว", color: "#15803D", bg: "#E7F4EC" };
    case "APPROVED": return { label: "อนุมัติแล้ว", color: "#15803D", bg: "#E7F4EC" };
    case "PENDING": return { label: "รอผู้จัดการอนุมัติ", color: "#B45309", bg: "#FCF1E2" };
    case "REJECTED": return { label: "ไม่อนุมัติ", color: "#B42318", bg: "#FDECEA" };
    default: return { label: status, color: "#5A6270", bg: "#F1F2F7" };
  }
}

// F3 · การ์ดประวัติ "ใบนับ" 1 ใบ — code/วันที่/ผู้นับ + จำนวนรายการ + ส่วนต่างรวม + สถานะ + ปุ่มดาวน์โหลด
function CountHistoryCard({ doc }: { doc: CfCountRow }) {
  const when = doc.countedAt.toLocaleDateString("th-TH", {
    day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  });
  const pill = countStatusPill(doc.status);
  // ส่วนต่างรวม: 0 = ตรงพอดี (เขียว) · เกิน/ขาด = เหลือง/แดง (mirror ProductCountCard diff)
  const diff = doc.totalDiff;
  const diffColor = diff === 0 ? "#15803D" : diff > 0 ? "#B45309" : "#B42318";
  const diffText = diff === 0 ? "ตรงพอดี" : `${diff > 0 ? "+" : ""}${diff.toLocaleString("en-US")}`;
  // Feature 3 · route ดาวน์โหลดใบนับเป็นรูป PNG (attachment) — ผูกกับ countId
  const imageHref = `/clawfleet/os/app/count/${doc.id}/image`;
  return (
    <div className="co-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1D21" }}>{doc.countCode}</span>
        <span style={{ flex: 1 }} />
        <span className="co-pill" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
      </div>
      <div style={{ fontSize: 11, color: "#8A909A", display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
        <span>{when}</span>
        {doc.countedByName ? <span>· ผู้นับ {doc.countedByName}</span> : null}
        {doc.reviewedByName ? <span>· อนุมัติ {doc.reviewedByName}</span> : null}
      </div>
      {/* สรุป: จำนวนรายการที่นับ · ส่วนต่างรวม (ขาด/เกิน) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "#5A6270", background: "#F1F2F7", border: "1px solid #E3E6EA", borderRadius: 20, padding: "2px 9px" }}>
          {doc.itemsCounted.toLocaleString("en-US")} รายการ
        </span>
        <span className="num" style={{ fontSize: 12, fontWeight: 700, color: diffColor, background: diff === 0 ? "#EFFAF3" : diff > 0 ? "#FCF1E2" : "#FDECEA", border: `1px solid ${diff === 0 ? "#C8E9D3" : diff > 0 ? "#F0DDBE" : "#F5CFC9"}`, borderRadius: 20, padding: "2px 9px" }}>
          ส่วนต่างรวม {diffText}
        </span>
      </div>
      {doc.status === "PENDING" && (
        <div style={{ background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "8px 11px", fontSize: 11, color: "#7A5510", lineHeight: 1.45 }}>
          ยังไม่ปรับยอด · รอผู้จัดการอนุมัติก่อน แล้วสต๊อกจะปรับตามใบนี้
        </div>
      )}
      {/* Feature 3 · ดาวน์โหลดใบนับเป็นรูป (route ตั้ง Content-Disposition: attachment) */}
      <a href={imageHref} download
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, fontSize: 13, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", borderRadius: 11, textDecoration: "none", cursor: "pointer" }}>
        <ImageDown size={16} /> ดูใบนับ / ดาวน์โหลด
      </a>
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
          {/* CEO 2026-07-16 · ประวัติรับของจัดกลุ่มตามวัน (เดิมกองรวมไม่รู้ใบไหนวันไหน) */}
          {groupReceivedByDay(receivedDocs).map((g) => (
            <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5A6270", marginTop: 4 }}>{g.label} · {g.docs.length} ใบ</div>
              {g.docs.map((doc) => (
                <ReceivedHistoryCard key={`${doc.source}-${doc.id}`} doc={doc} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// จัดกลุ่มใบรับแล้วตาม "วัน" (เวลาไทย) — หัวข้อ วันนี้/เมื่อวาน/วันที่ · เรียงใหม่→เก่า (docs มาเรียงแล้ว)
function groupReceivedByDay(docs: CfReceivedDoc[]): { key: string; label: string; docs: CfReceivedDoc[] }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date());
  const yesterday = fmt.format(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const out: { key: string; label: string; docs: CfReceivedDoc[] }[] = [];
  const byKey = new Map<string, { key: string; label: string; docs: CfReceivedDoc[] }>();
  for (const d of docs) {
    const key = fmt.format(new Date(d.receivedAt));
    let g = byKey.get(key);
    if (!g) {
      const label = key === today ? "วันนี้" : key === yesterday ? "เมื่อวาน"
        : new Date(d.receivedAt).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });
      g = { key, label, docs: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.docs.push(d);
  }
  return out;
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
      {/* หมายเหตุตอนรับ (ใบรับจริง · doc-first) — ใบเก่าก่อนฟีเจอร์ไม่มี → ซ่อน */}
      {doc.note ? (
        <div style={{ fontSize: 11, color: "#5A6270", background: "#F7F8FA", borderRadius: 9, padding: "7px 10px", lineHeight: 1.45 }}>หมายเหตุ: {doc.note}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {doc.lines.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ProductThumb imageUrl={l.imageUrl} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.productName}</div>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "#1A1D21" }}>{l.qty} ชิ้น</span>
          </div>
        ))}
      </div>
      {/* รูปหลักฐานตอนรับ (จากใบรับจริง + movement) — thumbnail แถวเดียว */}
      {doc.photoUrls.length > 0 ? (
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {doc.photoUrls.slice(0, 6).map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer" style={{ flex: "0 0 auto" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 9, border: "1px solid #E7EAF0" }} />
            </a>
          ))}
        </div>
      ) : null}
      {/* Feature 3 · ดาวน์โหลดใบรับเป็นรูป + ปริ้น (CEO 2026-07-16: กดปริ้นใบรับสินค้าได้) */}
      <div style={{ display: "flex", gap: 8 }}>
        <a href={imageHref} download
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, fontSize: 13, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", borderRadius: 11, textDecoration: "none", cursor: "pointer" }}>
          <ImageDown size={16} /> ดูใบรับ
        </a>
        <a href={`/clawfleet/os/app/receipt/${doc.id}/print`} target="_blank" rel="noreferrer"
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, fontSize: 13, fontWeight: 700, color: "#5A6270", background: "#F1F2F7", border: "none", borderRadius: 11, textDecoration: "none", cursor: "pointer" }}>
          🖨 ปริ้นใบรับ
        </a>
      </div>
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
  // doc-first (CEO 2026-07-16) · หมายเหตุตอนรับ — ลงใบรับจริง (CfGoodsReceipt)
  const [note, setNote] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // doc-first (CEO 2026-07-16): ขึ้นเป็น "ใบ" ก่อน — กดหัวใบค่อยกางรายละเอียด/ฟอร์มรับ
  const [open, setOpen] = useState(false);

  // ── กันข้อมูลหาย (CEO 2026-07-16): draft จำนวน/หมายเหตุที่กรอกค้าง → localStorage ต่อใบ ──
  //   รูปมีคิว IndexedDB ของ PhotoCaptureButton อยู่แล้ว · เดิมจำนวนที่ปรับ+หมายเหตุหายตอนรีเฟรช/สลับหน้า
  const draftKey = `clawos:receive-draft:v1:${delivery.source ?? "cf_delivery"}:${delivery.id}`;
  // restore "หลัง mount" (ไม่อ่านใน initializer — กัน hydration mismatch เพราะ server render ค่า default)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { received?: Record<string, number>; note?: string; ts?: number };
      if (!d || typeof d !== "object") return;
      // draft เก่าเกิน 3 วัน = ทิ้ง (ของอาจถูกคนอื่นรับไปแล้ว · กันค่าเก่าหลอน)
      if (typeof d.ts === "number" && Date.now() - d.ts > 3 * 24 * 60 * 60 * 1000) { localStorage.removeItem(draftKey); return; }
      if (d.received) {
        setReceived((cur) => {
          const next = { ...cur };
          for (const l of delivery.lines) {
            const v = d.received?.[l.lineId];
            if (typeof v === "number" && Number.isFinite(v)) next[l.lineId] = Math.max(0, Math.min(l.qty, Math.trunc(v)));
          }
          return next;
        });
      }
      if (typeof d.note === "string" && d.note) setNote(d.note);
      setOpen(true); // มีงานกรอกค้าง → กางใบให้เห็นทันที
    } catch { /* draft พัง/อ่านไม่ได้ → เริ่มค่า default ตามเดิม */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // save อัตโนมัติ (debounce 400ms) — เก็บเฉพาะตอน "แตะฟอร์มแล้ว" (ต่างจากค่า default) · default = ลบ draft
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const isDefault = !note && delivery.lines.every((l) => (received[l.lineId] ?? 0) === l.qty);
        if (isDefault) { localStorage.removeItem(draftKey); return; }
        localStorage.setItem(draftKey, JSON.stringify({ received, note, ts: Date.now() }));
      } catch { /* storage เต็ม/ถูกปิด → ข้าม (ไม่บล็อกงานรับ) */ }
    }, 400);
    return () => clearTimeout(t);
  }, [received, note, draftKey, delivery.lines]);
  // รับสำเร็จ → ล้าง draft ของใบนี้ (กันเด้งกลับมาโชว์ค่าเก่า)
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* no-op */ } };

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
          // + note/รูป → ลงใบรับจริง (เดิมรูป dc path อัปโหลดแล้วหายเงียบ)
          const r = await confirmTransfer({
            transferId: delivery.transferId,
            lines: delivery.lines.map((l) => ({ lineId: l.lineId, qtyReceived: received[l.lineId] ?? 0 })),
            note: note.trim() || undefined,
            photoUrls: photo ? [photo] : undefined,
          });
          if (!r.ok) {
            console.error("[clawos] confirmTransfer failed:", r.error);
            setError(r.error || "รับสินค้าไม่สำเร็จ · ลองใหม่อีกครั้ง");
            return;
          }
          // idempotent: ถ้าคนอื่น/ผู้จัดการยืนยันไปก่อน → ok เลย (server คืน ok) → โชว์ "รับแล้ว"
          clearDraft();
          setDone(true);
          return;
        }

        const r = await confirmShipmentReceived({
          deliveryId: delivery.id,
          note: note.trim() || undefined,
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
        clearDraft();
        setDone(true);
      } catch (e) {
        console.error("[clawos] confirm receive threw:", e);
        setError("รับสินค้าไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  // หัวใบ: เลขใบจริง (TF-…) · cf_delivery ไม่มีเลขใบ → เรียก "ใบกระจาย"
  const docTitle = delivery.docCode || "ใบกระจาย";
  // ส่งมาวันไหน (RSC ส่ง Date ได้ · กัน string ที่หลุดมาจาก path เก่าด้วย new Date)
  const sent = delivery.sentAt ? new Date(delivery.sentAt) : null;
  const sentLabel = sent
    ? sent.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
    : null;

  if (done) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 13, padding: "13px 15px" }}>
        <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: "#15803D", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check size={18} strokeWidth={2.6} />
        </span>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>รับสินค้าเข้าคลังแล้ว · {docTitle}</div>
      </div>
    );
  }

  return (
    <div className="co-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: open ? 12 : 0 }}>
      {/* หัวใบ (doc-first) — กดเพื่อกาง/พับรายละเอียด */}
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1D21" }}>{docTitle}</span>
            <span className="co-pill" style={{ background: "#F1F2F7", color: "#5A6270" }}>{delivery.status === "IN_TRANSIT" ? "กำลังส่ง" : "นัดส่ง"}</span>
          </div>
          <div style={{ fontSize: 11, color: "#8A909A", marginTop: 2, display: "flex", flexWrap: "wrap", gap: "1px 8px" }}>
            {delivery.fromName ? <span>จาก {delivery.fromName}</span> : null}
            {sentLabel ? <span>· ส่ง {sentLabel}</span> : null}
            <span>· {delivery.itemsCount} รายการ · <span className="num">{delivery.unitsCount}</span> ชิ้น</span>
          </div>
        </div>
        <ChevronRight size={17} style={{ flex: "0 0 17px", color: "#9AA1AB", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
      </button>

      {!open ? null : (<>
      {/* รายละเอียดหัวใบ: ใครส่ง / อ้าง PO / หมายเหตุ + ปุ่มดูใบส่ง (เฉพาะใบโอน DC) */}
      {(delivery.senderName || delivery.poCode || delivery.note || (delivery.source === "dc_transfer" && delivery.transferId)) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#F7F8FA", borderRadius: 11, padding: "9px 12px" }}>
          <div style={{ fontSize: 11, color: "#5A6270", display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {delivery.senderName ? <span>ผู้ส่ง {delivery.senderName}</span> : null}
            {delivery.poCode ? <span>· อ้างใบสั่งซื้อ {delivery.poCode}</span> : null}
          </div>
          {delivery.note ? (
            <div style={{ fontSize: 11, color: "#5A6270", lineHeight: 1.45 }}>หมายเหตุ: {delivery.note}</div>
          ) : null}
          {delivery.source === "dc_transfer" && delivery.transferId ? (
            // ดูใบส่งฉบับเต็ม (PNG) — route ฝั่ง clawfleet เช็คสิทธิ์สาขาปลายทางเอง (ไม่เปิดหลังบ้าน DC)
            <a href={`/clawfleet/os/app/transfer/${delivery.transferId}/image`} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#4F46E5", textDecoration: "none" }}>
              <ImageDown size={14} /> ดูใบส่งฉบับเต็ม
            </a>
          ) : null}
        </div>
      )}
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
      {/* หมายเหตุ + กล้อง ในบรรทัดเดียว (RULE L · เดิม dropzone 88px เต็มแถว → compact 46px) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
          placeholder="หมายเหตุตอนรับ (ไม่บังคับ)"
          style={{ flex: 1, minWidth: 0, minHeight: 46, fontSize: 13, padding: "0 12px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", color: "#1A1D21", outline: "none" }} />
        <PhotoCaptureButton label={photo ? "แนบรูปแล้ว · แตะถ่ายใหม่" : "ถ่ายรูปตอนรับ (ถ่ายได้-ข้ามได้)"}
          value={photo} onChange={setPhoto} orgId={orgId} machineCode={branchCode}
          eventScopeId={`receive-${delivery.id}`} phase="goods_receipt" compact />
      </div>
      {error && (
        <div style={{ background: "#FDF3F2", border: "1px solid #F3D4D0", borderRadius: 11, padding: "9px 12px", fontSize: 11.5, color: "#B42318", lineHeight: 1.4 }}>{error}</div>
      )}
      <button type="button" onClick={submit} disabled={pending}
        className={pending ? "" : "co-tap"}
        style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, color: "#fff", background: "#15803D", border: "none", padding: 13, borderRadius: 12, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}>
        {pending ? "กำลังรับ…" : "กดรับสินค้า"}
      </button>
      </>)}
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
/* ── ชิ้น 2 (CEO 2026-07-13) · RefillDollsSheet — เติมตุ๊กตา "อย่างเดียว" (โหลดคลัง→ตู้) ──
   เลือก SKU จากคลังสาขา (BranchStockPicker · net บนชั้นจริง) + จำนวน → refillDollsToMachine.
   ไม่ต้องทำรอบเก็บเงินเต็ม · guard เกินคลัง + idempotent (clientKey) อยู่ที่ server. */
function RefillDollsSheet({ machine, products, netById, dolls, orgId, usingDemo, onClose }: {
  machine: AppMachine;
  products: BranchStockProduct[];
  netById: Record<string, number>;
  dolls: InMachineDoll[];
  orgId: string;
  usingDemo: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  // [B+] เพิ่ม SKU ใหม่ + แนบรูป ตรงนี้เลย (reuse createBranchProduct + PhotoCaptureButton R2).
  const [showAddSku, setShowAddSku] = useState(false);
  const [newName, setNewName] = useState("");
  const [newImg, setNewImg] = useState("");
  const [addPending, startAddSku] = useTransition();
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(() => crypto.randomUUID());
  function saveNewSku() {
    const name = newName.trim();
    if (!name || addPending) return;
    setAddErr(null);
    startAddSku(async () => {
      try {
        const res = await createBranchProduct({ branchId: machine.branchId, name, imageUrl: newImg || "", clientKey: addKey });
        if (!res.ok) { setAddErr(res.error || "เพิ่มไม่สำเร็จ · ลองใหม่"); return; }
        setShowAddSku(false); setNewName(""); setNewImg(""); setAddKey(crypto.randomUUID());
        router.refresh(); // โหลดคลังใหม่ → SKU ใหม่โผล่ใน picker
      } catch {
        setAddErr("เพิ่มไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }
  // ── ดีไซน์ใหม่ (CEO 2026-07-15) · เปลี่ยนตุ๊กตา = นับรายตัว/SKU + คืนเข้าสโตร์รายตัว + เติมได้หลาย SKU ──
  // ทุกอย่างเป็น "ร่างบนจอ" จนกว่าจะกดยืนยัน → กด "เลิก" ถอนได้ (ยังไม่แตะ server) · money-safe.
  const inMachineTotal = dolls.reduce((s, d) => s + d.qty, 0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // นับที่เหลือรายตัว (เริ่มจากยอดในระบบ) · SKU ที่กด "คืนเข้าสโตร์" → เก็บใน returnedSku
  const [remainBySku, setRemainBySku] = useState<Record<string, string>>(
    () => Object.fromEntries(dolls.map((d) => [d.productId, String(d.qty)])),
  );
  const [returnedSku, setReturnedSku] = useState<Record<string, boolean>>({});
  // เติมหลาย SKU: productId → จำนวน
  const [refills, setRefills] = useState<Record<string, number>>({});
  const [catalogOpen, setCatalogOpen] = useState(false);
  // ดีไซน์ใหม่ · รูปยืนยัน ก่อน/หลังเติม — เก็บลง movement.receiptR2Key (คืน→ก่อน · เติม→หลัง)
  const [swapPhotoBefore, setSwapPhotoBefore] = useState<string>("");
  const [swapPhotoAfter, setSwapPhotoAfter] = useState<string>("");
  // clientKey ต่อ (เปิด sheet 1 ครั้ง × SKU × ชนิดงาน) — กดซ้ำ/retry ไม่คืน-เติมซ้ำ (server เช็ค refId)
  const keyMapRef = useRef<Record<string, string>>({});
  const keyFor = (kind: "ret" | "ref", pid: string) => {
    const k = `${kind}:${pid}`;
    if (!keyMapRef.current[k]) keyMapRef.current[k] = crypto.randomUUID();
    return keyMapRef.current[k];
  };

  // สินค้าคลัง → net "บนชั้นจริง" (คลัง − ในตู้) · mirror RefillLinesEditor · money-safe
  const netProducts = useMemo(
    () => products.map((p) => ({ ...p, warehouse: Math.max(0, netById[p.id] ?? 0) })),
    [products, netById],
  );
  const shelfOf = (pid: string) => netProducts.find((p) => p.id === pid)?.warehouse ?? 0;
  const nameOf = (pid: string) => netProducts.find((p) => p.id === pid)?.name ?? "สินค้า";
  const imgOf = (pid: string) => netProducts.find((p) => p.id === pid)?.imageUrl ?? null;

  const qtyOf = (pid: string) => parseInt(remainBySku[pid] || "0", 10) || 0;
  // 🔒 clamp เพดาน = จำนวนที่ระบบรู้ว่าอยู่ในตู้ (d.qty) — จอต้องบอกเท่าที่ server จะรับจริง.
  //    ไม่งั้น: จอบอก "คืน 35" แต่ server รับ min(35, 30)=30 เงียบ ๆ → ตุ๊กตา 5 ตัวหลุดบัญชี (money-feature: จอ = server)
  const capOf = (pid: string) => dolls.find((d) => d.productId === pid)?.qty ?? 0;
  const setRemain = (pid: string, raw: string) =>
    setRemainBySku((c) => ({ ...c, [pid]: String(Math.min(capOf(pid), parseInt((raw || "").replace(/[^0-9]/g, "") || "0", 10) || 0)) }));
  const nudgeRemain = (pid: string, d: number) =>
    setRemainBySku((c) => ({ ...c, [pid]: String(Math.max(0, Math.min(capOf(pid), (parseInt(c[pid] || "0", 10) || 0) + d))) }));
  const nudgeRefill = (pid: string, d: number) =>
    setRefills((c) => {
      const next = Math.max(0, Math.min(shelfOf(pid), (c[pid] || 0) + d)); // clamp ไม่เกินของบนชั้น (server กันอีกชั้น)
      const out = { ...c };
      if (next === 0) delete out[pid]; else out[pid] = next;
      return out;
    });

  // ── ยอดสรุป (mirror ตัวอย่าง) — "คืนเข้าสโตร์" ไม่นับเป็นเหลือในตู้ แต่ยังนับใน countedTotal
  //    → ตุ๊กตาออก = รอบก่อน − ที่นับได้ทั้งหมด (ตัวที่คืนไม่ใช่ลูกค้าคีบ) ตรงกับที่ server กระทบยอด.
  const swapRemainTotal = dolls.filter((d) => !returnedSku[d.productId]).reduce((a, d) => a + qtyOf(d.productId), 0);
  const swapReturnedTotal = dolls.filter((d) => returnedSku[d.productId]).reduce((a, d) => a + qtyOf(d.productId), 0);
  const swapCountedTotal = dolls.reduce((a, d) => a + qtyOf(d.productId), 0);
  const swapDispensed = Math.max(0, inMachineTotal - swapCountedTotal);
  const refillEntries = Object.entries(refills).filter(([, q]) => q > 0);
  const swapRefillTotal = refillEntries.reduce((a, [, q]) => a + q, 0);
  const swapNow = swapRemainTotal + swapRefillTotal;
  const canSubmit = (swapReturnedTotal > 0 || swapRefillTotal > 0) && !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null); setOkMsg(null);
    startTransition(async () => {
      try {
        // คืนเข้าสโตร์ทีละ SKU → เติมทีละ SKU ผ่าน action เดิม (returnDollsToStock/refillDollsToMachine).
        // รอบเก็บเงินจริงจะกระทบยอด movement "ระหว่างรอบ" เหล่านี้ให้เอง (reconcile · bfff71bc).
        for (const d of dolls) {
          if (!returnedSku[d.productId]) continue;
          const q = Math.min(d.qty, qtyOf(d.productId)); // คืนเกินที่มีในตู้ไม่ได้ (server enforce ซ้ำ)
          if (q <= 0) continue;
          const r = await returnDollsToStock({ machineId: machine.id, productId: d.productId, qty: q, clientKey: keyFor("ret", d.productId), photoUrl: swapPhotoBefore || undefined });
          if (!r.ok) { setError(r.error || `คืน "${d.name}" ไม่สำเร็จ · ลองใหม่`); return; }
        }
        for (const [pid, q] of refillEntries) {
          const r = await refillDollsToMachine({ machineId: machine.id, productId: pid, qty: q, clientKey: keyFor("ref", pid), photoUrl: swapPhotoAfter || undefined });
          if (!r.ok) { setError(r.error || `เติม "${nameOf(pid)}" ไม่สำเร็จ · ลองใหม่`); return; }
        }
        setOkMsg("บันทึกแล้ว · ปรับตุ๊กตาในตู้เรียบร้อย");
        router.refresh();
        setTimeout(onClose, 1100);
      } catch {
        setError("บันทึกไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
      }
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`เปลี่ยน/เติมตุ๊กตา ตู้ ${machine.code}`}
      style={{ position: "absolute", inset: 0, zIndex: 40, background: "#F4F5F7", display: "flex", flexDirection: "column" }}>
      {/* header เต็มจอ (ดีไซน์ใหม่ · แทน bottom-sheet) */}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 11, padding: "10px 18px 12px" }}>
        <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }} className="co-tap"
          style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 11, background: "#fff", border: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "center", cursor: pending ? "default" : "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>เปลี่ยนตุ๊กตา · {machine.code}</div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ไม่เก็บมิเตอร์ · ไม่เก็บเงิน</div>
        </div>
      </div>
      {/* scroll body */}
      <div className="scr" style={{ flex: 1, overflowY: "auto", padding: "6px 18px 22px" }}>

        {okMsg ? (
          /* overlay เขียวเต็มจอ "เปลี่ยนตุ๊กตาสำเร็จ" (mockup SWAP-09) */
          <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(21,128,61,0.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
            <div style={{ width: 82, height: 82, borderRadius: "50%", background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <Check size={46} strokeWidth={2.4} color="#fff" />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 8 }}>เปลี่ยนตุ๊กตาสำเร็จ</div>
            <div style={{ fontSize: 13.5, color: "#fff", opacity: 0.9, lineHeight: 1.6, maxWidth: 280 }}>
              บันทึกรอบเปลี่ยนตุ๊กตาตู้ <span className="num">{machine.code}</span> แล้ว<br />ไม่มีการเก็บเงินในรอบนี้
            </div>
          </div>
        ) : (
          <>
            {/* ดีไซน์ใหม่ · แถบอธิบาย "เปลี่ยนตุ๊กตาอย่างเดียว ไม่เก็บเงิน" */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#EEF0FE", borderRadius: 11, padding: "10px 12px", marginBottom: 14 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 17px" }}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
              <span style={{ fontSize: 11.5, color: "#4F46E5", lineHeight: 1.4 }}>รีบ/ไม่ว่าง? เปลี่ยนตุ๊กตาอย่างเดียว — ระบุที่เหลือ เติม แนบรูป จบ</span>
            </div>

            {/* ── นับตุ๊กตาในตู้ (รายตัว/SKU) + คืนเข้าสโตร์รายตัว ── */}
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 8 }}>นับตุ๊กตาในตู้</div>
            {dolls.length > 0 ? (
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
                {dolls.map((d) => {
                  const ret = !!returnedSku[d.productId];
                  return (
                    <div key={d.productId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid #F2F3F5", background: ret ? "#F2FBF5" : "#fff" }}>
                      <DollThumb imageUrl={d.imageUrl} name={d.name} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                        {ret ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: "#15803D", marginTop: 3 }}>
                            ✓ คืนเข้าสโตร์ {qtyOf(d.productId)} ตัว ·{" "}
                            <button type="button" onClick={() => setReturnedSku((c) => { const n = { ...c }; delete n[d.productId]; return n; })}
                              style={{ background: "none", border: "none", padding: 0, color: "#6B7280", textDecoration: "underline", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>เลิก</button>
                          </span>
                        ) : (
                          <>
                            {/* mockup SW-03: "ทุน ฿90 · ขาย ฿250" (ขาย = ราคาต่อตู้จากหน้าตั้งค่า) */}
                            {(d.unitCostCents || machine.sellPriceCents) ? (
                              <div className="num" style={{ fontSize: 10, color: "#9AA1AB", marginTop: 1 }}>
                                {[d.unitCostCents ? `ทุน ฿${Math.round(d.unitCostCents / 100)}` : null, machine.sellPriceCents ? `ขาย ฿${Math.round(machine.sellPriceCents / 100)}` : null].filter(Boolean).join(" · ")}
                              </div>
                            ) : null}
                            <button type="button" onClick={() => setReturnedSku((c) => ({ ...c, [d.productId]: true }))}
                              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: "#6B7280", background: "none", border: "none", padding: 0, marginTop: 3, cursor: "pointer" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                              คืนเข้าสโตร์
                            </button>
                          </>
                        )}
                      </div>
                      {!ret && (
                        <>
                          <span className="tap" onClick={() => nudgeRemain(d.productId, -1)} style={{ width: 29, height: 29, borderRadius: 8, background: "#F1F2F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#454B54", cursor: "pointer", userSelect: "none" }}>−</span>
                          <input value={remainBySku[d.productId] ?? ""} onChange={(e) => setRemain(d.productId, e.target.value)} inputMode="numeric" className="num" style={{ width: 38, textAlign: "center", fontSize: 16, fontWeight: 700, padding: "5px 2px", border: "1px solid #E3E6EA", borderRadius: 8 }} />
                          <span className="tap" onClick={() => nudgeRemain(d.productId, 1)} style={{ width: 29, height: 29, borderRadius: 8, background: "#EEF0FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#4F46E5", cursor: "pointer", userSelect: "none" }}>+</span>
                        </>
                      )}
                    </div>
                  );
                })}
                {swapReturnedTotal > 0 && (
                  <div style={{ display: "flex", alignItems: "center", padding: "9px 13px", background: "#FAFBFC" }}>
                    <span style={{ flex: 1 }} />
                    <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#15803D" }}>↩ คืนสโตร์ {swapReturnedTotal} ตัว</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: "#F6F7FA", borderRadius: 11, padding: "13px 15px", fontSize: 12, color: "#9AA1AB", marginBottom: 16 }}>ตู้นี้ยังไม่มีตุ๊กตาในระบบ — เลือก SKU จากคลังมาเติมได้เลย</div>
            )}

            {/* ── เติมตุ๊กตา (หลาย SKU · เลือกจากคลัง) ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", flex: 1 }}>เติมตุ๊กตา</span>
              <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#E7F4EC", padding: "3px 9px", borderRadius: 20 }}>+{swapRefillTotal} ตัว</span>
            </div>
            {refillEntries.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 9 }}>
                {refillEntries.map(([pid, q]) => (
                  <div key={pid} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F4F5FE", border: "1px solid #DDDFF7", borderRadius: 12, padding: "8px 11px" }}>
                    <DollThumb imageUrl={imgOf(pid)} name={nameOf(pid)} size={32} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#3730B0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(pid)}</span>
                    <span className="tap" onClick={() => nudgeRefill(pid, -1)} style={{ width: 27, height: 27, borderRadius: 7, background: "#fff", border: "1px solid #DADBF8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#4F46E5", cursor: "pointer", userSelect: "none" }}>−</span>
                    <span className="num" style={{ width: 26, textAlign: "center", fontSize: 14, fontWeight: 700, color: "#3730B0" }}>{q}</span>
                    <span className="tap" onClick={() => nudgeRefill(pid, 1)} style={{ width: 27, height: 27, borderRadius: 7, background: q >= shelfOf(pid) ? "#C7CBF5" : "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer", userSelect: "none" }}>+</span>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setCatalogOpen((v) => !v)} className="co-tap"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#fff", border: "1.5px dashed #C4C8FA", borderRadius: 11, padding: 11, fontSize: 12.5, fontWeight: 700, color: "#4F46E5", cursor: "pointer", marginBottom: 9 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
              เลือก SKU จากคลังมาเติม
            </button>
            {catalogOpen && (
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                {netProducts.length === 0 && <div style={{ padding: "12px 13px", fontSize: 12, color: "#9AA1AB" }}>คลังสาขานี้ยังไม่มีสินค้า</div>}
                {netProducts.map((p) => {
                  const out = p.warehouse <= 0;
                  return (
                    <div key={p.id} onClick={() => { if (out) return; nudgeRefill(p.id, 1); setCatalogOpen(false); }} className={out ? undefined : "co-tap"}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderBottom: "1px solid #F2F3F5", cursor: out ? "default" : "pointer", opacity: out ? 0.5 : 1 }}>
                      <DollThumb imageUrl={p.imageUrl} name={p.name} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div className="num" style={{ fontSize: 10.5, color: out ? "#B42318" : "#9AA1AB" }}>{out ? "คลังหมด" : `คลังเหลือ ${p.warehouse}`}</div>
                      </div>
                      {!out && (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "5px 10px", borderRadius: 8 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.6"><path d="M12 5v14M5 12h14" /></svg>เติม
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* [B+] shortcut เพิ่มตุ๊กตาแบบใหม่ (ยังไม่มีในคลัง) + แนบรูป → createBranchProduct.
                หมายเหตุ: เพิ่มเป็น "แบบสินค้า" ในคลัง (ยังไม่มีสต๊อก) — ต้องรับของเข้าคลังก่อนถึงเติมได้. */}
            {!showAddSku ? (
              <button type="button" onClick={() => setShowAddSku(true)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "none", border: "none", padding: "2px 0 4px", color: "#8A909A", fontSize: 11.5, fontWeight: 600, cursor: "pointer", width: "100%" }}>
                <PackagePlus size={13} strokeWidth={2.2} /> ไม่มีในคลัง? เพิ่มตุ๊กตาแบบใหม่
              </button>
            ) : (
              <div style={{ border: "1px solid #E9E5F9", background: "#FAFAFE", borderRadius: 13, padding: 13, marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 8 }}>เพิ่มตุ๊กตาแบบใหม่เข้าคลัง</div>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อตุ๊กตา (เช่น หมีบราวน์ ไซซ์ L)" className="co-input" style={{ fontSize: 14, marginBottom: 10 }} />
                {!usingDemo && (
                  <div style={{ marginBottom: 10 }}>
                    <PhotoCaptureButton label={newImg ? "เปลี่ยนรูปตุ๊กตา" : "ถ่าย/แนบรูปตุ๊กตา (ไม่บังคับ)"} value={newImg}
                      onChange={(url) => setNewImg(url)} orgId={orgId} machineCode={machine.code} eventScopeId={`newsku-${machine.id}`} phase="machine" />
                  </div>
                )}
                {addErr && <div style={{ fontSize: 12, color: "#B42318", fontWeight: 600, marginBottom: 8 }}>{addErr}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => { setShowAddSku(false); setAddErr(null); }} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid #E3E6EA", background: "#fff", color: "#6B7280", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
                  <button type="button" disabled={!newName.trim() || addPending} onClick={saveNewSku}
                    style={{ flex: 2, padding: 11, borderRadius: 10, border: "none", background: (!newName.trim() || addPending) ? "#C7CBF5" : "#4F46E5", color: "#fff", fontSize: 13, fontWeight: 700, cursor: (!newName.trim() || addPending) ? "default" : "pointer" }}>
                    {addPending ? "กำลังเพิ่ม…" : "เพิ่มเข้าคลัง"}
                  </button>
                </div>
              </div>
            )}

            {/* ── รูปยืนยัน (ก่อน/หลังเติม) · ไม่บังคับ ── */}
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", margin: "10px 0 8px" }}>รูปยืนยัน (ก่อน/หลังเติม) <span style={{ fontWeight: 600, color: "#B6BBC4" }}>· ไม่บังคับ</span></div>
            <div style={{ display: "flex", gap: 9, marginBottom: 16 }}>
              {usingDemo ? (
                <div style={{ flex: 1, textAlign: "center", padding: "12px 8px", borderRadius: 11, border: "1.5px dashed #C9CFD8", background: "#FAFBFC", fontSize: 12, fontWeight: 700, color: "#9AA1AB" }}>ตัวอย่าง · ถ่ายรูปไม่ได้</div>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PhotoCaptureButton slim label={swapPhotoBefore ? "ก่อนเติม ✓" : "ถ่ายก่อนเติม"} value={swapPhotoBefore} onChange={setSwapPhotoBefore}
                      orgId={orgId} machineCode={machine.code} eventScopeId={`swap-${machine.id}`} phase="stock" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PhotoCaptureButton slim label={swapPhotoAfter ? "หลังเติม ✓" : "ถ่ายหลังเติม"} value={swapPhotoAfter} onChange={setSwapPhotoAfter}
                      orgId={orgId} machineCode={machine.code} eventScopeId={`swap-${machine.id}`} phase="stock_after" />
                  </div>
                </>
              )}
            </div>

            {/* ── สรุปรอบเปลี่ยนตุ๊กตา (ประเมินจากที่นับ · รอบเก็บเงินจริงจะกระทบยอดให้เอง) ── */}
            <div style={{ background: "#EEF6FF", border: "1px solid #CFE2F5", borderRadius: 12, padding: "13px 15px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#1D6FB8", marginBottom: 9 }}>สรุปรอบเปลี่ยนตุ๊กตา</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "#5A6270" }}>ตุ๊กตาออกไป (รอบก่อน − เหลือ)</span><span className="num" style={{ fontWeight: 700, color: "#C0392B" }}>{swapDispensed} ตัว</span></div>
              {swapReturnedTotal > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "#5A6270" }}>คืนเข้าสโตร์</span><span className="num" style={{ fontWeight: 700, color: "#15803D" }}>↩ {swapReturnedTotal} ตัว</span></div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "#5A6270" }}>เติมเพิ่ม</span><span className="num" style={{ fontWeight: 700, color: "#15803D" }}>+{swapRefillTotal} ตัว</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span style={{ color: "#5A6270" }}>ตอนนี้ในตู้</span><span className="num" style={{ fontWeight: 700 }}>{swapNow} ตัว</span></div>
            </div>

            {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#B42318", fontWeight: 600 }}>{error}</div>}

            <button type="button" disabled={!canSubmit} onClick={submit} className={pending ? "" : "co-tap"}
              style={{ marginTop: 16, width: "100%", padding: 15, borderRadius: 13, border: "none", background: !canSubmit ? "#F1F2F5" : "#15803D", color: !canSubmit ? "#9AA1AB" : "#fff", fontSize: 14.5, fontWeight: 700, cursor: !canSubmit ? "default" : "pointer" }}>
              {pending ? "กำลังบันทึก…" : canSubmit
                ? `ยืนยันเปลี่ยนตุ๊กตา${swapReturnedTotal > 0 ? ` · คืน ${swapReturnedTotal}` : ""}${swapRefillTotal > 0 ? ` · เติม ${swapRefillTotal}` : ""}`
                : "กด “คืนเข้าสโตร์” หรือเลือก SKU มาเติม อย่างน้อย 1 อย่าง"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReturnDollsSheet({ machine, dolls, netAvailable, usingDemo, changeMode = false, onClose, onRefill }: {
  machine: AppMachine;
  dolls: InMachineDoll[];
  netAvailable: Record<string, number>; // productId → "ของว่างในคลัง" (คลัง − ในตู้) จาก server
  usingDemo: boolean;
  // item 7 · โหมด "เปลี่ยน" — header hint + หลังคืนสำเร็จโชว์ปุ่ม "＋ เติมตัวใหม่เข้าตู้" (reuse refill flow)
  changeMode?: boolean;
  onClose: () => void;
  onRefill?: () => void;
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
  // item 7 · คืนสำเร็จแล้วหรือยัง (โหมดเปลี่ยน: ไม่ปิด sheet · โชว์ปุ่ม "เติมตัวใหม่" แทน)
  const [returned, setReturned] = useState(false);
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
    // demo → optimistic (ไม่มี backend). โหมดเปลี่ยน = คงเปิดให้กดเติมต่อ · โหมดคืนธรรมดา = ปิด
    if (usingDemo || isDemo(machine.id)) {
      setOkMsg(`คืน ${qtyNum} ตัวเข้าคลังแล้ว (ตัวอย่าง)`);
      setReturned(true);
      if (!changeMode) setTimeout(onClose, 900);
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
        setReturned(true);
        router.refresh(); // reload loader → ยอดในตู้/ของว่างในคลังอัปเดต
        // โหมดเปลี่ยน = คงเปิดให้กด "เติมตัวใหม่" ต่อ · โหมดคืนธรรมดา = ปิดอัตโนมัติ
        if (!changeMode) setTimeout(onClose, 1100);
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
            <div style={{ fontSize: 15, fontWeight: 700 }}>{changeMode ? "เปลี่ยนตุ๊กตา" : "เอาตุ๊กตาออก · คืนเข้าคลัง"}</div>
            <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตู้ <span className="num">{machine.code}</span> · {machine.branch}</div>
          </div>
          <button type="button" aria-label="ปิด" onClick={() => { if (!pending) onClose(); }} className="co-tap"
            style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={17} color="#5A6270" strokeWidth={2.2} />
          </button>
        </div>

        {/* item 7 · โหมดเปลี่ยน — อธิบายว่า "เปลี่ยน = คืนตัวเก่าก่อน แล้วเติมใหม่" (ก่อนคืนสำเร็จ) */}
        {changeMode && !returned && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#FFF7ED", border: "1px solid #FBDCB4", borderRadius: 12, padding: "10px 13px", marginTop: 10, marginBottom: 2 }}>
            <RefreshCw size={16} strokeWidth={2} color="#B45309" style={{ flex: "0 0 16px", marginTop: 1 }} />
            <div style={{ fontSize: 12, color: "#8A5B12", lineHeight: 1.45 }}>
              เปลี่ยนตุ๊กตา = <b>คืนตัวเก่าออกก่อน</b> แล้วค่อย <b>เติมตัวใหม่เข้าตู้</b> — เริ่มจากคืนตัวเก่าด้านล่างนี้
            </div>
          </div>
        )}

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

            {/* item 7 · คืนสำเร็จในโหมดเปลี่ยน → CTA "＋ เติมตัวใหม่เข้าตู้" (reuse flow เก็บ/เติม · ไม่มี write ใหม่) */}
            {changeMode && returned && onRefill ? (
              <button type="button" onClick={onRefill} className="co-tap co-lift"
                style={{ width: "100%", minHeight: 50, fontSize: 14.5, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: 14, borderRadius: 13, cursor: "pointer", marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                เติมตัวใหม่เข้าตู้
              </button>
            ) : (
              /* ปุ่มคืน — บล็อกถ้ายังไม่เลือก/ยังไม่ยืนยัน/จำนวนไม่ถูกต้อง (server enforce ซ้ำอีกชั้น) */
              <button type="button" onClick={submit} disabled={!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg}
                className={(!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg) ? "" : "co-tap"}
                style={{ width: "100%", minHeight: 50, fontSize: 14.5, fontWeight: 700, color: "#fff", background: (!qtyConfirmed || !qtyValid || !!okMsg) ? "#A8AEB8" : "#15803D", border: "none", padding: 14, borderRadius: 13, cursor: (!selected || !qtyConfirmed || !qtyValid || pending || !!okMsg) ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1, marginTop: 2 }}>
                {pending ? "กำลังคืน…" : qtyValid ? (changeMode ? `คืน ${qtyNum} ตัว (ตัวเก่า)` : `คืน ${qtyNum} ตัวเข้าคลัง`) : "เลือกตุ๊กตา + ใส่จำนวนก่อน"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// รูปตุ๊กตาเล็ก (thumbnail) — มีรูป = แสดงรูป · ไม่มี = กล่อง placeholder (mirror ProductCountCard)
//   size (optional · default 44) — RefillLinesEditor ใช้ 32px (แถวเล็ก compact · item 6).
function DollThumb({ imageUrl, name, size = 44 }: { imageUrl: string | null; name?: string; size?: number }) {
  const radius = size >= 40 ? 11 : 9;
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius, objectFit: "cover", background: "#F1F2F5" }} />;
  }
  // [B] · ไม่มีรูป → โชว์อักษรแรกของชื่อ (ถ้ามี name) ไม่งั้น icon Inbox (backward-compat).
  const letter = name?.trim().charAt(0).toUpperCase();
  return (
    <span style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius, background: letter ? "#EDEAFB" : "#F1F2F5", color: letter ? "#6D5DD3" : "#B9BEC7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.42), fontWeight: 700 }}>
      {letter ? letter : <Inbox size={Math.round(size * 0.4)} strokeWidth={1.7} />}
    </span>
  );
}

/* item 8 · "ตอนนี้ในตู้" — แถบ chips ราย SKU (คิตตี้ ×5 · หมีบราวน์ ×3) จาก server ledger.
 * display-only (ไม่มี query/write). ว่าง → "ตู้ว่าง / ยังไม่ใส่ตุ๊กตา". compact (mobile).
 * ตู้เสีย/ยังไม่ตั้งค่า → ไม่โชว์ (ยังไม่มีสถานะของในตู้ที่มีความหมาย). */
function InMachineStrip({ dolls, isSkipped, isAwaiting }: { dolls: InMachineDoll[]; isSkipped: boolean; isAwaiting: boolean }) {
  if (isSkipped || isAwaiting) return null;
  if (dolls.length === 0) {
    return (
      <div style={{ fontSize: 10.5, color: "#B0B6BF", fontWeight: 600, padding: "0 2px 1px 4px" }}>ตู้ว่าง / ยังไม่ใส่ตุ๊กตา</div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, padding: "0 2px 1px 4px" }}>
      <span style={{ fontSize: 10, color: "#9AA1AB", fontWeight: 700 }}>ตอนนี้ในตู้</span>
      {dolls.map((d) => (
        <span key={d.productId} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#F5F3FF", border: "1px solid #E5E1F7", borderRadius: 20, padding: "2px 8px", maxWidth: 160 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#4B4763", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
          <span className="num" style={{ fontSize: 10.5, fontWeight: 700, color: "#4F46E5" }}>×{d.qty}</span>
        </span>
      ))}
    </div>
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
  // นับรูปที่ถ่ายแล้ว (มี url) — โชว์ความคืบหน้า "ถ่ายแล้ว N/6".
  // (CEO 2026-07-13) เอา "cash" ออก — เงินสดกรอกมือ ไม่ถ่ายรูปแล้ว.
  const slotKeys: (keyof Photos)[] = ["before", "after", "coinGear", "coinDigi", "dollGear", "dollDigi"];
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
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>ถ่ายรูปบันทึกด่วน · <span className="num">{machine?.code ?? "—"}</span></div>
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{machine ? `${machine.branch} · ${machine.zone}` : ""}</div>
          </div>
          <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "4px 10px", borderRadius: 20 }}>ถ่ายแล้ว {takenCount}/{slotKeys.length}</span>
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
          {/* (CEO 2026-07-13) เอากลุ่ม "เงินสด" ออก — เงินสดกรอกมือ ไม่ถ่ายรูปแล้ว. */}
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

/* CEO 2026-07-18 · sheet เลือกเหตุผลปิดรอบโดยไม่มีรูป (นโยบายบังคับถ่าย แต่มั่นใจว่าถูก) —
   เก็บลง shortReason ให้เจ้าของตรวจย้อนหลังได้ · เลือกชิป หรือพิมพ์เอง */
const PHOTO_SKIP_REASONS = ["รีบ · เก็บตู้ต่อ", "เน็ตช้า ถ่ายไม่ขึ้น", "กล้อง/ตู้มีปัญหา"] as const;
function PhotoSkipReasonSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [pick, setPick] = useState<string>("");
  const [other, setOther] = useState<string>("");
  const reason = pick === "อื่นๆ" ? other.trim() : pick;
  return (
    <div role="dialog" aria-modal="true" onClick={onCancel}
      style={{ position: "absolute", inset: 0, zIndex: 45, background: "rgba(20,22,28,0.5)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", background: "#fff", borderRadius: "20px 20px 0 0", padding: "18px 18px 22px" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: "#E3E6EA", margin: "0 auto 14px" }} />
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>ปิดรอบโดยไม่มีรูป</div>
        <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 14, lineHeight: 1.45 }}>บริษัทตั้งให้ต้องมีรูป — เลือกเหตุผลสั้น ๆ ว่าทำไมรอบนี้ไม่มี (เจ้าของเห็นในประวัติ)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {[...PHOTO_SKIP_REASONS, "อื่นๆ"].map((r) => {
            const on = pick === r;
            return (
              <button key={r} type="button" onClick={() => setPick(r)} className="co-tap"
                style={{ fontSize: 12.5, fontWeight: 600, padding: "9px 14px", borderRadius: 20, border: `1.5px solid ${on ? "#B45309" : "#E3E6EA"}`, background: on ? "#FCF6EC" : "#fff", color: on ? "#B45309" : "#5A6270", cursor: "pointer" }}>
                {r}
              </button>
            );
          })}
        </div>
        {pick === "อื่นๆ" && (
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="พิมพ์เหตุผล…" autoFocus maxLength={200}
            style={{ width: "100%", fontSize: 14, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, marginBottom: 12 }} />
        )}
        <button type="button" disabled={!reason} onClick={() => reason && onConfirm(reason)}
          style={{ width: "100%", minHeight: 50, fontSize: 15, fontWeight: 700, color: "#fff", border: "none", borderRadius: 13, background: reason ? "#15803D" : "#B7C6BC", cursor: reason ? "pointer" : "default" }}>
          ยืนยันปิดรอบ
        </button>
        <button type="button" onClick={onCancel} style={{ width: "100%", minHeight: 42, marginTop: 6, fontSize: 13, fontWeight: 600, color: "#6B7280", background: "transparent", border: "none", cursor: "pointer" }}>
          กลับไปถ่ายรูป
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
  inMachineDolls: InMachineDoll[]; // [B] SKU + จำนวนที่อยู่ในตู้ตอนนี้ (โชว์ที่ step นับ)
  step: number;
  stepLabel: string;
  form: Form;
  setNum: (key: keyof Form) => (v: string) => void;
  dispensed: number;
  afterFill: number;
  photos: Photos;
  // ถ่ายแล้ว (ยังอาจ upload ไม่เสร็จ) — ใช้โชว์ "✓" ทันทีที่ถ่าย ไม่ต้องรอเน็ต
  photosCaptured: Photos;
  onPhoto: (k: keyof Photos, url: string) => void;
  onCapture: (k: keyof Photos) => void;
  photoRequired: boolean;
  // ดีไซน์ใหม่ · แตะแถบขั้น 1-2-3 เพื่อกระโดดไป-กลับ
  onGoStep: (n: number) => void;
  // ดีไซน์ใหม่ · ยังกรอกไม่ครบอะไรบ้าง (โชว์เตือนที่หน้ากระทบยอด · ไม่ห้ามกด)
  missingForSubmit: string[];
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
  // item 7 · "record & go" — บันทึกค้าง (form+รูป) ไปเก็บตู้อื่นต่อ (surface จาก step เติม/เงินสด)
  onSaveDraft: () => void;
  saveDraftBlocked: boolean; // ยังมีรูปอัปโหลดค้าง → รอก่อน (กันรูปหาย)
  // ดีไซน์ใหม่ · คืนตุ๊กตาเข้าชั้นระหว่างรอบ → สะสม returnedTotal (หัก "ตุ๊กตาออก" ให้ตรง server)
  onReturned: (qty: number) => void;
  // ดีไซน์ใหม่ · เขียนที่นับรายตัวกลับเข้า form (ให้ร่าง/WIP เก็บไปด้วย)
  onSetRemainBySku: (map: Record<string, string>) => void;
}) {
  const { step, form: f, dispensed, afterFill, photos, recon, machine } = props;
  const stepIndicator = step <= 5 ? `ขั้นที่ ${step}/5` : "เสร็จ";
  // TASK C · sheet ตั้งชื่อเล่นตู้ (เปิดจากปุ่ม ✎ ในหัว) — ปิดเมื่อ demo (ไม่มี backend)
  const [nicknameOpen, setNicknameOpen] = useState(false);
  // ── ดีไซน์ใหม่ · หน้ากระทบยอด: overlay ดูรูป + การ์ดที่กางแก้ (VISUAL — money math มาจาก recon/props ตามเดิม) ──
  const [photoView, setPhotoView] = useState<null | "meter" | "after">(null);
  const [reconFix, setReconFix] = useState<null | "cash" | "dolls" | "meter" | "photo">(null);
  // ── ดีไซน์ใหม่ · สเต็ป 1 นับตุ๊กตาเหลือ "รายตัว/SKU" → รวมเป็น f.left (สัญญาเดินเงินเดิมไม่เปลี่ยน · left = Σ) ──
  // เก็บใน f.remainBySku (ไม่ใช่ state ในจอ) → บันทึกค้าง/กลับมาทำต่อ แล้วเลขรายตัวยังตรงกับ left เสมอ.
  const inDolls = props.inMachineDolls;
  const remainBySku = f.remainBySku ?? {}; // เข็มขัดนิรภัยชั้น 2 (ชั้นแรก = normalizeForm ตอนโหลดร่าง/WIP)
  // per-SKU ใช้ได้เมื่อ: ตู้มี SKU + (ยังไม่นับ → seed ให้ | เคยนับรายตัวไว้ → ของเดิม).
  // ร่างเก่าที่นับไว้แล้วแต่ไม่มีรายตัว (ก่อนอัปเดตนี้) → ใช้ช่องนับรวมแทน · กันเลขรายตัวเก่าเขียนทับ left ที่นับจริง
  const perSkuMode = inDolls.length > 0 && (f.left == null || Object.keys(remainBySku).length > 0);
  const remainInitRef = useRef<string | null>(null);
  useEffect(() => {
    const mid = machine?.id ?? "";
    if (remainInitRef.current === mid) return;
    remainInitRef.current = mid;
    // seed เฉพาะรอบสด (ยังไม่นับ + ยังไม่มีรายตัว) — resume/WIP มีค่าอยู่แล้ว ห้ามทับ
    if (f.left != null || Object.keys(remainBySku).length > 0 || inDolls.length === 0) return;
    const init: Record<string, string> = {};
    let sum = 0;
    for (const d of inDolls) { init[d.productId] = String(d.qty); sum += d.qty; }
    props.onSetRemainBySku(init);
    props.setNum("left")(String(sum)); // prefill รวม = ในตู้ปัจจุบัน (พนักงานปรับลดตามที่ออก)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.id]);
  const commitRemain = (next: Record<string, string>) => {
    props.onSetRemainBySku(next);
    const sum = Object.values(next).reduce((a, v) => a + (parseInt(v || "0", 10) || 0), 0);
    props.setNum("left")(String(sum)); // ยอดรวมรายตัว = ยอดที่ส่งเข้าระบบ (money-safe)
  };
  const setRemainSku = (pid: string, raw: string) => {
    commitRemain({ ...remainBySku, [pid]: (raw || "").replace(/[^0-9]/g, "") });
  };
  const nudgeRemainSku = (pid: string, delta: number) => {
    const cur = parseInt(remainBySku[pid] || "0", 10) || 0;
    commitRemain({ ...remainBySku, [pid]: String(Math.max(0, cur + delta)) });
  };
  const remainSkuTotal = Object.values(remainBySku).reduce((a, v) => a + (parseInt(v || "0", 10) || 0), 0);
  // ── ดีไซน์ใหม่ · คืนตุ๊กตา "รายตัว" เข้าชั้น ระหว่างรอบเก็บเงิน (ใช้ returnDollsToStock เดิม · money-safe) ──
  const [returningSku, setReturningSku] = useState<string | null>(null);
  const [returnedBySku, setReturnedBySku] = useState<Record<string, number>>({});
  const [returnErr, setReturnErr] = useState<string | null>(null);
  async function returnSkuToShelf(d: InMachineDoll) {
    const qty = parseInt(remainBySku[d.productId] || "0", 10) || 0;
    if (qty <= 0 || returningSku || !machine || props.usingDemo) return;
    setReturningSku(d.productId);
    setReturnErr(null);
    try {
      const res = await returnDollsToStock({ machineId: machine.id, productId: d.productId, qty, clientKey: crypto.randomUUID() });
      if (!res.ok) { setReturnErr(res.error || "คืนไม่สำเร็จ · ลองใหม่"); return; }
      props.onReturned(qty); // หัก "ออก" (ตัวที่คืนไม่ใช่ลูกค้าคีบ)
      setReturnedBySku((cur) => ({ ...cur, [d.productId]: (cur[d.productId] ?? 0) + qty }));
      commitRemain({ ...remainBySku, [d.productId]: "0" }); // คืนหมดแล้ว → เหลือในตู้ 0
    } catch {
      setReturnErr("คืนไม่สำเร็จ · เช็คสัญญาณเน็ตแล้วลองใหม่");
    } finally {
      setReturningSku(null);
    }
  }
  const cashN = n0(f.cash);
  // นโยบายบริษัทบังคับรูป + ยังไม่ถ่าย → เตือนที่ขั้น 1 (ไม่บล็อก · แค่ให้รู้ตั้งแต่ยังอยู่หน้าตู้)
  const photoGateWarn = props.photoRequired && !(props.photosCaptured.before && props.photosCaptured.after);
  const coinDelta = n0(f.coinDigi) - f.coinPrev;
  const moneyDiff = cashN - recon.expectedCash;
  /* ── หน้ากระทบยอด (mockup-match 2026-07-16 · CEO: "จบในหน้าเดียว ห้ามจอบล็อก") ──
   * โชว์สรุป + การ์ดผลตรวจ 4 ใบเสมอ · ข้อมูลที่ "ขาด" = การ์ดแดงพร้อมช่องกรอก/ปุ่มถ่ายตรงนั้นเลย
   * แต่ละการ์ดมี 2 เฉดแดง: ขาด (ยังไม่กรอก/ไม่ถ่าย = บล็อกปิดรอบ) vs ไม่ตรง (เลขครบแต่แย้งกัน = เตือน กดส่งได้ · มติ 13 ก.ค.) */
  const meterFilled = isFilled(f.dollGear) && isFilled(f.dollDigi) && isFilled(f.coinGear) && isFilled(f.coinDigi);
  const photoOk = !!props.photosCaptured.before && !!props.photosCaptured.after; // ถ่ายแล้วนับเลย (upload วิ่งเบื้องหลัง)
  const dollsMissing = !isFilled(f.left);
  const dollsMismatch = !dollsMissing && meterFilled && recon.dollDelta !== dispensed;
  const cashMissing = !isFilled(f.cash);
  const cashMismatch = !cashMissing && meterFilled && moneyDiff !== 0; // ADVISORY (≈฿10/เกม · server ใช้ราคาจริง)
  const meterMissing = !meterFilled;
  const meterUnequal = meterFilled && !recon.meterEqualOk;
  const photoMissing = props.photoRequired && !photoOk;
  const dollsOk = !dollsMissing && !dollsMismatch && meterFilled;
  const meterOk = meterFilled && recon.meterEqualOk;
  const cashOk = !cashMissing && !cashMismatch && meterFilled;
  // จำนวน "จุดแดง" บนจอ (โชว์ใน hero · ตรง mockup "พบ N จุดผิดปกติ") — รวมทั้งขาดและไม่ตรง
  const reconIssues =
    (dollsMissing || dollsMismatch ? 1 : 0) +
    (cashMissing || cashMismatch ? 1 : 0) +
    (meterMissing || meterUnequal ? 1 : 0) +
    (photoMissing ? 1 : 0);
  const allGood = reconIssues === 0;
  // ยังกรอกไม่ครบ (บล็อกปุ่มยืนยันจริง · missingForSubmit มาจาก StaffApp = ตัวเดียวกับตาข่าย submitRound)
  const notReady = props.missingForSubmit.length > 0;
  const costPerDoll = dispensed > 0 ? Math.round(cashN / dispensed) : 0;
  // ต้นทุนคีบ/ตัว ควรอยู่ ฿150–350 (retune advice) — VISUAL แนะนำ ไม่บล็อกการส่ง
  let retuneLabel = "กำลังดี", retuneColor = "#15803D", retuneBg = "#E7F4EC", retuneHint = "";
  let needRetune = false;
  if (dispensed === 0) { retuneLabel = "ไม่มีตุ๊กตาออก"; retuneColor = "#C0392B"; retuneBg = "#FBECEC"; needRetune = true; retuneHint = "ไม่มีตุ๊กตาออกเลย อาจตั้งยากไปหรือตู้เสีย"; }
  else if (costPerDoll < 150) { retuneLabel = "ออกง่ายไป"; retuneColor = "#B45309"; retuneBg = "#FCF6EC"; needRetune = true; retuneHint = "ต้นทุน/ตัวต่ำ กำไรน้อย ควรตั้งให้ยากขึ้น"; }
  else if (costPerDoll > 350) { retuneLabel = "ออกยากไป"; retuneColor = "#B45309"; retuneBg = "#FCF6EC"; needRetune = true; retuneHint = "ต้นทุน/ตัวสูง ลูกค้าคีบยาก เสี่ยงเสียลูกค้า"; }
  const wrongMachine = coinDelta < 0 || recon.dollDelta < 0 || Math.abs(recon.dollDelta - dispensed) > 20 || Math.abs(moneyDiff) > 300;

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
        {step <= 5 && <StepStrip step={step} onGo={props.onGoStep} />}
      </div>

      {/* body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px 14px" }}>
        {/* ═══ ขั้น 1 · นับ + เติม (ดีไซน์ใหม่ · จบในหน้าเดียว ไม่มีด่านบังคับ) ═══ */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 8 }}>นับตุ๊กตาในตู้ (ก่อนเติม)</div>
            {/* ── นับเหลือ "รายตัว/SKU" · รวม = f.left = ยอดที่ส่งระบบ (สัญญาเดินเงินเดิม) ── */}
            {perSkuMode ? (
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
                {inDolls.map((d) => {
                  const ret = returnedBySku[d.productId] ?? 0;
                  return (
                    <div key={d.productId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid #F2F3F5", background: ret ? "#F2FBF5" : "#fff" }}>
                      <DollThumb imageUrl={d.imageUrl} name={d.name} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                        {/* คืนเข้าสโตร์ = ตัวที่คืน ไม่นับว่าลูกค้าคีบ (หักออกจาก "ตุ๊กตาออก" ให้ตรง server) */}
                        {ret > 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#15803D", marginTop: 3 }}>✓ คืนเข้าสโตร์ {ret} ตัว</span>
                        ) : !props.usingDemo ? (
                          <button type="button" disabled={returningSku === d.productId} onClick={() => returnSkuToShelf(d)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: "#6B7280", background: "none", border: "none", padding: 0, marginTop: 3, cursor: "pointer" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                            {returningSku === d.productId ? "กำลังคืน…" : "คืนเข้าสโตร์"}
                          </button>
                        ) : null}
                      </div>
                      {ret === 0 && (
                        <>
                          <span className="tap" onClick={() => nudgeRemainSku(d.productId, -1)} style={{ width: 29, height: 29, borderRadius: 8, background: "#F1F2F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#454B54", cursor: "pointer", userSelect: "none" }}>−</span>
                          <input value={remainBySku[d.productId] ?? ""} onChange={(e) => setRemainSku(d.productId, e.target.value)} inputMode="numeric" className="num" style={{ width: 38, textAlign: "center", fontSize: 16, fontWeight: 700, padding: "5px 2px", border: "1px solid #E3E6EA", borderRadius: 8 }} />
                          <span className="tap" onClick={() => nudgeRemainSku(d.productId, 1)} style={{ width: 29, height: 29, borderRadius: 8, background: "#EEF0FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#4F46E5", cursor: "pointer", userSelect: "none" }}>+</span>
                        </>
                      )}
                    </div>
                  );
                })}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", background: "#FAFBFC" }}>
                  {/* mockup โชว์แค่ "เหลือในตู้ N ตัว" (+ คืนสโตร์เมื่อมี) — เลข "ออก" ไปโผล่หน้ากระทบยอด */}
                  <span style={{ flex: 1, fontSize: 11.5, color: "#8A909A" }}>เหลือในตู้ <b className="num" style={{ color: "#4F46E5" }}>{remainSkuTotal}</b> ตัว</span>
                  {(f.returnedTotal ?? 0) > 0 && <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#15803D", whiteSpace: "nowrap" }}>↩ คืนสโตร์ {f.returnedTotal} ตัว</span>}
                </div>
                {returnErr && <div style={{ padding: "8px 13px", fontSize: 11.5, color: "#B42318", fontWeight: 600, background: "#FDF3F2" }}>{returnErr}</div>}
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {/* ตู้ยังไม่มี SKU ในระบบ → นับรวมทีเดียว (fallback) */}
                <CountField value={f.left} onChange={props.setNum("left")} placeholder="นับแล้วกรอก" />
                <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 6 }}>รอบก่อนมี {f.last} ตัว · กรอกที่นับได้ ระบบคำนวณตุ๊กตาที่ออกให้</div>
              </div>
            )}

            {/* ── เติมตุ๊กตา (ข้ามได้ · ไม่เติมก็กดถัดไปได้) ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", flex: 1 }}>เติมตุ๊กตา <span style={{ fontWeight: 600, color: "#B6BBC4" }}>(ไม่เติมก็ได้)</span></span>
              <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#E7F4EC", padding: "3px 9px", borderRadius: 20 }}>+{props.refillTotal} ตัว</span>
            </div>
            {props.branchWarehouses.length > 1 && (
              <div style={{ marginBottom: 9 }}>
                {/* WAVE-3b · R4 · เลือกห้องคลังที่หยิบของมาเติม — โผล่เฉพาะสาขาที่มี >1 ห้อง */}
                <select
                  value={f.refillWarehouseId ?? (props.branchWarehouses.find((w) => w.isMain)?.id ?? props.branchWarehouses[0]?.id ?? "")}
                  onChange={(e) => props.onPickWarehouse(e.target.value)}
                  style={{ ...selectStyle, fontSize: 12.5, padding: "9px 11px" }}
                >
                  {props.branchWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>เติมจาก: {w.name}{w.isMain ? " (คลังหลัก)" : ""}</option>
                  ))}
                </select>
              </div>
            )}
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
              // สาขาไม่มีสต็อกในระบบ → fallback เลือกชื่อ SKU + จำนวนเดียว (พฤติกรรมเดิม)
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 9 }}>
                <select value={f.product} onChange={(e) => props.onProduct(e.target.value)} style={{ ...selectStyle, fontSize: 12.5, padding: "9px 11px" }}>
                  {props.skus.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  {props.skus.every((s) => s.name !== f.product) && <option value={f.product}>{f.product}</option>}
                </select>
                <CountField value={f.refill} onChange={props.setNum("refill")} size={16} placeholder="เติมกี่ตัว (ไม่เติม = เว้นว่าง)" />
              </div>
            )}

            {/* ── รูปยืนยัน (ก่อน/หลังเติม) — 2 ปุ่ม slim เรียงคู่ตาม mockup · ไม่บล็อกการกดถัดไป ──
                คำเตือนนโยบายรูป ย่อเหลือท้ายหัวข้อบรรทัดเดียว (กล่อง amber เดิมกินที่ · CEO สั่งย่อ) */}
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", margin: "14px 0 8px" }}>
              รูปยืนยัน (ก่อน/หลังเติม)
              {photoGateWarn && <span style={{ fontWeight: 600, color: "#B45309" }}> · ต้องมีก่อนปิดรอบ (ถ่ายทีหลังได้)</span>}
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <PhotoTile label="ก่อนเติม" value={photos.before} captured={!!props.photosCaptured.before}
                onChange={(url) => props.onPhoto("before", url)} onCaptured={() => props.onCapture("before")}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock" disabled={props.usingDemo} />
              <PhotoTile label="หลังเติม" value={photos.after} captured={!!props.photosCaptured.after}
                onChange={(url) => props.onPhoto("after", url)} onCaptured={() => props.onCapture("after")}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock_after" disabled={props.usingDemo} />
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
            {/* ── มิเตอร์ 4 ตัว · ตาราง 2×2 + กล้องต่อช่อง (ดีไซน์ใหม่ · แทนการ์ด 2 ก้อนเดิม) ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", flex: 1 }}>มิเตอร์ 4 ตัว (บน = ล่าง)</span>
              <span className="num" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: meterOk ? "#E7F4EC" : "#FCF1E2", color: meterOk ? "#15803D" : "#B45309" }}>{meterOk ? "บน=ล่าง ✓" : "บน≠ล่าง"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 8 }}>
              {METER_CELLS.map((c) => {
                // สีกรอบต่อ "คู่" (เงิน/ตุ๊กตา): กรอกครบแล้วเท่ากัน = เขียว · ไม่เท่า = ส้ม · ยังไม่ครบ = เทา
                const pairOk = c.pair === "coin" ? props.meterGroupVals.coinMeterEqual : props.meterGroupVals.dollMeterEqual;
                const pairFilled = c.pair === "coin"
                  ? isFilled(f.coinGear) && isFilled(f.coinDigi)
                  : isFilled(f.dollGear) && isFilled(f.dollDigi);
                const bg = !pairFilled ? "#fff" : pairOk ? "#F4FBF6" : "#FCF6EC";
                const bd = !pairFilled ? "#E3E6EA" : pairOk ? "#BFE6CB" : "#F0D9A8";
                return (
                  <div key={c.key} style={{ background: bg, border: `1.5px solid ${bd}`, borderRadius: 11, padding: "9px 10px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>{c.label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input value={f[c.key] == null ? "" : String(f[c.key])} onChange={(e) => props.setNum(c.key)(e.target.value)} inputMode="numeric" className="num"
                        style={{ width: "100%", minWidth: 0, fontSize: 15, fontWeight: 700, padding: "6px 8px", border: "1px solid #E3E6EA", borderRadius: 8, background: "#fff" }} />
                      {!props.usingDemo && machine?.code ? (
                        <PhotoCaptureButton compact label="" value={photos[c.photoKey]} onChange={(url) => props.onPhoto(c.photoKey, url)} onCaptured={() => props.onCapture(c.photoKey)}
                          orgId={props.orgId} machineCode={machine.code} eventScopeId={props.eventScopeId} phase={c.phase} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 16 }}>อ่านไม่ได้? แตะกล้องเพื่อถ่ายรูปมิเตอร์แทน (ใช้เป็นหลักฐาน) · กรอกทีหลังได้ กด “ถัดไป” ไว้ก่อนได้เลย</div>

            {/* ตู้เสีย/อ่านมิเตอร์ไม่ได้ → แจ้งซ่อม & ข้าม (ย่อเป็นลิงก์บรรทัดเดียว · ของเดิมกินที่ครึ่งจอ) */}
            <button type="button" disabled={props.skipPending}
              onClick={() => {
                if (props.skipPending) return;
                const ok = window.confirm(`ตู้ ${machine?.code ?? "นี้"} เสีย/อ่านมิเตอร์ไม่ได้?\nระบบจะแจ้งซ่อมตู้นี้และข้ามไปเก็บตู้ถัดไป`);
                if (ok) props.onSkipBroken();
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, marginBottom: 16, fontSize: 11.5, fontWeight: 600, color: "#B42318", cursor: props.skipPending ? "wait" : "pointer", opacity: props.skipPending ? 0.6 : 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
              {props.skipPending ? "กำลังแจ้งซ่อม…" : "ตู้นี้เสีย/อ่านมิเตอร์ไม่ได้ — แจ้งซ่อม & ข้าม"}
            </button>
          </div>
        )}

        {/* [STEP] เงินสด + พรีวิว "ระบบคำนวณให้อัตโนมัติ" (ดีไซน์ใหม่ · ราคาตั้งในหน้าตั้งค่าตู้แล้ว ไม่ต้องกรอกตรงนี้) */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 8 }}>เงินสดที่เก็บได้</div>
            {/* ช่อง ฿ ใหญ่แถวเดียว (ตามตัวอย่าง) — แทนป้าย+BigInput เดิมที่กิน 2 บรรทัด */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#9AA1AB" }}>฿</span>
              <input value={f.cash == null ? "" : String(f.cash)} onChange={(e) => props.setNum("cash")(e.target.value)} inputMode="numeric" className="num" placeholder="นับเงินแล้วกรอก"
                style={{ flex: 1, minWidth: 0, fontSize: 22, fontWeight: 700, padding: "6px 4px", border: "none", background: "transparent", outline: "none" }} />
              <span style={{ fontSize: 12, color: "#9AA1AB" }}>บาท</span>
            </div>
            {/* ระบบคำนวณให้อัตโนมัติ — พรีวิวก่อนไปหน้ากระทบยอด (เลขตรงกับที่ server จะกระทบยอด)
                มิเตอร์ยังไม่กรอก → โชว์ "—" (เดิมโชว์ "+-12 / ฿-90" เลขหลอกจาก null→0 ลบค่ารอบก่อน) */}
            <div style={{ background: "#F1F2FE", border: "1px solid #DEE0FA", borderRadius: 12, padding: "13px 15px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", marginBottom: 9 }}>ระบบคำนวณให้อัตโนมัติ</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "#5A6270" }}>ตุ๊กตาออกรอบนี้ (จากที่นับ)</span><span className="num" style={{ fontWeight: 700 }}>{isFilled(f.left) ? `${dispensed} ตัว` : "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}><span style={{ color: "#5A6270" }}>มิเตอร์ตุ๊กตาเพิ่ม</span><span className="num" style={{ fontWeight: 700 }}>{isFilled(f.dollDigi) ? `+${recon.dollDelta}` : "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}><span style={{ color: "#5A6270" }}>มิเตอร์เหรียญ (≈฿10/เกม) → คาดว่าได้เงิน</span><span className="num" style={{ fontWeight: 700 }}>{isFilled(f.coinDigi) ? `฿${recon.expectedCash}` : "—"}</span></div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            {/* ═══ กระทบยอด — จบในหน้าเดียวเสมอ (mockup C3) · ไม่มีจอบล็อกอีกต่อไป ═══ */}
            {/* hero: เขียว = ครบ+ตรงหมด · แดง = มีจุดต้องดู (บอกจำนวน + ความหมายตรงเงื่อนไขปุ่มจริง) */}
            <div style={{ display: "flex", alignItems: "center", gap: 13, background: allGood ? "#E7F4EC" : "#FBECEC", border: `1px solid ${allGood ? "#BFE6CB" : "#EBC6C2"}`, borderRadius: 14, padding: "15px 16px", marginBottom: 14 }}>
              <span style={{ width: 44, height: 44, flex: "0 0 44px", borderRadius: "50%", background: allGood ? "#15803D" : "#C0392B", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {allGood ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                )}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: allGood ? "#15803D" : "#C0392B" }}>{allGood ? "ยอดตรงกันทั้งหมด" : `พบ ${reconIssues} จุดผิดปกติ`}</div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {allGood ? "มิเตอร์ เงินสด ตุ๊กตา และรูป สอดคล้องกัน — ยืนยันส่งได้เลย"
                    : notReady ? "จุดสีแดงกรอก/ถ่ายได้ตรงนั้นเลย — ครบแล้วปุ่มยืนยันจะเปิด" : "แดง = เตือน · ตรวจสอบแล้วกดยืนยันได้"}
                </div>
              </div>
            </div>

            {/* สรุปรอบนี้ (2×2) + คืนสโตร์ + ต้นทุน/retune — โชว์เสมอ (ช่องที่ยังไม่กรอก = "—") */}
            <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 13, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54", marginBottom: 11 }}>สรุปรอบนี้ · {machine?.code ?? "—"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px 12px" }}>
                <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>รอบที่แล้วมีตุ๊กตา</div><div className="num" style={{ fontSize: 17, fontWeight: 700 }}>{f.last} ตัว</div></div>
                <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ตอนนี้ในตู้ (หลังเติม)</div><div className="num" style={{ fontSize: 17, fontWeight: 700 }}>{isFilled(f.left) ? `${afterFill} ตัว` : "—"}</div></div>
                <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ตุ๊กตาออกไป</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#4F46E5" }}>{isFilled(f.left) ? `${dispensed} ตัว` : "—"}</div></div>
                <div><div style={{ fontSize: 10.5, color: "#9AA1AB" }}>เก็บเงินได้</div><div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#15803D" }}>{isFilled(f.cash) ? `฿${cashN.toLocaleString("en-US")}` : "—"}</div></div>
              </div>
              {(f.returnedTotal ?? 0) > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11, fontSize: 11.5, color: "#15803D", fontWeight: 600 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                  คืนเข้าสโตร์รอบนี้ {f.returnedTotal} ตัว (ไม่นับเป็นลูกค้าคีบ)
                </div>
              )}
              {isFilled(f.cash) && isFilled(f.left) && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13, paddingTop: 12, borderTop: "1px solid #F0F1F4" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ต้นทุนเฉลี่ย/ตัว (เก็บได้ ÷ ออก)</div>
                      <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>฿{costPerDoll} <span style={{ fontSize: 11, color: "#9AA1AB", fontWeight: 500 }}>ควรอยู่ ฿150–350</span></div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: retuneBg, color: retuneColor, whiteSpace: "nowrap" }}>{retuneLabel}</span>
                  </div>
                  {needRetune && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#FCF6EC", border: "1px solid #F0D9A8", borderRadius: 10, padding: "9px 11px" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 15px" }}><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg>
                      <span style={{ fontSize: 11.5, color: "#8A5A12", lineHeight: 1.4 }}>{retuneHint} → เสนอปรับตั้งค่าตู้ได้ด้านล่าง (รอเจ้าของอนุมัติ)</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ตัวเลขต่างจากปกติมากผิดปกติ → เตือนตรวจว่ากรอกถูกตู้ (เฉพาะเมื่อกรอกครบพอจะตัดสิน) */}
            {!notReady && wrongMachine && (
              <div style={{ display: "flex", gap: 10, background: "#FBECEC", border: "1px solid #E9B8B4", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth="2.1" style={{ flex: "0 0 18px", marginTop: 1 }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "#C0392B" }}>ตัวเลขต่างจากปกติมากผิดปกติ</div><div style={{ fontSize: 11.5, color: "#93453C", marginTop: 3, lineHeight: 1.45 }}>ลองตรวจว่ากรอกถูกตู้ ({machine?.code ?? "—"}) ถูกช่องหรือไม่ ก่อนยืนยัน</div></div>
              </div>
            )}

            {/* ── การ์ดผลตรวจ 4 ใบ (ตุ๊กตา/เงิน/มิเตอร์/รูป) — ขาด = กรอก/ถ่ายตรงนั้นเลย ── */}
            <ReconCard ok={dollsOk} wait={!dollsMissing && !dollsMismatch && !meterFilled}
              title={dollsMissing ? "ยังไม่ได้นับตุ๊กตาที่เหลือ" : dollsMismatch ? "ตุ๊กตาออก ไม่ตรงมิเตอร์" : meterFilled ? "ตุ๊กตาออก ตรงกับมิเตอร์" : "นับแล้ว — รอเลขมิเตอร์เทียบ"}
              detail={dollsMissing ? "นับที่เหลือในตู้แล้วกรอกตรงนี้ได้เลย — ระบบคำนวณตุ๊กตาที่ออกให้"
                : `นับได้ออก ${dispensed} ตัว (รอบก่อน ${f.last} − เหลือ ${n0(f.left)})${meterFilled ? ` · มิเตอร์ตุ๊กตา +${recon.dollDelta}` : ""}`}
              actions={<ReconPill onClick={() => setReconFix(reconFix === "dolls" ? null : "dolls")} label={reconFix === "dolls" ? "ปิด" : dollsMissing ? "กรอกเลย" : "แก้เลข"} color={dollsOk ? "#4F46E5" : "#fff"} bg={dollsOk ? "#EEF0FE" : "#C0392B"} />}
              expanded={reconFix === "dolls" ? (
                <div style={{ margin: "10px 0 2px 31px", background: "#FAFBFC", border: "1px solid #EDEFF2", borderRadius: 10, padding: "11px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "#5A6270", marginBottom: 9 }}>จำนวนตุ๊กตาที่เหลือในตู้ (ก่อนเติม)</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="text" inputMode="numeric" value={f.left == null ? "" : String(f.left)} onChange={(e) => props.setNum("left")(e.target.value)} className="num" placeholder="นับแล้วกรอก"
                      style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, textAlign: "right", padding: "9px 11px", border: "1.5px solid #C7CBD2", borderRadius: 9 }} />
                    <button type="button" onClick={() => setReconFix(null)} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#15803D", border: "none", padding: "10px 16px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" }}>ใช้เลขนี้</button>
                  </div>
                </div>
              ) : undefined} />

            <ReconCard ok={cashOk} wait={!cashMissing && !cashMismatch && !meterFilled}
              title={cashMissing ? "ยังไม่ได้กรอกเงินสดที่เก็บได้" : cashMismatch ? `เงินสด ต่างประมาณ ฿${Math.abs(moneyDiff)}` : meterFilled ? "เงินสด ตรงกับมิเตอร์" : "กรอกแล้ว — รอเลขมิเตอร์เทียบ"}
              detail={cashMissing ? "นับเงินในตู้แล้วกรอกตรงนี้ได้เลย"
                : `เก็บได้ ฿${cashN}${meterFilled ? ` · มิเตอร์เหรียญ +${coinDelta} → คาดว่าได้ ฿${recon.expectedCash} (ประมาณ ฿10/เกม)` : ""}`}
              actions={<ReconPill onClick={() => setReconFix(reconFix === "cash" ? null : "cash")} label={reconFix === "cash" ? "ปิด" : cashMissing ? "กรอกเลย" : "แก้เลข"} color={cashOk ? "#4F46E5" : "#fff"} bg={cashOk ? "#EEF0FE" : "#C0392B"} />}
              expanded={reconFix === "cash" ? (
                <div style={{ margin: "10px 0 2px 31px", background: "#FAFBFC", border: "1px solid #EDEFF2", borderRadius: 10, padding: "11px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "#5A6270", marginBottom: 9 }}>ยอดเงินสดที่นับได้ (บาท)</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="text" inputMode="numeric" value={f.cash == null ? "" : String(f.cash)} onChange={(e) => props.setNum("cash")(e.target.value)} className="num" placeholder="นับเงินแล้วกรอก"
                      style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, textAlign: "right", padding: "9px 11px", border: "1.5px solid #C7CBD2", borderRadius: 9 }} />
                    <button type="button" onClick={() => setReconFix(null)} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#15803D", border: "none", padding: "10px 16px", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" }}>ใช้เลขนี้</button>
                  </div>
                </div>
              ) : undefined} />

            <ReconCard ok={meterOk}
              title={meterMissing ? "ยังไม่ได้กรอกเลขมิเตอร์ 4 ช่อง" : meterUnequal ? "มิเตอร์ บน/ล่าง ไม่เท่ากัน" : "มิเตอร์ บน=ล่าง · ครบ 4 ตัว"}
              detail={`เงิน ${isFilled(f.coinGear) ? n0(f.coinGear) : "—"}/${isFilled(f.coinDigi) ? n0(f.coinDigi) : "—"} · ตุ๊กตา ${isFilled(f.dollGear) ? n0(f.dollGear) : "—"}/${isFilled(f.dollDigi) ? n0(f.dollDigi) : "—"}`}
              actions={
                <span style={{ display: "flex", gap: 6 }}>
                  <ReconPill onClick={() => setPhotoView("meter")} label="ดูรูป" color="#4F46E5" bg="#EEF0FE"
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.5" /></svg>} />
                  <ReconPill onClick={() => setReconFix(reconFix === "meter" ? null : "meter")} label={reconFix === "meter" ? "ปิด" : meterOk ? "แก้เลข" : "กรอกเลย"} color={meterOk ? "#4F46E5" : "#fff"} bg={meterOk ? "#EEF0FE" : "#C0392B"} />
                </span>
              }
              expanded={reconFix === "meter" ? (
                // กรอกมิเตอร์ตรงนี้ได้เลย — ช่องเดียวกับขั้น 2 (state ตัวเดียวกัน · แค่ render ซ้ำ)
                <div style={{ margin: "10px 0 2px 31px", background: "#FAFBFC", border: "1px solid #EDEFF2", borderRadius: 10, padding: "11px 12px" }}>
                  <div style={{ fontSize: 11.5, color: "#5A6270", marginBottom: 9 }}>เลขมิเตอร์ 4 ช่อง (บน = ล่าง)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {METER_CELLS.map((c) => (
                      <div key={c.key}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>{c.label}</div>
                        <input value={f[c.key] == null ? "" : String(f[c.key])} onChange={(e) => props.setNum(c.key)(e.target.value)} inputMode="numeric" className="num"
                          style={{ width: "100%", minWidth: 0, fontSize: 14, fontWeight: 700, padding: "7px 9px", border: "1px solid #E3E6EA", borderRadius: 8, background: "#fff" }} />
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setReconFix(null)} style={{ width: "100%", marginTop: 9, fontSize: 12, fontWeight: 700, color: "#fff", background: "#15803D", border: "none", padding: 10, borderRadius: 9, cursor: "pointer" }}>ใช้เลขนี้</button>
                </div>
              ) : undefined} />

            <ReconCard ok={photoOk} wait={!photoOk && !photoMissing}
              title={photoMissing ? "รูปยังไม่ครบ — แนบตรงนี้ได้เลย" : photoOk ? "รูปหลักฐาน ครบ 2/2" : "รูปหลักฐาน (ไม่บังคับ)"}
              detail={`ก่อนเติม ${props.photosCaptured.before ? "✓" : "— ยังไม่แนบ"} · หลังเติม ${props.photosCaptured.after ? "✓" : "— ยังไม่แนบ"}`}
              actions={
                <span style={{ display: "flex", gap: 6 }}>
                  {photoOk && <ReconPill onClick={() => setPhotoView("after")} label="ดูรูป" color="#4F46E5" bg="#EEF0FE"
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.5" /></svg>} />}
                  {!photoOk && <ReconPill onClick={() => setReconFix(reconFix === "photo" ? null : "photo")} label={reconFix === "photo" ? "ปิด" : "แนบรูป"} color="#fff" bg={photoMissing ? "#C0392B" : "#4F46E5"} />}
                </span>
              }
              expanded={reconFix === "photo" ? (
                // ถ่ายจริงตรงนี้เลย (PhotoTile จริง อัปโหลดจริง — ไม่ใช่ปุ่มติ๊กหลอกแบบ mockup)
                <div style={{ margin: "10px 0 2px 31px", display: "flex", gap: 8 }}>
                  <PhotoTile label="ก่อนเติม" value={photos.before} captured={!!props.photosCaptured.before}
                    onChange={(url) => props.onPhoto("before", url)} onCaptured={() => props.onCapture("before")}
                    orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock" disabled={props.usingDemo} />
                  <PhotoTile label="หลังเติม" value={photos.after} captured={!!props.photosCaptured.after}
                    onChange={(url) => props.onPhoto("after", url)} onCaptured={() => props.onCapture("after")}
                    orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock_after" disabled={props.usingDemo} />
                </div>
              ) : undefined} />

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

            {/* N5 · ด่านเงินขาด — server คืน needsReason (verdict=SHORT) → ต้องเลือกเหตุผลก่อนส่งซ้ำ */}
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
        )}

        {step === 6 && (
          /* overlay เขียวเต็มจอ "กระทบยอดสำเร็จ" (mockup C3-16) — แทนหน้าขาวเดิม */
          <div style={{ position: "absolute", inset: 0, zIndex: 25, background: "rgba(21,128,61,0.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
            <div style={{ width: 82, height: 82, borderRadius: "50%", background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <Check size={46} strokeWidth={2.4} color="#fff" />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 8 }}>กระทบยอดสำเร็จ</div>
            <div style={{ fontSize: 13.5, color: "#fff", opacity: 0.9, lineHeight: 1.6, maxWidth: 280, marginBottom: 14 }}>
              บันทึกรอบเก็บเงินของตู้ <span className="num">{machine?.code ?? "—"}</span> แล้ว<br />ข้อมูลถูกส่งเข้าระบบกันโกงอัตโนมัติ
            </div>
            <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 300, marginBottom: 22 }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.14)", borderRadius: 13, padding: "12px 10px" }}>
                <div style={{ fontSize: 10.5, color: "#D9F0E2", marginBottom: 3 }}>เก็บเงิน</div>
                <div className="num" style={{ fontSize: 19, fontWeight: 700, color: "#fff" }}>฿{n0(f.cash).toLocaleString("en-US")}</div>
              </div>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.14)", borderRadius: 13, padding: "12px 10px" }}>
                <div style={{ fontSize: 10.5, color: "#D9F0E2", marginBottom: 3 }}>ตุ๊กตาออก</div>
                <div className="num" style={{ fontSize: 19, fontWeight: 700, color: "#fff" }}>{dispensed} <span style={{ fontSize: 12, fontWeight: 600, color: "#D9F0E2" }}>ตัว</span></div>
              </div>
            </div>
            <button type="button" onClick={props.primary.action} className="co-tap"
              style={{ fontSize: 13.5, fontWeight: 700, color: "#15803D", background: "#fff", border: "none", padding: "12px 26px", borderRadius: 12, cursor: "pointer" }}>
              กลับหน้าแรก
            </button>
          </div>
        )}
      </div>

      {/* bottom bar — sticky · พื้นทึบ · ปุ่มหลักเต็มกว้าง แตะถนัด (≥48px)
          ปุ่มเทา (#F1F2F5) = สถานะ "ยังมี N จุดผิด" ตาม mockup → ตัวหนังสือเทา ไม่มีเงา no-op */}
      <div style={{ padding: "14px 18px 22px", borderTop: "1px solid #EAECEF", background: "#fff" }}>
        {(() => {
          const greyState = props.primary.color === "#F1F2F5";
          return (
            <button type="button" onClick={props.primary.action} disabled={props.primaryDisabled}
              className={props.primaryDisabled || greyState ? "" : "co-tap co-pbtn"}
              style={{ width: "100%", minHeight: 50, fontSize: 15, fontWeight: 700, color: greyState ? "#9AA1AB" : "#fff", border: "none", padding: "14px 16px", borderRadius: 13, cursor: props.primaryDisabled || greyState ? "not-allowed" : "pointer", background: props.primary.color, opacity: props.primaryDisabled ? 0.55 : 1, boxShadow: props.primaryDisabled || greyState ? "none" : "0 8px 18px -10px rgba(27,30,42,0.5)" }}>
              {props.primary.label}
            </button>
          );
        })()}
        {/* "บันทึกค้างไว้ · ไปตู้ต่อ" — ขั้นมิเตอร์ (รีบ) + ขั้นกระทบยอดที่ยังกรอกไม่ครบ (งานไม่ทิ้ง)
            (reuse saveDraft · resume กลับมากรอกต่อ · money-safe: รอบยังไม่ปิดจนเลขครบ)
            ซ่อนตอน demo (ไม่มี backend) · uploadPending → รอ upload รูปเสร็จก่อน (กันรูปหาย). */}
        {!props.usingDemo && (props.step === 3 || (props.step === 5 && notReady)) && (
          <button type="button" onClick={props.onSaveDraft} disabled={props.saveDraftBlocked}
            className={props.saveDraftBlocked ? "" : "co-tap"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", minHeight: 48, marginTop: 9, fontSize: 14, fontWeight: 700, color: "#B45309", border: "1.5px solid #F0D8AE", padding: "12px 16px", borderRadius: 13, cursor: props.saveDraftBlocked ? "not-allowed" : "pointer", background: "#FFFBF3", opacity: props.saveDraftBlocked ? 0.6 : 1 }}>
            {props.saveDraftBlocked ? (
              "⏳ กำลังอัปโหลดรูป… รอสักครู่"
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
                บันทึกค้างไว้ · ไปตู้ต่อ
              </>
            )}
          </button>
        )}
        {props.secondary && (
          <button type="button" onClick={props.secondary.action} style={{ width: "100%", minHeight: 44, fontSize: 13, fontWeight: 600, color: "#6B7280", border: "none", padding: "11px 0 2px", background: "transparent", cursor: "pointer" }}>
            {props.secondary.label}
          </button>
        )}
      </div>

      {/* ดีไซน์ใหม่ · ป๊อปอัปดูรูป (มิเตอร์/หลังเติม) — เปิดจากปุ่ม "ดูรูป" บนการ์ดกระทบยอด */}
      {photoView && (
        <div onClick={() => setPhotoView(null)} className="co-tap" style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(20,22,28,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 26 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", width: "100%", maxWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid #EEF0F3" }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>{photoView === "meter" ? "รูปมิเตอร์" : "รูปหลังเติม"}</span>
              <button type="button" onClick={() => setPhotoView(null)} style={{ width: 30, height: 30, borderRadius: 9, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {(() => {
              const url = photoView === "meter" ? (photos.coinDigi || photos.coinGear || photos.dollDigi || photos.dollGear || "") : (photos.after || "");
              return url
                ? <img src={url} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "contain", background: "#0F1116", display: "block" }} />
                : (
                  <div style={{ height: 240, background: "linear-gradient(135deg,#EBEDF2,#DDE0E7)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#A2A9B4" }}>
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#A2A9B4" strokeWidth="1.6"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3.5" /></svg>
                    <span style={{ fontSize: 12 }}>ยังไม่มีรูป{machine?.code ? ` · ${machine.code}` : ""}</span>
                  </div>
                );
            })()}
          </div>
        </div>
      )}

      {/* TASK C · sheet ตั้งชื่อเล่นตู้ (overlay) — เปิดจากปุ่ม ✎ ในหัว */}
      {nicknameOpen && machine && (
        <NicknameSheet machine={machine} onClose={() => setNicknameOpen(false)} />
      )}
    </div>
  );
}

/* ─────────────────────────── small UI helpers ─────────────────────────── */
// [STEP] แถบความคืบหน้า 3 ขั้น (อ่านปราดเดียว) — เสร็จ=ติ๊ก · กำลังทำ=เด่น · เหลือ=จาง.
// VISUAL ONLY: อ่านค่า step จาก reducer ตรง ๆ (ขั้นจริง {1,3,5}) ไม่แตะ step logic.
// show = เลขที่พนักงานเห็น (1-2-3) · n = ขั้นจริงใน reducer (1,3,5) — เดิมโชว์ n ตรง ๆ เลยขึ้น "1 · 3 · 5" หลอกตา
const STEP_STRIP = [
  { n: 1, show: 1, t: "นับ + เติม" },
  { n: 3, show: 2, t: "มิเตอร์ + เงิน" },
  { n: 5, show: 3, t: "กระทบยอด" },
];
function StepStrip({ step, onGo }: { step: number; onGo?: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
      {STEP_STRIP.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} onClick={() => onGo?.(s.n)} className={onGo ? "co-tap" : undefined}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0, cursor: onGo ? "pointer" : "default" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              <span style={{ height: 3, flex: 1, borderRadius: 3, background: i === 0 ? "transparent" : step >= s.n ? "#4F46E5" : "#E3E6EA" }} />
              <span style={{
                flex: "0 0 26px", width: 26, height: 26, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12.5, fontWeight: 700,
                background: active ? "#4F46E5" : done ? "#E7F4EC" : "#fff",
                color: active ? "#fff" : done ? "#15803D" : "#B0B6BF",
                border: `2px solid ${active ? "#4F46E5" : done ? "#BFE6CB" : "#E3E6EA"}`,
                transition: "all .15s",
              }}>
                {done ? <Check size={13} strokeWidth={3} /> : <span className="num">{s.show}</span>}
              </span>
              <span style={{ height: 3, flex: 1, borderRadius: 3, background: i === STEP_STRIP.length - 1 ? "transparent" : step > s.n ? "#4F46E5" : "#E3E6EA" }} />
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: active ? "#4F46E5" : "#9AA1AB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{s.t}</span>
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

/* FIX-2 · ช่องนับที่ "พิมพ์เลขได้" + ปุ่ม −/+ (fallback ตอนตู้ยังไม่มี SKU ในระบบ).
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
/* ดีไซน์ใหม่ (mockup-match 2026-07-16) · โซนเติมตุ๊กตาแบบตัวอย่างเป๊ะ:
 *  - ไลน์ที่เลือก = pill สีม่วงอ่อน (bg #F4F5FE · ชื่อ #3730B0 · − ขาว/+ ทึบ) → ต่างจากการ์ดนับสีขาว (แก้ "ตาลาย")
 *  - catalog พับไว้หลังปุ่มเส้นประ "เลือก SKU จากคลังมาเติม" · เลือกแล้วปิดเอง (เดิมกางถาวร 9 แถว = หน้ายาว 1.77 จอ)
 *  - − ที่จำนวน 1 = เอาไลน์ออก (พฤติกรรม mockup) · สัญญา onAdd/onSetQty/onRemove เดิมทุกตัว (money-safe)
 */
function RefillLinesEditor({ products, netById, lines, onAdd, onSetQty, onRemove }: {
  products: BranchStockProduct[];
  netById: Record<string, number>;
  lines: RefillLine[];
  onAdd: (productId: string, name: string) => void;
  onSetQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const pickedIds = new Set(lines.map((l) => l.productId));
  // remap "คงคลัง" → net "ของบนชั้นจริง" (คลัง − ในตู้) ให้ตรงกับ server guard เติม (net-per-room)
  const netProducts = products.map((p) => ({ ...p, warehouse: Math.max(0, netById[p.id] ?? 0) }));
  const remaining = netProducts.filter((p) => !pickedIds.has(p.id));

  return (
    <div>
      {/* ไลน์ที่เลือกแล้ว — indigo pill (mockup C1-12) */}
      {lines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 9 }}>
          {lines.map((l) => {
            const prod = netProducts.find((p) => p.id === l.productId);
            const cap = prod?.warehouse ?? 0;
            const over = l.qty > cap; // เกินของบนชั้น → เตือน (ไม่บล็อก · server กันจริง)
            return (
              <div key={l.productId}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#F4F5FE", border: `1px solid ${over ? "#F0D9A8" : "#DDDFF7"}`, borderRadius: 12, padding: "8px 11px" }}>
                  <DollThumb imageUrl={prod?.imageUrl ?? null} name={l.name} size={32} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#3730B0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                  <span className="tap" onClick={() => (l.qty <= 1 ? onRemove(l.productId) : onSetQty(l.productId, l.qty - 1))}
                    style={{ width: 27, height: 27, flex: "0 0 27px", borderRadius: 7, background: "#fff", border: "1px solid #DADBF8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#4F46E5", cursor: "pointer", userSelect: "none" }}>−</span>
                  <span className="num" style={{ width: 26, textAlign: "center", fontSize: 14, fontWeight: 700, color: "#3730B0" }}>{l.qty}</span>
                  <span className="tap" onClick={() => onSetQty(l.productId, Math.min(cap, l.qty + 1))}
                    style={{ width: 27, height: 27, flex: "0 0 27px", borderRadius: 7, background: l.qty >= cap ? "#C7CBF5" : "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer", userSelect: "none" }}>+</span>
                </div>
                {over && (
                  <div style={{ fontSize: 10.5, color: "#B45309", fontWeight: 600, margin: "4px 2px 0" }}>เกินของบนชั้น (มี {cap}) — ระบบจะเติมได้ไม่เกินที่มีจริง</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ปุ่มเส้นประ เปิด/ปิด catalog (mockup C1-13) */}
      <button type="button" onClick={() => setCatalogOpen((v) => !v)} className="co-tap"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#fff", border: "1.5px dashed #C4C8FA", borderRadius: 11, padding: 11, fontSize: 12.5, fontWeight: 700, color: "#4F46E5", cursor: "pointer", marginBottom: 9 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
        เลือก SKU จากคลังมาเติม
      </button>

      {/* catalog — เปิดเมื่อกดเท่านั้น · แตะแถว = เพิ่ม 1 ตัว + ปิดเอง (mockup C1-14) */}
      {catalogOpen && (
        <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, overflow: "hidden", marginBottom: 9 }}>
          {remaining.length === 0 && (
            <div style={{ padding: "12px 13px", fontSize: 12, color: "#9AA1AB" }}>{netProducts.length === 0 ? "คลังสาขานี้ยังไม่มีสินค้า" : "เลือกครบทุกแบบแล้ว"}</div>
          )}
          {remaining.map((c) => {
            const out = c.warehouse <= 0;
            return (
              <div key={c.id} onClick={() => { if (out) return; onAdd(c.id, c.name); setCatalogOpen(false); }} className={out ? undefined : "co-tap"}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderBottom: "1px solid #F2F3F5", cursor: out ? "default" : "pointer", opacity: out ? 0.5 : 1 }}>
                <DollThumb imageUrl={c.imageUrl} name={c.name} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div className="num" style={{ fontSize: 10.5, color: out ? "#B42318" : "#9AA1AB" }}>{out ? "คลังหมด" : `คลังเหลือ ${c.warehouse}`}</div>
                </div>
                {!out && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "5px 10px", borderRadius: 8 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.6"><path d="M12 5v14M5 12h14" /></svg>เติม
                  </span>
                )}
              </div>
            );
          })}
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

/**
 * ดีไซน์ใหม่ · ปุ่มรูปคู่ "ก่อนเติม / หลังเติม" — แบน กว้างครึ่งจอ วางเรียงคู่ (ตามตัวอย่าง).
 * ถ่ายแล้ว = กรอบเขียวทึบ + "ก่อนเติม ✓" · ยังไม่ถ่าย = กรอบประ + "ถ่ายก่อนเติม".
 * ไม่บังคับ (CEO 2026-07-15) — ไม่มีป้ายแดง "ต้องถ่ายรูปก่อน" อีกแล้ว.
 * logic การถ่าย/อัปโหลดใช้ PhotoCaptureButton ตัวเดิมทุกอย่าง (คิว IndexedDB + retry).
 */
function PhotoTile({ label, value, captured, onChange, onCaptured, orgId, machineCode, eventScopeId, phase, disabled }: {
  label: string; value: string; captured: boolean; onChange: (url: string) => void; onCaptured: () => void;
  orgId: string; machineCode: string; eventScopeId: string; phase: Phase; disabled?: boolean;
}) {
  const on = !!value || captured;
  if (disabled || !orgId || !machineCode) {
    return (
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "12px 8px", minHeight: 44, borderRadius: 11, border: "1.5px dashed #C9CFD8", background: "#FAFBFC", fontSize: 12, fontWeight: 700, color: "#9AA1AB" }}>
        <Camera size={16} strokeWidth={1.9} />ถ่าย{label}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <PhotoCaptureButton slim label={on ? `${label} ✓` : `ถ่าย${label}`} value={value} onChange={onChange} onCaptured={onCaptured}
        orgId={orgId} machineCode={machineCode} eventScopeId={eventScopeId} phase={phase} />
    </div>
  );
}

/* ดีไซน์ใหม่ · การ์ดคำแนะนำในหน้ากระทบยอด (✓/✗ + รายละเอียด + ปุ่มดูรูป/แก้ + กล่องแก้ inline) */
function ReconCard({ ok, wait, title, detail, actions, expanded }: {
  // wait = ยังตัดสินไม่ได้ (รอข้อมูลช่องอื่น เช่น มิเตอร์) → เหลืองนาฬิกา ไม่ใช่ ✗ แดง (ไม่นับเป็น "จุดผิด")
  ok: boolean; wait?: boolean; title: string; detail: string; actions?: React.ReactNode; expanded?: React.ReactNode;
}) {
  const tone = ok
    ? { bd: "#E8EAED", accent: "#15803D", circle: "#E7F4EC", text: "#166534" }
    : wait
      ? { bd: "#F0E2BE", accent: "#D9A83C", circle: "#FCF6EC", text: "#8A5A12" }
      : { bd: "#EBC6C2", accent: "#C0392B", circle: "#FBECEC", text: "#B02A1C" };
  return (
    <div style={{ background: "#fff", border: `1px solid ${tone.bd}`, borderLeft: `4px solid ${tone.accent}`, borderRadius: 12, padding: "12px 14px", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 22, height: 22, flex: "0 0 22px", borderRadius: "50%", background: tone.circle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {ok
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            : wait
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: tone.text }}>{title}</span>
        {actions}
      </div>
      <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 7, paddingLeft: 31, lineHeight: 1.45 }}>{detail}</div>
      {expanded}
    </div>
  );
}

/* ดีไซน์ใหม่ · ปุ่มเล็กบนการ์ดกระทบยอด (ดูรูป / แก้ไข / กลับไปแก้) */
function ReconPill({ onClick, label, color, bg, icon }: { onClick: () => void; label: string; color: string; bg: string; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="co-tap"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color, background: bg, border: "none", padding: "5px 10px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
      {icon}{label}
    </button>
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

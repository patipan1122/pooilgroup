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

import { useMemo, useReducer, useState, useTransition } from "react";
import { Loader2, ChevronRight, Inbox, Check, X } from "lucide-react";
import { PhoneFrame, EmptyState } from "@/components/clawfleet/os/kit";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import {
  startBranchSession,
  submitBranchEvent,
  closeBranchSession,
} from "@/lib/clawfleet/actions";
import type {
  GroupCollectBranch,
  CollectSku,
  GroupMachine,
} from "@/lib/clawfleet/group-data";

/* ─────────────────────────── demo fallback (no real DB) ────────────────────────── */
type AppMachine = {
  id: string;
  code: string;
  branch: string;
  zone: string;
  branchId: string;
  // last-round reference numbers (จากระบบ)
  lastStock: number;
  lastDollMeter: number;
  lastCoinMeter: number;
  product: string;
};

const DEMO_BRANCH_ID = "demo-branch-rs";
const DEMO_SKUS: CollectSku[] = [
  { id: "demo-sku-1", sku: "KT-01", name: "ซานริโอ้ คิตตี้" },
  { id: "demo-sku-2", sku: "BR-01", name: "หมีบราวน์ L" },
  { id: "demo-sku-3", sku: "MJ-01", name: "โมจิหมีขาว" },
  { id: "demo-sku-4", sku: "KM-01", name: "คุมะ ไซส์ M" },
];

const DEMO_MACHINES: AppMachine[] = [
  { id: "demo-RS-03", code: "RS-03", branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 10, lastDollMeter: 105, lastCoinMeter: 210, product: "ซานริโอ้ คิตตี้" },
  { id: "demo-RS-04", code: "RS-04", branch: "รังสิต", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 12, lastDollMeter: 88, lastCoinMeter: 540, product: "โมจิหมีขาว" },
  { id: "demo-RS-07", code: "RS-07", branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 9, lastDollMeter: 150, lastCoinMeter: 300, product: "หมีบราวน์ L" },
  { id: "demo-RS-05", code: "RS-05", branch: "รังสิต", zone: "โซน B", branchId: DEMO_BRANCH_ID, lastStock: 11, lastDollMeter: 120, lastCoinMeter: 410, product: "คุมะ ไซส์ M" },
  { id: "demo-BK-02", code: "BK-02", branch: "บางแค", zone: "โซน C", branchId: DEMO_BRANCH_ID, lastStock: 8, lastDollMeter: 212, lastCoinMeter: 880, product: "หมีน้ำตาล S" },
  { id: "demo-LP-01", code: "LP-01", branch: "ลาดพร้าว", zone: "โซน A", branchId: DEMO_BRANCH_ID, lastStock: 7, lastDollMeter: 64, lastCoinMeter: 150, product: "ซานริโอ้ คิตตี้" },
];

/** flatten real Branch>Group>Claw → a flat machine route (CLAW only). */
function flattenReal(branches: GroupCollectBranch[]): AppMachine[] {
  const out: AppMachine[] = [];
  for (const b of branches) {
    for (const g of b.groups) {
      for (const m of g.claws) {
        out.push({
          id: m.id,
          code: m.code,
          branch: b.name,
          zone: g.name,
          branchId: b.id,
          lastStock: m.lastDollStock,
          lastDollMeter: m.lastDollMeter,
          lastCoinMeter: m.lastCoinMeter,
          product: "",
        });
      }
    }
  }
  return out;
}

const isDemo = (id: string) => id.startsWith("demo-");
const CASH_PER_PLAY = 10; // ฿/ครั้ง

/* ─────────────────────────── wizard state ─────────────────────────── */
type Form = {
  last: number; // ตุ๊กตารอบก่อน (ระบบ)
  left: number; // คงเหลือก่อนเติม (นับจริง)
  refill: number; // เติมกี่ตัว
  product: string;
  category: string;
  price: number;
  // meters
  dollPrev: number;
  dollGear: number;
  dollDigi: number;
  coinPrev: number;
  coinGear: number;
  coinDigi: number;
  cash: number;
};

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
  sessionId: string | null;
};

type WizardState = {
  step: number; // 0 = home, 1..6 = wizard steps
  machineId: string | null;
  form: Form;
  photos: Photos;
  meterDeferred: boolean;
  resumed: boolean;
  configSent: boolean;
  sessionId: string | null; // real session id (null when demo / not started)
};

const blankPhotos: Photos = {
  before: "", after: "", dollGear: "", dollDigi: "",
  coinGear: "", coinDigi: "", cash: "",
};

function formFor(m: AppMachine, skus: CollectSku[]): Form {
  const product = m.product || skus[0]?.name || "ตุ๊กตา";
  return {
    last: m.lastStock,
    left: Math.max(0, m.lastStock - 5),
    refill: 5,
    product,
    category: "ลิขสิทธิ์",
    price: 250,
    dollPrev: m.lastDollMeter,
    dollGear: m.lastDollMeter + 5,
    dollDigi: m.lastDollMeter + 5,
    coinPrev: m.lastCoinMeter,
    coinGear: m.lastCoinMeter + 30,
    coinDigi: m.lastCoinMeter + 30,
    cash: 300,
  };
}

type Action =
  | { type: "open"; machine: AppMachine; skus: CollectSku[]; sessionId: string | null }
  | { type: "resume"; draft: Draft }
  | { type: "next" }
  | { type: "back" }
  | { type: "home" }
  | { type: "setForm"; key: keyof Form; value: number | string }
  | { type: "setPhoto"; key: keyof Photos; url: string }
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
        meterDeferred: false,
        resumed: false,
        configSent: false,
        sessionId: a.sessionId,
      };
    case "resume":
      return {
        step: 3,
        machineId: a.draft.machineId,
        form: { ...a.draft.form },
        // resumed: count already done · photos optional (skipped urls don't persist in
        // the local draft) → leave blank; the resumed banner explains "just need meters".
        photos: { ...blankPhotos },
        meterDeferred: false,
        resumed: true,
        configSent: false,
        sessionId: a.draft.sessionId,
      };
    case "next":
      return { ...s, step: Math.min(6, s.step + 1) };
    case "back":
      return { ...s, step: s.step <= 1 ? 0 : s.step - 1 };
    case "home":
      return { ...s, step: 0, machineId: null, resumed: false, meterDeferred: false, sessionId: null };
    case "setForm":
      return { ...s, form: { ...s.form, [a.key]: a.value } };
    case "setPhoto":
      return { ...s, photos: { ...s.photos, [a.key]: a.url } };
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
  meterDeferred: false, resumed: false, configSent: false, sessionId: null,
};

/* ─────────────────────────── public wrapper (renders twice) ─────────────────────────── */
type Props = {
  orgId: string;
  branches: GroupCollectBranch[];
  skus: CollectSku[];
  // นโยบายถ่ายรูป (จาก org settings) — true = บังคับถ่ายก่อนไปต่อ, false = ถ่ายได้-ข้ามได้
  photoRequired: boolean;
};

export function StaffAppClient({ orgId, branches, skus, photoRequired }: Props) {
  const realMachines = useMemo(() => flattenReal(branches), [branches]);
  const usingDemo = realMachines.length === 0;
  const machines = usingDemo ? DEMO_MACHINES : realMachines;
  const skuList = usingDemo || skus.length === 0 ? DEMO_SKUS : skus;
  // ในโหมด demo ไม่มี backend อัปโหลด → ปุ่มถ่ายถูก disable อยู่แล้ว, จึงไม่บังคับถ่าย (กันค้าง)
  const enforcePhoto = photoRequired && !usingDemo;

  // ONE StaffApp instance per render-slot. Each keeps its own local state, but the
  // desktop preview & mobile full-screen are different breakpoints — only one is
  // visible at a time, so independent state is fine (and avoids re-render coupling).
  const app = (
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} />
  );
  const appMobile = (
    <StaffApp orgId={orgId} machines={machines} skus={skuList} usingDemo={usingDemo} photoRequired={enforcePhoto} />
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
};

type Panel = "history" | "repair" | "stock" | "config" | "tour" | null;

function StaffApp({ orgId, machines, skus, usingDemo, photoRequired }: StaffAppProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [panel, setPanel] = useState<Panel>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState(0);
  // ตู้ที่กำลังเปิดรอบ (กดแล้วรอ startBranchSession ~2-3 วิ) → โชว์สปินเนอร์บนตู้นั้น
  const [openingId, setOpeningId] = useState<string | null>(null);

  const machine = useMemo(
    () => machines.find((m) => m.id === state.machineId) ?? null,
    [machines, state.machineId],
  );

  const f = state.form;
  const dispensed = Math.max(0, f.last - f.left);
  const afterFill = f.left + f.refill;
  const dollDelta = f.dollDigi - f.dollPrev;
  const coinDelta = f.coinDigi - f.coinPrev;
  const expectedCash = coinDelta * CASH_PER_PLAY;
  const dollMeterEqual = f.dollGear === f.dollDigi;
  const coinMeterEqual = f.coinGear === f.coinDigi;
  const meterEqualOk = dollMeterEqual && coinMeterEqual;
  const dollMatch = dollDelta === dispensed;
  const cashMatch = f.cash === expectedCash;
  const allMatch = dollMatch && cashMatch && meterEqualOk;
  const tooHard = dispensed <= 0 && f.cash >= 200;
  const meterReady = !state.meterDeferred;

  /* ── นโยบายถ่ายรูป: แต่ละขั้นต้องมีรูปครบไหมก่อนกดถัดไป/ส่ง ──
   * step 1 = ก่อนเติม · step 2 = หลังเติม · step 3 = มิเตอร์ (ตุ๊กตา + เหรียญ อย่างละ 1 รูป) · step 4 = เงินสด.
   * backend coalesce มิเตอร์เป็น 1 ช่อง/ตัว → บังคับอย่างน้อยฝั่งละ 1 (เฟืองหรือดิจิตอล). */
  const ph = state.photos;
  // ขั้นมิเตอร์ที่กด "ถ่ายไว้ก่อน · กรอกทีหลัง" (defer) จะซ่อนปุ่มถ่าย → ห้ามบังคับถ่ายตอนนั้น (กันค้าง)
  const step3PhotoOk = (!!ph.dollGear || !!ph.dollDigi) && (!!ph.coinGear || !!ph.coinDigi);
  const stepPhotoSatisfied =
    state.step === 1 ? !!ph.before
      : state.step === 2 ? !!ph.after
        : state.step === 3 ? (state.meterDeferred ? true : step3PhotoOk)
          : state.step === 4 ? !!ph.cash
            : true; // step 5/6 ไม่มีช่องถ่าย
  // บังคับเฉพาะเมื่อนโยบายเปิด + ขั้นที่มีรูป (1-4)
  const photoStepActive = photoRequired && state.step >= 1 && state.step <= 4;
  const photoBlocks = photoStepActive && !stepPhotoSatisfied;

  /* ── open a machine: start a REAL session up-front (so submit can fire), else demo ── */
  function openMachine(m: AppMachine) {
    setError(null);
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
          setError(`${r.error} · เปิดรอบไม่ได้ ลองอีกครั้ง`);
          return;
        }
        dispatch({ type: "open", machine: m, skus, sessionId: r.data.id });
      } finally {
        setOpeningId(null);
      }
    });
  }

  function saveDraft() {
    if (!machine) return;
    const d: Draft = {
      machineId: machine.id,
      code: machine.code,
      branch: machine.branch,
      cash: f.cash,
      dispensed,
      time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
      form: { ...f },
      sessionId: state.sessionId,
    };
    setDrafts((p) => ({ ...p, [machine.id]: d }));
    dispatch({ type: "home" });
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

    const sessionId = state.sessionId;
    const p = state.photos;
    startTransition(async () => {
      const ev = await submitBranchEvent({
        sessionId,
        machineId: machine.id,
        coinMeterAfter: f.coinDigi,
        dollMeterAfter: f.dollDigi,
        cashCountedCents: Math.round(f.cash * 100),
        // ⚠️ anti-cheat: stockBefore = สต๊อกรอบก่อน (lastDollStock = f.last) ไม่ใช่ที่นับตอนนี้.
        // server: prizeCountedOut = stockBefore + refillQty − stockAfter = f.last − f.left = dispensed
        // (ถ้าส่ง f.left จะได้ 0 เสมอ → ทุกตู้โดน flag ตุ๊กตาหายเท็จ + จับขโมยจริงไม่ได้)
        stockBefore: f.last,
        refillQty: f.refill,
        stockAfter: afterFill,
        refillProductId:
          f.refill > 0 ? skus.find((s) => s.name === f.product)?.id : undefined,
        // Photos OPTIONAL ("ถ่ายได้-ข้ามได้"): send the real R2 url that was captured, else ""
        // (server accepts url | "" | undefined → a skipped photo never blocks the round).
        // The meter step captures per-row (เฟือง/ดิจิตอล); backend has 1 slot per meter, so
        // coalesce to whichever row was photographed.
        photoCoinMeterUrl: p.coinDigi || p.coinGear || "",
        photoPrizeMeterUrl: p.dollDigi || p.dollGear || "",
        photoStockBeforeUrl: p.before || "",
        photoStockAfterUrl: p.after || "",
        photoCashUrl: p.cash || "",
      });
      if (!ev.ok) {
        setError(ev.error);
        return;
      }
      const close = await closeBranchSession({ sessionId });
      if (!close.ok) {
        setError(close.error);
        return;
      }
      setDrafts((p) => {
        const n = { ...p };
        delete n[machine.id];
        return n;
      });
      dispatch({ type: "next" }); // → step 6 (done)
    });
  }

  function finishMachine() {
    dispatch({ type: "home" });
  }

  const setNum = (key: keyof Form) => (v: string) =>
    dispatch({ type: "setForm", key, value: v === "" ? 0 : Number(v.replace(/[^0-9]/g, "")) });

  /* ── bottom-bar primary/secondary buttons ── */
  let primaryLabel = "ถัดไป";
  let primaryColor = "#4F46E5";
  let primaryAction: () => void = () => dispatch({ type: "next" });
  let secondaryLabel = "";
  let secondaryAction: (() => void) | null = null;

  if (state.step === 5) {
    if (!meterReady) {
      primaryLabel = "บันทึกค้างไว้ · ไปเก็บตู้อื่น";
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

  // นโยบายถ่ายรูป: ถ้าขั้นนี้ยังไม่ถ่ายครบ → กันกดถัดไป + dim ปุ่ม (ไม่บังคับขั้น 5/6 ที่ไม่มีช่องถ่าย)
  const primaryDisabled = pending || photoBlocks;

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
  const routeDone = draftList.length;
  const routePct = routeTotal > 0 ? Math.round((routeDone / routeTotal) * 100) : 0;

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

      {onHome ? (
        <HomeScreen
          panel={panel}
          setPanel={setPanel}
          routeTotal={routeTotal}
          routeDone={routeDone}
          routePct={routePct}
          machines={machines}
          drafts={drafts}
          draftList={draftList}
          onOpen={openMachine}
          pending={pending}
          openingId={openingId}
          tourStep={tourStep}
          setTourStep={setTourStep}
          skus={skus}
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
          photoRequired={photoRequired}
          photoBlocks={photoBlocks}
          meterDeferred={state.meterDeferred}
          toggleDefer={() => dispatch({ type: "toggleDefer" })}
          resumed={state.resumed}
          meterGroupVals={{ dollMeterEqual, coinMeterEqual }}
          recon={{ dollDelta, expectedCash, dollMatch, cashMatch, meterEqualOk, allMatch }}
          tooHard={tooHard}
          configSent={state.configSent}
          sendConfig={() => dispatch({ type: "sendConfig" })}
          skus={skus}
          onProduct={(v) => dispatch({ type: "setForm", key: "product", value: v })}
          onCategory={(v) => dispatch({ type: "setForm", key: "category", value: v })}
          // ขั้นเสร็จ (6): back = กลับหน้าหลัก+รีเซ็ต (กันย้อนเข้าไปแก้ยอดที่ส่งไปแล้ว)
          onBack={() => dispatch({ type: state.step >= 6 ? "home" : "back" })}
          primary={{ label: primaryLabel, color: primaryColor, action: primaryAction }}
          secondary={secondaryAction ? { label: secondaryLabel, action: secondaryAction } : null}
          pending={pending}
          primaryDisabled={primaryDisabled}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── HOME ─────────────────────────── */
function HomeScreen(props: {
  panel: Panel;
  setPanel: (p: Panel) => void;
  routeTotal: number;
  routeDone: number;
  routePct: number;
  machines: AppMachine[];
  drafts: Record<string, Draft>;
  draftList: Draft[];
  onOpen: (m: AppMachine) => void;
  pending: boolean;
  openingId: string | null;
  tourStep: number;
  setTourStep: (n: number) => void;
  skus: CollectSku[];
}) {
  const { panel, setPanel, routeTotal, routeDone, routePct, machines, drafts, draftList, onOpen, pending, openingId } = props;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px 24px" }}>
      {/* greeting */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, margin: "8px 0 18px" }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>ส</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#9AA1AB" }}>สวัสดีตอนบ่าย</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>สมชาย ใจดี</div>
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

          {/* route list */}
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#454B54" }}>ตู้ในเส้นทางวันนี้</div>
          {machines.length === 0 ? (
            // empty state — พนักงานยังไม่ได้รับมอบหมายตู้ (กันหน้าว่างเปล่าดูเหมือนพัง)
            <div style={{ background: "#fff", border: "1px dashed #D6DAE0", borderRadius: 14 }}>
              <EmptyState icon={<Inbox size={30} strokeWidth={1.6} />} title="ยังไม่มีตู้ที่ได้รับมอบหมาย" sub="ติดต่อผู้ดูแลเพื่อขอมอบหมายตู้ในเส้นทางของคุณ" />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {machines.map((m) => {
                const isDraft = !!drafts[m.id];
                const isOpening = openingId === m.id;
                const tag = isDraft
                  ? { l: "ค้างมิเตอร์", c: "#B45309", bg: "#FCF1E2", iBg: "#FCF1E2", iC: "#B45309", dot: "#E8A33D", hint: "ถ่ายรูป+นับแล้ว · รอกรอกเลขมิเตอร์" }
                  : { l: "รอเก็บ", c: "#4F46E5", bg: "#EEF0FE", iBg: "#EEF0FE", iC: "#4F46E5", dot: "#4F46E5", hint: "แตะเพื่อเริ่มเก็บเงิน" };
                // ระหว่างมีตู้กำลังเปิดรอบ → dim ตู้อื่น, ตู้ที่กดโชว์สปินเนอร์ (กันรู้สึกค้าง/พัง)
                const dimmed = pending && !isOpening;
                return (
                  <button key={m.id} type="button" disabled={pending} onClick={() => onOpen(m)}
                    className={pending ? "" : "co-tap co-lift"}
                    style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 64, background: "#fff", border: `1px solid ${isOpening ? "#C7C3F0" : isDraft ? "#F0E2BE" : "#E8EAED"}`, borderRadius: 13, padding: "12px 14px", textAlign: "left", cursor: pending ? "wait" : "pointer", opacity: dimmed ? 0.5 : 1 }}>
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
                );
              })}
            </div>
          )}
        </>
      ) : (
        <PanelScreen panel={panel} onBack={() => setPanel(null)} tourStep={props.tourStep} setTourStep={props.setTourStep} skus={props.skus} />
      )}
    </div>
  );
}

/* ─────────────────────────── PANELS (history/repair/stock/config/tour) ─────────────────────────── */
const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  history: "ประวัติการเก็บของฉัน",
  repair: "แจ้งซ่อมตู้",
  stock: "เช็ก/นับสต็อกสาขา",
  config: "สถานะตั้งค่าตู้",
  tour: "เติมทัวร์ 7-11",
};

function PanelScreen(props: { panel: Exclude<Panel, null>; onBack: () => void; tourStep: number; setTourStep: (n: number) => void; skus: CollectSku[] }) {
  const { panel, onBack } = props;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
        <button type="button" onClick={onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{PANEL_TITLE[panel]}</span>
      </div>
      {panel === "history" && <HistoryPanel />}
      {panel === "repair" && <RepairPanel />}
      {panel === "stock" && <StockPanel />}
      {panel === "config" && <ConfigPanel />}
      {panel === "tour" && <TourPanel tourStep={props.tourStep} setTourStep={props.setTourStep} />}
    </div>
  );
}

function HistoryPanel() {
  const rows = [
    { code: "RS-03", date: "วันนี้ 14:20", cash: "฿300", ok: true },
    { code: "LP-01", date: "วันนี้ 13:50", cash: "฿620", ok: true },
    { code: "RS-07", date: "เมื่อวาน 18:10", cash: "฿540", ok: false },
    { code: "RS-04", date: "เมื่อวาน 17:30", cash: "฿420", ok: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((h) => (
        <div key={h.code} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "11px 13px" }}>
          <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#4F46E5", flex: "0 0 50px" }}>{h.code}</span>
          <div style={{ flex: 1 }}>
            <div className="num" style={{ fontSize: 13.5, fontWeight: 700 }}>{h.cash}</div>
            <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>{h.date}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 11px", borderRadius: 20, background: h.ok ? "#E7F4EC" : "#FCEDEC", color: h.ok ? "#15803D" : "#B42318" }}>{h.ok ? "ตรง" : "ไม่ตรง"}</span>
        </div>
      ))}
    </div>
  );
}

function RepairPanel() {
  const repairOptions = ["คีบไม่ทำงาน/อ่อน", "จอ/ไฟเสีย", "เหรียญติด", "ตุ๊กตาติดในตู้", "อื่นๆ"];
  const repairList = [
    { code: "BK-04", issue: "ไม่มีเงินเข้า สงสัยคีบเสีย", status: "กำลังซ่อม", c: "#B45309", bg: "#FCF1E2" },
    { code: "RS-02", issue: "จอแสดงผลดับ", status: "รอช่าง", c: "#B42318", bg: "#FCEDEC" },
  ];
  const lbl = { fontSize: 12, fontWeight: 600, color: "#454B54", display: "block", marginBottom: 5 } as const;
  const sel = { width: "100%", fontSize: 14, fontWeight: 600, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", cursor: "pointer" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div>
        <label style={lbl}>เลือกตู้ที่เสีย</label>
        <select style={sel}><option>RS-03 · รังสิต</option><option>RS-04 · รังสิต</option><option>BK-02 · บางแค</option><option>LP-01 · ลาดพร้าว</option></select>
      </div>
      <div>
        <label style={lbl}>อาการเสีย</label>
        <select style={sel}>{repairOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 11, border: "1.5px dashed #C9CFD8", background: "#FAFBFC", color: "#6B7280", fontSize: 12.5, fontWeight: 600 }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></svg>แนบรูปอาการเสีย
      </div>
      <textarea placeholder="รายละเอียดเพิ่มเติม…" style={{ width: "100%", fontSize: 13, padding: "11px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", minHeight: 64, resize: "none" }} />
      <button type="button" style={{ width: "100%", fontSize: 14, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: 13, borderRadius: 12, cursor: "pointer" }}>ส่งแจ้งซ่อม</button>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", marginTop: 4 }}>แจ้งซ่อมที่ค้างอยู่</div>
      {repairList.map((rp) => (
        <div key={rp.code} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "11px 13px" }}>
          <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5", flex: "0 0 46px" }}>{rp.code}</span>
          <span style={{ flex: 1, fontSize: 12, color: "#5A6270" }}>{rp.issue}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: rp.bg, color: rp.c }}>{rp.status}</span>
        </div>
      ))}
    </div>
  );
}

function StockPanel() {
  const rows = [
    { name: "ซานริโอ้ คิตตี้", left: 15 }, { name: "หมีน้ำตาล S", left: 8 },
    { name: "โมจิหมีขาว", left: 30 }, { name: "หมีบราวน์ L", left: 22 },
  ];
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "#8A909A", marginBottom: 12, lineHeight: 1.5 }}>นับสต็อกในห้องสต็อกประจำสาขา แล้วกรอกจำนวนจริง ระบบจะเทียบกับยอดในระบบ</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "11px 13px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ในระบบเหลือ <span className="num" style={{ color: s.left <= 10 ? "#B42318" : "#1A1D21", fontWeight: 700 }}>{s.left}</span> ตัว</div>
            </div>
            <input type="number" inputMode="numeric" placeholder="นับจริง" className="num" style={{ width: 84, fontSize: 14, fontWeight: 700, padding: "9px 11px", border: "1.5px solid #E3E6EA", borderRadius: 10, background: "#fff", textAlign: "center" }} />
          </div>
        ))}
      </div>
      <button type="button" style={{ width: "100%", fontSize: 14, fontWeight: 700, color: "#fff", background: "#4F46E5", border: "none", padding: 13, borderRadius: 12, cursor: "pointer", marginTop: 14 }}>บันทึกผลนับสต็อก</button>
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
      {rows.map((cf) => (
        <div key={cf.code} style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>{cf.code}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 11px", borderRadius: 20, background: cf.ok ? "#E7F4EC" : "#FCF1E2", color: cf.ok ? "#15803D" : "#B45309" }}>{cf.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#6B7280" }}>{cf.note}</div>
          {!cf.ok && (
            <button type="button" style={{ width: "100%", fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#B45309", border: "none", padding: 9, borderRadius: 9, cursor: "pointer", marginTop: 9 }}>ตั้งค่าตู้นี้ตอนนี้</button>
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
  photoRequired: boolean;
  photoBlocks: boolean;
  meterDeferred: boolean;
  toggleDefer: () => void;
  resumed: boolean;
  meterGroupVals: { dollMeterEqual: boolean; coinMeterEqual: boolean };
  recon: ReconData;
  tooHard: boolean;
  configSent: boolean;
  sendConfig: () => void;
  skus: CollectSku[];
  onProduct: (v: string) => void;
  onCategory: (v: string) => void;
  onBack: () => void;
  primary: { label: string; color: string; action: () => void };
  secondary: { label: string; action: () => void } | null;
  pending: boolean;
  primaryDisabled: boolean;
}) {
  const { step, form: f, dispensed, afterFill, photos, meterDeferred, recon, machine } = props;
  const stepIndicator = step <= 5 ? `ขั้นที่ ${step}/5` : "เสร็จ";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* header — กระชับ (back + ชื่อตู้ + ขั้น) ให้เนื้อหาขึ้นถึง ⅓ บน */}
      <div style={{ padding: "4px 18px 10px", borderBottom: "1px solid #EAECEF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <button type="button" onClick={props.onBack} className="co-tap" style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>เก็บเงิน · <span className="num">{machine?.code ?? "—"}</span></div>
            <div style={{ fontSize: 11, color: "#9AA1AB" }}>{props.stepLabel}</div>
          </div>
          <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "4px 10px", borderRadius: 20 }}>{stepIndicator}</span>
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
            <BigInput value={f.left} onChange={props.setNum("left")} />
            <div style={{ marginTop: 10 }}>
              <PhotoSlot label={`ถ่ายรูปสินค้าในตู้ก่อนเติม ${props.photoRequired ? "(บังคับ)" : "(ถ่ายได้-ข้ามได้)"}`} value={photos.before}
                onChange={(url) => props.onPhoto("before", url)}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock" disabled={props.usingDemo} required={props.photoRequired} />
            </div>
            <div style={{ fontSize: 12, color: "#8A909A", display: "flex", alignItems: "center", gap: 7, marginTop: 14 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A909A" strokeWidth="2"><path d="M12 3v6" /><path d="M8 9h8l-1.2 4.2a3 3 0 0 1-2.88 2.18h-.84a3 3 0 0 1-2.88-2.18Z" /><path d="M12 15.5V21" /><path d="M8.5 21h7" /></svg>
              ตุ๊กตาออกจากตู้รอบนี้ <b className="num" style={{ color: "#1A1D21" }}>{dispensed} ตัว</b>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ display: "flex", gap: 9, background: "#EEF0FE", borderRadius: 11, padding: "11px 13px", marginBottom: 16 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" style={{ flex: "0 0 17px", marginTop: 1 }}><path d="M12 5v14M5 12h14" /></svg>
              <span style={{ fontSize: 11.5, color: "#3F3AC0", lineHeight: 1.45 }}>ระบุว่าเติม<b>สินค้าอะไร</b>เข้าไป<b>กี่ตัว</b> แล้วถ่ายรูปยืนยันหลังเติม (รูปที่ 2)</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <FieldLabel>สินค้าที่เติม</FieldLabel>
                <select value={f.product} onChange={(e) => props.onProduct(e.target.value)} style={selectStyle}>
                  {props.skus.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  {props.skus.every((s) => s.name !== f.product) && <option value={f.product}>{f.product}</option>}
                </select>
              </div>
              <div>
                <FieldLabel>เติมเข้าไปกี่ตัว</FieldLabel>
                <BigInput value={f.refill} onChange={props.setNum("refill")} size={18} />
              </div>
              <div style={{ background: "#EEF0FE", borderRadius: 11, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>รวมหลังเติม (ก่อนเติม {f.left} + เติม {f.refill})</span>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, color: "#4F46E5" }}>{afterFill} ตัว</span>
              </div>
              <PhotoSlot label={`ถ่ายรูปสินค้าในตู้หลังเติม ${props.photoRequired ? "(บังคับ)" : "(ถ่ายได้-ข้ามได้)"}`} value={photos.after}
                onChange={(url) => props.onPhoto("after", url)}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="stock_after" disabled={props.usingDemo} required={props.photoRequired} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {props.resumed && (
              <>
                <div style={{ display: "flex", gap: 9, background: "#E7F4EC", border: "1px solid #BFE6CB", borderRadius: 11, padding: "11px 13px", marginBottom: 10 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.2" style={{ flex: "0 0 17px", marginTop: 1 }}><path d="M20 6 9 17l-5-5" /></svg>
                  <span style={{ fontSize: 11.5, color: "#15803D", lineHeight: 1.45 }}>กลับมากรอกมิเตอร์ของตู้ที่<b>เก็บค้างไว้</b> — จำนวนที่นับไว้ยังอยู่ กรอกเลขมิเตอร์ให้ครบเพื่อปิดรอบ</span>
                </div>
                {/* รูปไม่ถูกเก็บใน draft → ต้องถ่ายใหม่ (กันพนักงานเข้าใจผิดว่ารูปยังอยู่) */}
                <div style={{ display: "flex", gap: 9, background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "11px 13px", marginBottom: 12 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 17px", marginTop: 1 }}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></svg>
                  <span style={{ fontSize: 11.5, color: "#7A5510", lineHeight: 1.45 }}>รูปที่ถ่ายไว้ต้องถ่ายใหม่{props.photoRequired ? " (บังคับถ่ายก่อนส่ง)" : ""} — รูปไม่ถูกเก็บตอนพักไว้</span>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 9, background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 11, padding: "11px 13px", marginBottom: 14 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flex: "0 0 17px", marginTop: 1 }}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
              <span style={{ fontSize: 11.5, color: "#7A5510", lineHeight: 1.45 }}>มิเตอร์มี 2 ชุด — <b>เฟือง (บน)</b> และ <b>ดิจิตอล (ล่าง)</b> ต้องขึ้น<b>เท่ากัน</b>เพื่อกันพลาด ถ่ายรูปแต่ละชุด หรือ<b>กดข้าม</b>มากรอกในที่ร่ม</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <MeterGroup title="มิเตอร์ตุ๊กตา" prev={f.dollPrev} equalOk={props.meterGroupVals.dollMeterEqual} deferred={meterDeferred}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} usingDemo={props.usingDemo} photoRequired={props.photoRequired}
                rows={[
                  { label: "เฟือง (บน)", value: f.dollGear, onChange: props.setNum("dollGear"), photo: photos.dollGear, onPhoto: (url) => props.onPhoto("dollGear", url), phase: "prize_meter" },
                  { label: "ดิจิตอล (ล่าง)", value: f.dollDigi, onChange: props.setNum("dollDigi"), photo: photos.dollDigi, onPhoto: (url) => props.onPhoto("dollDigi", url), phase: "prize_meter" },
                ]} />
              <MeterGroup title="มิเตอร์เหรียญ" prev={f.coinPrev} equalOk={props.meterGroupVals.coinMeterEqual} deferred={meterDeferred}
                orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} usingDemo={props.usingDemo} photoRequired={props.photoRequired}
                rows={[
                  { label: "เฟือง (บน)", value: f.coinGear, onChange: props.setNum("coinGear"), photo: photos.coinGear, onPhoto: (url) => props.onPhoto("coinGear", url), phase: "meter_after" },
                  { label: "ดิจิตอล (ล่าง)", value: f.coinDigi, onChange: props.setNum("coinDigi"), photo: photos.coinDigi, onPhoto: (url) => props.onPhoto("coinDigi", url), phase: "meter_after" },
                ]} />
              <button type="button" onClick={props.toggleDefer}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: 11, borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${meterDeferred ? "#F0D8AE" : "#E3E6EA"}`, background: meterDeferred ? "#FCF1E2" : "#fff", color: meterDeferred ? "#B45309" : "#6B7280" }}>
                {meterDeferred ? (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>ข้ามไว้ — จะมากรอกเลขทีหลัง</>
                ) : (
                  "ถ่ายไว้ก่อน · กรอกเลขทีหลัง (ในที่ร่ม)"
                )}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <FieldLabel>เงินสดที่นับได้จริง (บาท)</FieldLabel>
              <BigInput value={f.cash} onChange={props.setNum("cash")} />
              <div style={{ marginTop: 10 }}>
                <PhotoSlot label={`ถ่ายรูปเงินสด ${props.photoRequired ? "(บังคับ)" : "(ถ่ายได้-ข้ามได้)"}`} value={photos.cash}
                  onChange={(url) => props.onPhoto("cash", url)}
                  orgId={props.orgId} machineCode={machine?.code ?? ""} eventScopeId={props.eventScopeId} phase="cash" disabled={props.usingDemo} required={props.photoRequired} />
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
                  <BigInput value={f.price} onChange={props.setNum("price")} size={16} />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          meterDeferred ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "24px 8px" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#FCF1E2", color: "#B45309", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>ยังกรอกเลขมิเตอร์ไม่ครบ</div>
              <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, maxWidth: 250 }}>ถ่ายรูปไว้แล้ว — ระบบจะกระทบยอดให้ทันทีที่กรอกเลขมิเตอร์ตุ๊กตาและเหรียญครบ</div>
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
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{recon.allMatch ? "ยอดตรงกันทั้งหมด" : "พบยอดไม่ตรง"}</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>{recon.allMatch ? "มิเตอร์ เงินสด และตุ๊กตา สอดคล้องกัน" : "กรุณาตรวจสอบและระบุเหตุผลก่อนส่ง"}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                <ReconRow title="มิเตอร์เฟือง = ดิจิตอล" a={`ตุ๊กตา ${props.meterGroupVals.dollMeterEqual ? "ตรง" : "ต่างกัน"}`} b={`เหรียญ ${props.meterGroupVals.coinMeterEqual ? "ตรง" : "ต่างกัน"}`} ok={recon.meterEqualOk} />
                <ReconRow title="มิเตอร์ตุ๊กตา ↔ ตุ๊กตาที่หาย" a={`มิเตอร์เพิ่ม ${recon.dollDelta} ครั้ง`} b={`ตุ๊กตาหาย ${dispensed} ตัว`} ok={recon.dollMatch} />
                <ReconRow title="เงินสด ↔ มิเตอร์เหรียญ" a={`นับได้ ฿${f.cash}`} b={`มิเตอร์ควรได้ ฿${recon.expectedCash}`} ok={recon.cashMatch} />
              </div>

              {props.tooHard && (
                <div style={{ marginTop: 14, background: "#FCF1E2", border: "1px solid #F0D8AE", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#7A5510" }}>ตู้นี้อาจตั้งยากเกินไป</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#7A5510", lineHeight: 1.5, marginBottom: 11 }}>เก็บเงินได้ <b className="num">฿{f.cash}</b> แต่ตุ๊กตาออก <b>0 ตัว</b> เสี่ยงเสียลูกค้า ต้องการเสนอปรับความแรงการคีบไหม?</div>
                  {props.configSent ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "#15803D", background: "#E7F4EC", borderRadius: 10, padding: "11px 14px" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>ส่งคำขอตั้งค่าแล้ว · สถานะ “รอตรวจ”
                    </div>
                  ) : (
                    <button type="button" onClick={props.sendConfig} style={{ width: "100%", fontSize: 13, fontWeight: 600, color: "#fff", background: "#B45309", border: "none", padding: 11, borderRadius: 10, cursor: "pointer" }}>เสนอตั้งค่าตู้ใหม่ (ส่งให้เจ้าของตรวจ)</button>
                  )}
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
                <div className="num" style={{ fontSize: 19, fontWeight: 700, color: "#15803D" }}>฿{f.cash.toLocaleString("en-US")}</div>
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
  { key: "stock", label: "เช็คสต็อก", d: ["m7.5 4.27 9 5.15", "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5M12 22V12"] },
  { key: "config", label: "ตั้งค่าตู้", d: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6M9 8h6M17 16h6"] },
];

function FieldLabel({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <label style={{ fontSize: small ? 12 : 12.5, fontWeight: 600, color: "#454B54", display: "block", marginBottom: small ? 5 : 6 }}>{children}</label>;
}

const selectStyle = { width: "100%", fontSize: 15, fontWeight: 600, padding: "12px 13px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff", cursor: "pointer" } as const;

function BigInput({ value, onChange, size = 20 }: { value: number; onChange: (v: string) => void; size?: number }) {
  return (
    <input type="number" inputMode="numeric" pattern="[0-9]*" value={value === 0 ? "" : String(value)} placeholder="0"
      onChange={(e) => onChange(e.target.value)} className="num"
      style={{ width: "100%", fontSize: size, fontWeight: 700, padding: "13px 14px", border: "1.5px solid #E3E6EA", borderRadius: 11, background: "#fff" }} />
  );
}

type Phase = "meter_before" | "cash" | "meter_after" | "stock" | "prize_meter" | "stock_after";

/**
 * Optional photo slot — wraps the REAL <PhotoCaptureButton> (1-tap camera → R2 url).
 * Skipping is fine (value stays ""); shows a soft "ถ่ายได้-ข้ามได้" hint, never blocks.
 * In demo preview (no real session/upload backend) we render a disabled informational box.
 */
function PhotoSlot({ label, value, onChange, orgId, machineCode, eventScopeId, phase, disabled, required }: {
  label: string; value: string; onChange: (url: string) => void;
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
      <PhotoCaptureButton label={label} value={value} onChange={onChange}
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
  label: string; value: number; onChange: (v: string) => void;
  photo: string; onPhoto: (url: string) => void; phase: Phase;
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
                <input type="number" inputMode="numeric" value={r.value === 0 ? "" : String(r.value)} placeholder="เลขมิเตอร์" disabled={deferred}
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
                  value={r.photo} onChange={r.onPhoto}
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

function ReconRow({ title, a, b, ok }: { title: string; a: string; b: string; ok: boolean }) {
  return (
    <div style={{ border: `1px solid ${ok ? "#CDE9D7" : "#F3D4D0"}`, background: ok ? "#F2FAF5" : "#FDF3F2", borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: ok ? "#15803D" : "#B42318" }}>
          {ok ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
          )}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: ok ? "#15803D" : "#B42318" }}>{ok ? "ตรงกัน" : "ไม่ตรง"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5A6270" }}>
        <span>{a}</span><span style={{ color: "#C2C7CF" }}>↔</span><span>{b}</span>
      </div>
    </div>
  );
}

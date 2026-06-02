"use client";
// ClawFleet v2 — GROUP-scoped staff collection (anti-fraud core · 2026-05-31).
// Flow: เลือกสาขา → เลือกกลุ่ม → [ตู้แลก (ถ้า TOKEN) + ตู้คีบทุกตู้] → ปิดกลุ่ม → ผลตรวจ 3 ทาง.
// Restores the Branch > Group > Machine model so the Postgres token cross-check fires.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startGroupSession,
  submitBranchEvent,
  submitExchangerEvent,
  closeGroupSession,
} from "@/lib/clawfleet/v2-actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import { FLAG_LABEL_TH, type AnomalyFlag } from "@/lib/clawfleet/types";
import type {
  GroupCollectBranch,
  CollectGroup,
  GroupMachine,
  CollectSku,
} from "@/lib/clawfleet/v2-group-data";

const CASH_PER_PLAY = 10; // ฿/ครั้ง (กลุ่มเงินสด)

type Props = { orgId: string; branches: GroupCollectBranch[]; skus: CollectSku[] };

type ClawForm = {
  stockBefore: string;
  coinMeterAfter: string;
  dollMeterAfter: string;
  cashCounted: string;
  refillProductId: string;
  refillQty: string;
  stockAfter: string;
  notes: string;
  photoStockBeforeUrl: string;
  photoCoinMeterUrl: string;
  photoPrizeMeterUrl: string;
  photoCashUrl: string;
  photoStockAfterUrl: string;
};

const emptyClaw = (refillProductId: string): ClawForm => ({
  stockBefore: "", coinMeterAfter: "", dollMeterAfter: "", cashCounted: "",
  refillProductId, refillQty: "0", stockAfter: "", notes: "",
  photoStockBeforeUrl: "", photoCoinMeterUrl: "", photoPrizeMeterUrl: "",
  photoCashUrl: "", photoStockAfterUrl: "",
});

type ExForm = {
  coinMeterAfter: string;
  cashCounted: string; // baht (สด+โอน รวม · MVP)
  promoCoins: string;
  notes: string;
  photoCoinMeterUrl: string;
  photoCashUrl: string;
  photoTokenTrayUrl: string;
};
const emptyEx = (): ExForm => ({
  coinMeterAfter: "", cashCounted: "", promoCoins: "0", notes: "",
  photoCoinMeterUrl: "", photoCashUrl: "", photoTokenTrayUrl: "",
});

export function CollectGroupClient({ orgId, branches, skus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string>("");
  const [collected, setCollected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"exchanger" | "claw" | null>(null);
  const [activeClawId, setActiveClawId] = useState<string | null>(null);
  const [claw, setClaw] = useState<ClawForm>(() => emptyClaw(skus[0]?.id ?? ""));
  const [ex, setEx] = useState<ExForm>(() => emptyEx());
  const [closeResult, setCloseResult] = useState<{ status: string; flags: string[] } | null>(null);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) ?? null, [branches, branchId]);
  const group = useMemo(
    () => branch?.groups.find((g) => g.id === groupId) ?? null,
    [branch, groupId],
  );
  const activeClaw = useMemo(
    () => group?.claws.find((m) => m.id === activeClawId) ?? null,
    [group, activeClawId],
  );

  // ---------- branch ----------
  function backToBranches() {
    setBranchId(null); setGroupId(null); setSessionId(null);
    setView(null); setActiveClawId(null); setCloseResult(null);
    router.refresh();
  }
  function backToGroups() {
    setGroupId(null); setSessionId(null); setView(null);
    setActiveClawId(null); setCloseResult(null);
  }

  // ---------- group ----------
  function openGroup(g: CollectGroup) {
    setError(null);
    startTransition(async () => {
      const r = await startGroupSession({ groupId: g.id });
      if (!r.ok) { setError(r.error); return; }
      setGroupId(g.id);
      setSessionId(r.data.id);
      setSessionCode(r.data.code);
      const open = branch?.openByGroupId[g.id];
      setCollected(new Set(open?.collectedMachineIds ?? []));
      setCloseResult(null);
    });
  }

  // ---------- exchanger ----------
  const exReady =
    ex.coinMeterAfter !== "" && ex.cashCounted !== "" &&
    !!ex.photoCoinMeterUrl && !!ex.photoCashUrl && !!ex.photoTokenTrayUrl;

  function submitEx() {
    if (!sessionId || !group?.exchanger) return;
    setError(null);
    startTransition(async () => {
      const r = await submitExchangerEvent({
        sessionId,
        machineId: group.exchanger!.id,
        coinMeterAfter: Number(ex.coinMeterAfter),
        cashCountedCents: Math.round((Number(ex.cashCounted) || 0) * 100),
        promoCoinsDispensed: Number(ex.promoCoins) || 0,
        photoCoinMeterUrl: ex.photoCoinMeterUrl,
        photoCashUrl: ex.photoCashUrl,
        photoTokenTrayUrl: ex.photoTokenTrayUrl,
        notes: ex.notes || undefined,
      });
      if (!r.ok) { setError(r.error); return; }
      setCollected((p) => new Set(p).add(group.exchanger!.id));
      setEx(emptyEx());
      setView(null);
    });
  }

  // ---------- claw ----------
  function openClaw(m: GroupMachine) {
    setError(null);
    setClaw(emptyClaw(skus[0]?.id ?? ""));
    setActiveClawId(m.id);
    setView("claw");
  }
  const setC = (k: keyof ClawForm, v: string) => setClaw((s) => ({ ...s, [k]: v }));

  const isToken = group?.type === "TOKEN";

  const clawCalc = useMemo(() => {
    if (!activeClaw) return null;
    const coinsDelta = (Number(claw.coinMeterAfter) || 0) - activeClaw.lastCoinMeter;
    const expectedBaht = Math.max(0, coinsDelta) * CASH_PER_PLAY;
    const cashVar = (Number(claw.cashCounted) || 0) - expectedBaht;
    const dollMeterDelta = (Number(claw.dollMeterAfter) || 0) - activeClaw.lastDollMeter;
    const physicalOut =
      (Number(claw.stockBefore) || 0) + (Number(claw.refillQty) || 0) - (Number(claw.stockAfter) || 0);
    const prizeVar = dollMeterDelta - physicalOut;
    return { coinsDelta, expectedBaht, cashVar, dollMeterDelta, physicalOut, prizeVar };
  }, [claw, activeClaw]);

  const clawPhotosReady =
    !!claw.photoStockBeforeUrl && !!claw.photoCoinMeterUrl && !!claw.photoPrizeMeterUrl &&
    !!claw.photoCashUrl && !!claw.photoStockAfterUrl;
  const clawNumbersReady =
    claw.stockBefore !== "" && claw.coinMeterAfter !== "" && claw.dollMeterAfter !== "" &&
    claw.stockAfter !== "" && (isToken || claw.cashCounted !== "");

  function submitClaw() {
    if (!sessionId || !activeClaw) return;
    setError(null);
    startTransition(async () => {
      const refillQty = Number(claw.refillQty) || 0;
      const r = await submitBranchEvent({
        sessionId,
        machineId: activeClaw.id,
        coinMeterAfter: Number(claw.coinMeterAfter),
        dollMeterAfter: Number(claw.dollMeterAfter),
        cashCountedCents: isToken ? 0 : Math.round((Number(claw.cashCounted) || 0) * 100),
        stockBefore: Number(claw.stockBefore),
        refillQty,
        stockAfter: Number(claw.stockAfter),
        refillProductId: refillQty > 0 && claw.refillProductId ? claw.refillProductId : undefined,
        photoCoinMeterUrl: claw.photoCoinMeterUrl,
        photoPrizeMeterUrl: claw.photoPrizeMeterUrl,
        photoStockBeforeUrl: claw.photoStockBeforeUrl,
        photoStockAfterUrl: claw.photoStockAfterUrl,
        photoCashUrl: claw.photoCashUrl,
        notes: claw.notes || undefined,
      });
      if (!r.ok) { setError(r.error); return; }
      setCollected((p) => new Set(p).add(activeClaw.id));
      setActiveClawId(null);
      setView(null);
    });
  }

  // ---------- close ----------
  function closeRound() {
    if (!sessionId) return;
    setError(null);
    startTransition(async () => {
      const r = await closeGroupSession({ sessionId });
      if (!r.ok) { setError(r.error); return; }
      setCloseResult(r.data);
    });
  }

  // group completeness
  const exDone = group?.exchanger ? collected.has(group.exchanger.id) : true;
  const clawsDone = group ? group.claws.filter((c) => collected.has(c.id)).length : 0;
  const totalClaws = group?.claws.length ?? 0;
  const allDone = exDone && clawsDone >= totalClaws && totalClaws > 0;

  // ================= RENDER =================
  return (
    <div className="mx-auto max-w-md px-4 py-5">
      {error && (
        <div className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {/* ---- BRANCH PICKER ---- */}
      {!branch && (
        <>
          <h1 className="text-xl font-bold text-zinc-900">เริ่มรอบเก็บเงิน</h1>
          <p className="mb-4 text-sm text-zinc-500">เลือกสาขาที่คุณรับผิดชอบ</p>
          {branches.length === 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
              ยังไม่มีสาขาตู้คีบที่คุณเข้าถึงได้ · ติดต่อผู้ดูแล
            </div>
          )}
          <div className="space-y-2">
            {branches.map((b) => (
              <button key={b.id} type="button" disabled={pending} onClick={() => setBranchId(b.id)}
                className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-blue-400 disabled:opacity-60">
                <div>
                  <div className="font-semibold text-zinc-900">{b.name}</div>
                  <div className="text-xs text-zinc-500">{b.area} · {b.code} · {b.groups.length} กลุ่ม</div>
                </div>
                <span className="text-zinc-400">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- GROUP PICKER ---- */}
      {branch && !group && (
        <>
          <button onClick={backToBranches} className="mb-2 min-h-11 text-sm text-zinc-500">← เปลี่ยนสาขา</button>
          <h1 className="text-xl font-bold text-zinc-900">{branch.name}</h1>
          <p className="mb-3 text-sm text-zinc-500">เลือกกลุ่มตู้ที่จะเก็บ</p>
          {branch.groups.length === 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
              สาขานี้ยังไม่มีกลุ่มตู้ · ตั้งค่ากลุ่มที่หน้า Setup
            </div>
          )}
          <div className="space-y-2">
            {branch.groups.map((g) => {
              const open = branch.openByGroupId[g.id];
              const machineCount = g.claws.length + (g.exchanger ? 1 : 0);
              return (
                <button key={g.id} type="button" disabled={pending} onClick={() => openGroup(g)}
                  className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-blue-400 disabled:opacity-60">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900">{g.name}</span>
                      <TypeChip type={g.type} />
                    </div>
                    <div className="text-xs text-zinc-500">
                      {g.exchanger ? "ตู้แลก + " : ""}คีบ {g.claws.length} ตู้ · รวม {machineCount}
                    </div>
                  </div>
                  {open ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">ทำต่อ →</span>
                  ) : (
                    <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">เริ่ม →</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ---- GROUP WORKSPACE ---- */}
      {branch && group && view === null && !closeResult && (
        <>
          <button onClick={backToGroups} className="mb-2 min-h-11 text-sm text-zinc-500">← เปลี่ยนกลุ่ม</button>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900">{group.name}</h1>
            <TypeChip type={group.type} />
          </div>
          <p className="mb-3 text-sm text-zinc-500">
            {sessionCode} · {group.exchanger ? `ตู้แลก ${exDone ? "✓" : "รอ"} · ` : ""}คีบ {clawsDone}/{totalClaws}
          </p>

          {/* exchanger card (Type B) */}
          {group.exchanger && (
            <section className="mb-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="mb-1 text-xs font-semibold text-indigo-700">ตู้แลก (EXCHANGER) · เงินจริงของกลุ่ม</div>
              <button type="button" onClick={() => setView("exchanger")} disabled={pending}
                className="flex w-full items-center justify-between text-left">
                <div>
                  <div className="font-semibold text-zinc-900">#{group.exchanger.code}</div>
                  <div className="text-xs text-zinc-500">มิเตอร์ token + เงินที่เก็บได้</div>
                </div>
                {exDone ? (
                  <span className="text-sm font-semibold text-emerald-600">✓ เสร็จ</span>
                ) : (
                  <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white">เก็บ →</span>
                )}
              </button>
            </section>
          )}

          {/* claw list */}
          <div className="space-y-2">
            {group.claws.map((m, i) => {
              const done = collected.has(m.id);
              return (
                <button key={m.id} type="button" onClick={() => !done && openClaw(m)} disabled={done || pending}
                  className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${
                    done ? "border-emerald-200 bg-emerald-50/50" : "border-zinc-200 bg-white hover:border-blue-400"
                  }`}>
                  <div>
                    <div className="font-semibold text-zinc-900">คีบ {i + 1} · {m.name}</div>
                    <div className="text-xs text-zinc-500">{m.code}</div>
                  </div>
                  {done ? (
                    <span className="text-sm font-semibold text-emerald-600">✓ เสร็จ</span>
                  ) : (
                    <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">กรอก →</span>
                  )}
                </button>
              );
            })}
          </div>

          <button type="button" onClick={closeRound} disabled={pending || !allDone}
            className="mt-5 w-full rounded-xl bg-zinc-900 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-800 disabled:bg-zinc-300">
            {pending ? "กำลังปิดกลุ่ม..." : !allDone ? "เก็บให้ครบก่อนปิดกลุ่ม" : "ปิดกลุ่ม + ตรวจสอบ 3 ทาง"}
          </button>
        </>
      )}

      {/* ---- EXCHANGER STEP ---- */}
      {branch && group?.exchanger && view === "exchanger" && (
        <>
          <button onClick={() => setView(null)} className="mb-2 min-h-11 text-sm text-zinc-500">← กลับกลุ่ม</button>
          <h1 className="text-lg font-bold text-zinc-900">ตู้แลก #{group.exchanger.code}</h1>
          <p className="mb-3 text-xs text-indigo-600">🎯 ตู้นี้คือเงินจริงของกลุ่ม</p>

          <FormSection title="1 · มิเตอร์ TOKEN จ่ายออก">
            <RefRow label="รอบก่อน (ระบบ)" value={group.exchanger.lastCoinMeter.toLocaleString()} />
            <NumField label="มิเตอร์ token วันนี้ (พิมพ์เลข)" value={ex.coinMeterAfter}
              onChange={(v) => setEx((s) => ({ ...s, coinMeterAfter: v }))} big />
            {ex.coinMeterAfter !== "" && (
              <div className="text-xs text-zinc-600">
                แตก token ออก{" "}
                <strong className="text-zinc-900">
                  {Math.max(0, (Number(ex.coinMeterAfter) || 0) - group.exchanger.lastCoinMeter).toLocaleString()}
                </strong>{" "}
                เหรียญ (ต้องตรงกับตู้คีบรับเข้ารวม)
              </div>
            )}
            <PhotoCaptureButton label="ถ่ายมิเตอร์ token" value={ex.photoCoinMeterUrl}
              onChange={(url) => setEx((s) => ({ ...s, photoCoinMeterUrl: url }))}
              orgId={orgId} machineCode={group.exchanger.code}
              eventScopeId={`${sessionId}-${group.exchanger.id}`} phase="meter_after" />
          </FormSection>

          <FormSection title="2 · เงินที่เก็บได้จริง (สด+โอน)">
            <NumField label="เงินที่เก็บได้ (บาท)" value={ex.cashCounted}
              onChange={(v) => setEx((s) => ({ ...s, cashCounted: v }))} suffix="บาท" big />
            <PhotoCaptureButton label="ถ่ายเงินสด/สลิป" value={ex.photoCashUrl}
              onChange={(url) => setEx((s) => ({ ...s, photoCashUrl: url }))}
              orgId={orgId} machineCode={group.exchanger.code}
              eventScopeId={`${sessionId}-${group.exchanger.id}`} phase="cash" />
            <PhotoCaptureButton label="ถ่ายถาด token" value={ex.photoTokenTrayUrl}
              onChange={(url) => setEx((s) => ({ ...s, photoTokenTrayUrl: url }))}
              orgId={orgId} machineCode={group.exchanger.code}
              eventScopeId={`${sessionId}-${group.exchanger.id}`} phase="stock" />
          </FormSection>

          <FormSection title="หมายเหตุ (ถ้ามี)">
            <textarea value={ex.notes} onChange={(e) => setEx((s) => ({ ...s, notes: e.target.value }))}
              rows={2} placeholder="เช่น ตู้แลกมิเตอร์ค้าง"
              className="w-full rounded-xl border border-zinc-300 p-3 text-sm focus:border-blue-500 focus:outline-none" />
          </FormSection>

          <button type="button" onClick={submitEx} disabled={!exReady || pending}
            className="sticky bottom-3 z-10 w-full rounded-xl bg-indigo-600 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-indigo-700 disabled:bg-zinc-300">
            {pending ? "กำลังบันทึก..." : !exReady ? "กรอกเลข + ถ่าย 3 รูปให้ครบ" : "บันทึกตู้แลก →"}
          </button>
        </>
      )}

      {/* ---- CLAW STEP ---- */}
      {branch && group && activeClaw && view === "claw" && (
        <>
          <button onClick={() => { setActiveClawId(null); setView(null); }} className="mb-2 min-h-11 text-sm text-zinc-500">← กลับกลุ่ม</button>
          <h1 className="text-lg font-bold text-zinc-900">{activeClaw.name}</h1>
          <p className="mb-3 text-xs text-zinc-500">{activeClaw.code}</p>

          <FormSection title="1 · นับตุ๊กตาก่อนเติม">
            <RefRow label="รอบก่อน (ระบบ)" value={`${activeClaw.lastDollStock} ตัว`} />
            <NumField label="ตุ๊กตาในตู้ตอนนี้ (นับจริง)" value={claw.stockBefore} onChange={(v) => setC("stockBefore", v)} suffix="ตัว" big />
            <PhotoCaptureButton label="ถ่ายตุ๊กตาก่อนเติม" value={claw.photoStockBeforeUrl}
              onChange={(url) => setC("photoStockBeforeUrl", url)} orgId={orgId} machineCode={activeClaw.code}
              eventScopeId={`${sessionId}-${activeClaw.id}`} phase="stock" />
          </FormSection>

          <FormSection title={isToken ? "2 · มิเตอร์ token + ตุ๊กตา" : "2 · มิเตอร์ + เก็บเงิน"}>
            <RefRow label={isToken ? "มิเตอร์ token รอบก่อน" : "มิเตอร์เหรียญ รอบก่อน"} value={activeClaw.lastCoinMeter.toLocaleString()} />
            <NumField label={isToken ? "มิเตอร์ token วันนี้" : "มิเตอร์เหรียญวันนี้"} value={claw.coinMeterAfter} onChange={(v) => setC("coinMeterAfter", v)} big />
            <PhotoCaptureButton label="ถ่ายมิเตอร์เหรียญ/token" value={claw.photoCoinMeterUrl}
              onChange={(url) => setC("photoCoinMeterUrl", url)} orgId={orgId} machineCode={activeClaw.code}
              eventScopeId={`${sessionId}-${activeClaw.id}`} phase="meter_after" />
            {claw.coinMeterAfter !== "" && clawCalc && !isToken && (
              <div className="text-xs text-zinc-600">
                +{clawCalc.coinsDelta.toLocaleString()} ครั้ง × ฿{CASH_PER_PLAY} = ควรมีเงิน{" "}
                <strong className="text-zinc-900">฿{clawCalc.expectedBaht.toLocaleString()}</strong>
              </div>
            )}
            {claw.coinMeterAfter !== "" && clawCalc && isToken && (
              <div className="text-xs text-zinc-600">
                รับ token เข้า <strong className="text-zinc-900">{Math.max(0, clawCalc.coinsDelta).toLocaleString()}</strong> เหรียญ
              </div>
            )}
            <RefRow label="มิเตอร์ตุ๊กตา รอบก่อน" value={activeClaw.lastDollMeter.toLocaleString()} />
            <NumField label="มิเตอร์ตุ๊กตาวันนี้ (พิมพ์เลข)" value={claw.dollMeterAfter} onChange={(v) => setC("dollMeterAfter", v)} />
            <PhotoCaptureButton label="ถ่ายมิเตอร์ตุ๊กตา" value={claw.photoPrizeMeterUrl}
              onChange={(url) => setC("photoPrizeMeterUrl", url)} orgId={orgId} machineCode={activeClaw.code}
              eventScopeId={`${sessionId}-${activeClaw.id}`} phase="prize_meter" />
            {isToken ? (
              <RefRow label="เงินสดในตู้คีบ" value="— ไม่มี (กลุ่ม token)" />
            ) : (
              <>
                <NumField label="เงินสดในถาด (นับจริง)" value={claw.cashCounted} onChange={(v) => setC("cashCounted", v)} suffix="บาท" big />
                {claw.cashCounted !== "" && claw.coinMeterAfter !== "" && clawCalc && <VarianceBadge baht={clawCalc.cashVar} />}
              </>
            )}
            <PhotoCaptureButton label="ถ่ายเงินสด" value={claw.photoCashUrl}
              onChange={(url) => setC("photoCashUrl", url)} orgId={orgId} machineCode={activeClaw.code}
              eventScopeId={`${sessionId}-${activeClaw.id}`} phase="cash" />
          </FormSection>

          <FormSection title="3 · เติมตุ๊กตา + นับหลังเติม">
            <label className="block">
              <span className="block text-xs font-medium text-zinc-600">เติมจาก SKU (คลังสาขา)</span>
              <select value={claw.refillProductId} onChange={(e) => setC("refillProductId", e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm">
                {skus.length === 0 && <option value="">— ไม่มี SKU —</option>}
                {skus.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.sku})</option>)}
              </select>
            </label>
            <NumField label="เติมกี่ตัว" value={claw.refillQty} onChange={(v) => setC("refillQty", v)} suffix="ตัว" />
            <NumField label="ตุ๊กตาในตู้ หลังเติม (นับจริง)" value={claw.stockAfter} onChange={(v) => setC("stockAfter", v)} suffix="ตัว" big />
            <PhotoCaptureButton label="ถ่ายตุ๊กตาหลังเติม" value={claw.photoStockAfterUrl}
              onChange={(url) => setC("photoStockAfterUrl", url)} orgId={orgId} machineCode={activeClaw.code}
              eventScopeId={`${sessionId}-${activeClaw.id}`} phase="stock_after" />
            {clawNumbersReady && clawCalc && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-600">
                มิเตอร์ตุ๊กตาแจก <strong>{clawCalc.dollMeterDelta}</strong> ตัว · นับได้หาย <strong>{clawCalc.physicalOut}</strong> ตัว
                {clawCalc.prizeVar !== 0 && (
                  <span className="ml-1 font-semibold text-amber-700">· ต่าง {clawCalc.prizeVar > 0 ? "+" : ""}{clawCalc.prizeVar} (ตรวจซ้ำ)</span>
                )}
              </div>
            )}
          </FormSection>

          <FormSection title="หมายเหตุ (ถ้ามี)">
            <textarea value={claw.notes} onChange={(e) => setC("notes", e.target.value)} rows={2}
              placeholder="เช่น ตู้ 06 มิเตอร์ไม่ขึ้น · น่าจะเสีย"
              className="w-full rounded-xl border border-zinc-300 p-3 text-sm focus:border-blue-500 focus:outline-none" />
          </FormSection>

          <button type="button" onClick={submitClaw} disabled={!clawPhotosReady || !clawNumbersReady || pending}
            className="sticky bottom-3 z-10 w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-zinc-300">
            {pending ? "กำลังบันทึก..." : !clawNumbersReady ? "กรอกตัวเลขให้ครบ" : !clawPhotosReady ? "ถ่ายรูปให้ครบ 5 รูป" : "บันทึก & ตู้ถัดไป →"}
          </button>
        </>
      )}

      {/* ---- CLOSE RESULT ---- */}
      {branch && closeResult && (
        <div className="pt-6 text-center">
          <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
            closeResult.status === "CLOSED" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
          }`}>
            {closeResult.status === "CLOSED" ? "✓" : "⚑"}
          </div>
          <h1 className="text-xl font-bold text-zinc-900">
            {closeResult.status === "CLOSED" ? "ปิดกลุ่มเรียบร้อย" : "ส่งให้เจ้าของตรวจ"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {closeResult.status === "CLOSED" ? "ตรวจสอบผ่านทุกทาง · เข้ารายงานแล้ว" : "พบความผิดปกติ · เจ้าของจะ review รอบนี้"}
          </p>
          {closeResult.flags.length > 0 && (
            <div className="mx-auto mt-3 max-w-xs space-y-1 text-left">
              {closeResult.flags.map((f) => (
                <div key={f} className={`rounded-lg px-3 py-1.5 text-xs ${
                  f === "COIN_GROUP_MISMATCH" ? "bg-rose-50 font-semibold text-rose-800" : "bg-amber-50 text-amber-800"
                }`}>
                  ⚑ {FLAG_LABEL_TH[f as AnomalyFlag] ?? f}
                </div>
              ))}
            </div>
          )}
          <button onClick={backToGroups} className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white">
            กลุ่มถัดไป
          </button>
        </div>
      )}
    </div>
  );
}

function TypeChip({ type }: { type: "TOKEN" | "CASH" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
      type === "TOKEN" ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-600"
    }`}>
      {type === "TOKEN" ? "TOKEN" : "เงินสด"}
    </span>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold text-zinc-700">{value}</span>
    </div>
  );
}

function NumField({ label, value, onChange, suffix, big }: {
  label: string; value: string; onChange: (v: string) => void; suffix?: string; big?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        <input inputMode="numeric" pattern="[0-9]*" value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          className={`w-full appearance-none border-0 bg-transparent py-3 text-zinc-900 focus:outline-none ${big ? "text-2xl font-bold" : "text-base font-semibold"}`} />
        {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}

function VarianceBadge({ baht }: { baht: number }) {
  const abs = Math.abs(baht);
  const light: "ok" | "warn" | "danger" = abs <= 20 ? "ok" : abs <= 100 ? "warn" : "danger";
  const cls = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[light];
  const icon = light === "ok" ? "🟢" : light === "warn" ? "🟡" : "🔴";
  const word = baht > 0 ? "เกิน" : baht < 0 ? "ขาด" : "ตรง";
  return (
    <div className={`rounded-xl border p-2.5 text-sm ${cls}`}>
      {icon} {word}{baht !== 0 && <span className="ml-1 font-bold">฿{abs.toLocaleString()}</span>}
    </div>
  );
}

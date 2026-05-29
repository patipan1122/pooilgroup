"use client";
// ClawFleet v2 — staff collection wizard (real, wired to branch actions).
// Flow: เลือกสาขา → [ต่อตู้: นับก่อน · มิเตอร์+เงิน · เติม+นับหลัง] → ปิดรอบ (cross-check).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startBranchSession,
  submitBranchEvent,
  closeBranchSession,
} from "@/lib/clawfleet/v2-actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";
import type { CollectBranch, CollectMachine, CollectSku } from "@/lib/clawfleet/v2-collect-data";

const CASH_PER_PLAY = 10; // ฿/ครั้ง

type Props = { orgId: string; branches: CollectBranch[]; skus: CollectSku[] };

type MachineForm = {
  stockBefore: string;
  coinMeterAfter: string;
  dollMeterAfter: string;
  cashCounted: string; // baht
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

const emptyForm = (refillProductId: string): MachineForm => ({
  stockBefore: "",
  coinMeterAfter: "",
  dollMeterAfter: "",
  cashCounted: "",
  refillProductId,
  refillQty: "0",
  stockAfter: "",
  notes: "",
  photoStockBeforeUrl: "",
  photoCoinMeterUrl: "",
  photoPrizeMeterUrl: "",
  photoCashUrl: "",
  photoStockAfterUrl: "",
});

export function CollectClient({ orgId, branches, skus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string>("");
  const [collected, setCollected] = useState<Set<string>>(new Set());
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [form, setForm] = useState<MachineForm>(() => emptyForm(skus[0]?.id ?? ""));
  const [closeResult, setCloseResult] = useState<{ status: string; flags: string[] } | null>(null);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) ?? null, [branches, branchId]);
  const activeMachine = useMemo(
    () => branch?.machines.find((m) => m.id === activeMachineId) ?? null,
    [branch, activeMachineId],
  );

  // ---------- step: pick branch / start ----------
  function openBranch(b: CollectBranch) {
    setError(null);
    startTransition(async () => {
      const r = await startBranchSession({ branchId: b.id });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBranchId(b.id);
      setSessionId(r.data.id);
      setSessionCode(r.data.code);
      setCollected(new Set(b.collectedMachineIds));
      setCloseResult(null);
    });
  }

  function backToBranches() {
    setBranchId(null);
    setSessionId(null);
    setActiveMachineId(null);
    setCloseResult(null);
    router.refresh();
  }

  // ---------- step: open a machine form ----------
  function openMachine(m: CollectMachine) {
    setError(null);
    setForm(emptyForm(skus[0]?.id ?? ""));
    setActiveMachineId(m.id);
  }

  const setF = (k: keyof MachineForm, v: string) => setForm((s) => ({ ...s, [k]: v }));

  // ---------- derived (live cross-check preview, single machine) ----------
  const calc = useMemo(() => {
    if (!activeMachine) return null;
    const coinAfter = Number(form.coinMeterAfter) || 0;
    const coinsDelta = coinAfter - activeMachine.lastCoinMeter;
    const expectedBaht = Math.max(0, coinsDelta) * CASH_PER_PLAY;
    const cash = Number(form.cashCounted) || 0;
    const cashVar = cash - expectedBaht;
    const dollAfter = Number(form.dollMeterAfter) || 0;
    const dollMeterDelta = dollAfter - activeMachine.lastDollMeter;
    const stockBefore = Number(form.stockBefore) || 0;
    const refill = Number(form.refillQty) || 0;
    const stockAfter = Number(form.stockAfter) || 0;
    const physicalOut = stockBefore + refill - stockAfter;
    const prizeVar = dollMeterDelta - physicalOut;
    return { coinsDelta, expectedBaht, cashVar, dollMeterDelta, physicalOut, prizeVar };
  }, [form, activeMachine]);

  const photosReady =
    !!form.photoStockBeforeUrl &&
    !!form.photoCoinMeterUrl &&
    !!form.photoPrizeMeterUrl &&
    !!form.photoCashUrl &&
    !!form.photoStockAfterUrl;
  const numbersReady =
    form.stockBefore !== "" &&
    form.coinMeterAfter !== "" &&
    form.dollMeterAfter !== "" &&
    form.cashCounted !== "" &&
    form.stockAfter !== "";

  function submitMachine() {
    if (!sessionId || !activeMachine) return;
    setError(null);
    startTransition(async () => {
      const refillQty = Number(form.refillQty) || 0;
      const r = await submitBranchEvent({
        sessionId,
        machineId: activeMachine.id,
        coinMeterAfter: Number(form.coinMeterAfter),
        dollMeterAfter: Number(form.dollMeterAfter),
        cashCountedCents: Math.round((Number(form.cashCounted) || 0) * 100),
        stockBefore: Number(form.stockBefore),
        refillQty,
        stockAfter: Number(form.stockAfter),
        refillProductId: refillQty > 0 && form.refillProductId ? form.refillProductId : undefined,
        photoCoinMeterUrl: form.photoCoinMeterUrl,
        photoPrizeMeterUrl: form.photoPrizeMeterUrl,
        photoStockBeforeUrl: form.photoStockBeforeUrl,
        photoStockAfterUrl: form.photoStockAfterUrl,
        photoCashUrl: form.photoCashUrl,
        notes: form.notes || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCollected((prev) => new Set(prev).add(activeMachine.id));
      setActiveMachineId(null);
    });
  }

  function closeRound() {
    if (!sessionId) return;
    setError(null);
    startTransition(async () => {
      const r = await closeBranchSession({ sessionId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCloseResult(r.data);
    });
  }

  // ================= RENDER =================
  return (
    <div className="mx-auto max-w-md px-4 py-5">
      {error && (
        <div className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
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
              <button
                key={b.id}
                type="button"
                disabled={pending}
                onClick={() => openBranch(b)}
                className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-blue-400 disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold text-zinc-900">{b.name}</div>
                  <div className="text-xs text-zinc-500">
                    {b.area} · {b.code} · {b.machines.length} ตู้
                  </div>
                </div>
                {b.openSessionId ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    ทำต่อ →
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
                    เริ่ม →
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- MACHINE LIST ---- */}
      {branch && !activeMachine && !closeResult && (
        <>
          <button onClick={backToBranches} className="mb-2 text-sm text-zinc-500">
            ← เปลี่ยนสาขา
          </button>
          <h1 className="text-xl font-bold text-zinc-900">{branch.name}</h1>
          <p className="mb-3 text-sm text-zinc-500">
            {sessionCode} · {collected.size}/{branch.machines.length} ตู้
          </p>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{
                width: `${branch.machines.length ? (collected.size / branch.machines.length) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="space-y-2">
            {branch.machines.map((m, i) => {
              const done = collected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => !done && openMachine(m)}
                  disabled={done}
                  className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition ${
                    done
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-zinc-200 bg-white hover:border-blue-400"
                  }`}
                >
                  <div>
                    <div className="font-semibold text-zinc-900">
                      ตู้ {i + 1} · {m.name}
                    </div>
                    <div className="text-xs text-zinc-500">{m.code}</div>
                  </div>
                  {done ? (
                    <span className="text-sm font-semibold text-emerald-600">✓ เสร็จ</span>
                  ) : (
                    <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
                      กรอก →
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={closeRound}
            disabled={pending || collected.size < branch.machines.length || branch.machines.length === 0}
            className="mt-5 w-full rounded-xl bg-zinc-900 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-800 disabled:bg-zinc-300"
          >
            {pending
              ? "กำลังปิดรอบ..."
              : collected.size < branch.machines.length
                ? `เหลืออีก ${branch.machines.length - collected.size} ตู้`
                : "ปิดรอบ + cross-check"}
          </button>
        </>
      )}

      {/* ---- MACHINE FORM ---- */}
      {branch && activeMachine && (
        <>
          <button onClick={() => setActiveMachineId(null)} className="mb-2 text-sm text-zinc-500">
            ← กลับรายการตู้
          </button>
          <h1 className="text-lg font-bold text-zinc-900">{activeMachine.name}</h1>
          <p className="mb-3 text-xs text-zinc-500">{activeMachine.code}</p>

          {/* 1. นับตุ๊กตาก่อนเติม */}
          <FormSection title="1 · นับตุ๊กตาก่อนเติม">
            <RefRow label="รอบก่อน (ระบบ)" value={`${activeMachine.lastDollStock} ตัว`} />
            <NumField label="ตุ๊กตาในตู้ตอนนี้ (นับจริง)" value={form.stockBefore} onChange={(v) => setF("stockBefore", v)} suffix="ตัว" big />
            <PhotoCaptureButton
              label="ถ่ายตุ๊กตาก่อนเติม"
              value={form.photoStockBeforeUrl}
              onChange={(url) => setF("photoStockBeforeUrl", url)}
              orgId={orgId}
              machineCode={activeMachine.code}
              eventScopeId={`${sessionId}-${activeMachine.id}`}
              phase="stock"
            />
          </FormSection>

          {/* 2. มิเตอร์ + เงิน */}
          <FormSection title="2 · มิเตอร์ + เก็บเงิน">
            <RefRow label="มิเตอร์เหรียญ รอบก่อน" value={activeMachine.lastCoinMeter.toLocaleString()} />
            <NumField label="มิเตอร์เหรียญวันนี้ (พิมพ์เลข)" value={form.coinMeterAfter} onChange={(v) => setF("coinMeterAfter", v)} big />
            <PhotoCaptureButton
              label="ถ่ายมิเตอร์เหรียญ"
              value={form.photoCoinMeterUrl}
              onChange={(url) => setF("photoCoinMeterUrl", url)}
              orgId={orgId}
              machineCode={activeMachine.code}
              eventScopeId={`${sessionId}-${activeMachine.id}`}
              phase="meter_after"
            />
            {form.coinMeterAfter !== "" && calc && (
              <div className="text-xs text-zinc-600">
                +{calc.coinsDelta.toLocaleString()} ครั้ง × ฿{CASH_PER_PLAY} = ควรมีเงิน{" "}
                <strong className="text-zinc-900">฿{calc.expectedBaht.toLocaleString()}</strong>
              </div>
            )}
            <RefRow label="มิเตอร์ตุ๊กตา รอบก่อน" value={activeMachine.lastDollMeter.toLocaleString()} />
            <NumField label="มิเตอร์ตุ๊กตาวันนี้ (พิมพ์เลข)" value={form.dollMeterAfter} onChange={(v) => setF("dollMeterAfter", v)} />
            <PhotoCaptureButton
              label="ถ่ายมิเตอร์ตุ๊กตา"
              value={form.photoPrizeMeterUrl}
              onChange={(url) => setF("photoPrizeMeterUrl", url)}
              orgId={orgId}
              machineCode={activeMachine.code}
              eventScopeId={`${sessionId}-${activeMachine.id}`}
              phase="prize_meter"
            />
            <NumField label="เงินสดในถาด (นับจริง)" value={form.cashCounted} onChange={(v) => setF("cashCounted", v)} suffix="บาท" big />
            <PhotoCaptureButton
              label="ถ่ายเงินสด"
              value={form.photoCashUrl}
              onChange={(url) => setF("photoCashUrl", url)}
              orgId={orgId}
              machineCode={activeMachine.code}
              eventScopeId={`${sessionId}-${activeMachine.id}`}
              phase="cash"
            />
            {form.cashCounted !== "" && form.coinMeterAfter !== "" && calc && (
              <VarianceBadge baht={calc.cashVar} />
            )}
          </FormSection>

          {/* 3. เติมตุ๊กตา + นับหลัง */}
          <FormSection title="3 · เติมตุ๊กตา + นับหลังเติม">
            <label className="block">
              <span className="block text-xs font-medium text-zinc-600">เติมจาก SKU (คลังสาขา)</span>
              <select
                value={form.refillProductId}
                onChange={(e) => setF("refillProductId", e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
              >
                {skus.length === 0 && <option value="">— ไม่มี SKU —</option>}
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.sku})
                  </option>
                ))}
              </select>
            </label>
            <NumField label="เติมกี่ตัว" value={form.refillQty} onChange={(v) => setF("refillQty", v)} suffix="ตัว" />
            <NumField label="ตุ๊กตาในตู้ หลังเติม (นับจริง)" value={form.stockAfter} onChange={(v) => setF("stockAfter", v)} suffix="ตัว" big />
            <PhotoCaptureButton
              label="ถ่ายตุ๊กตาหลังเติม"
              value={form.photoStockAfterUrl}
              onChange={(url) => setF("photoStockAfterUrl", url)}
              orgId={orgId}
              machineCode={activeMachine.code}
              eventScopeId={`${sessionId}-${activeMachine.id}`}
              phase="stock_after"
            />
            {numbersReady && calc && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-600">
                มิเตอร์ตุ๊กตาแจก <strong>{calc.dollMeterDelta}</strong> ตัว · นับได้หาย{" "}
                <strong>{calc.physicalOut}</strong> ตัว
                {calc.prizeVar !== 0 && (
                  <span className="ml-1 font-semibold text-amber-700">
                    · ต่าง {calc.prizeVar > 0 ? "+" : ""}
                    {calc.prizeVar} (ตรวจซ้ำ)
                  </span>
                )}
              </div>
            )}
          </FormSection>

          <FormSection title="หมายเหตุ (ถ้ามี)">
            <textarea
              value={form.notes}
              onChange={(e) => setF("notes", e.target.value)}
              rows={2}
              placeholder="เช่น ตู้ 06 มิเตอร์ไม่ขึ้น · น่าจะเสีย"
              className="w-full rounded-xl border border-zinc-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </FormSection>

          <button
            type="button"
            onClick={submitMachine}
            disabled={!photosReady || !numbersReady || pending}
            className="sticky bottom-3 z-10 w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-zinc-300"
          >
            {pending
              ? "กำลังบันทึก..."
              : !numbersReady
                ? "กรอกตัวเลขให้ครบ"
                : !photosReady
                  ? "ถ่ายรูปให้ครบ 5 รูป"
                  : "บันทึก & ตู้ถัดไป →"}
          </button>
        </>
      )}

      {/* ---- CLOSE RESULT ---- */}
      {branch && closeResult && (
        <div className="pt-6 text-center">
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
              closeResult.status === "CLOSED"
                ? "bg-emerald-100 text-emerald-600"
                : "bg-amber-100 text-amber-600"
            }`}
          >
            {closeResult.status === "CLOSED" ? "✓" : "⚑"}
          </div>
          <h1 className="text-xl font-bold text-zinc-900">
            {closeResult.status === "CLOSED" ? "ปิดรอบเรียบร้อย" : "ส่งให้เจ้าของตรวจ"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {closeResult.status === "CLOSED"
              ? "cross-check ผ่าน · เข้ารายงานแล้ว"
              : "พบความผิดปกติ · เจ้าของจะ review รอบนี้"}
          </p>
          {closeResult.flags.length > 0 && (
            <div className="mx-auto mt-3 max-w-xs space-y-1 text-left">
              {closeResult.flags.map((f) => (
                <div key={f} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                  ⚑ {f}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={backToBranches}
            className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white"
          >
            เริ่มรอบใหม่
          </button>
        </div>
      )}
    </div>
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

function NumField({
  label,
  value,
  onChange,
  suffix,
  big,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  big?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-xl border border-zinc-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          className={`w-full appearance-none border-0 bg-transparent py-2.5 text-zinc-900 focus:outline-none ${
            big ? "text-2xl font-bold" : "text-base font-semibold"
          }`}
        />
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
      {icon} {word}
      {baht !== 0 && <span className="ml-1 font-bold">฿{abs.toLocaleString()}</span>}
    </div>
  );
}

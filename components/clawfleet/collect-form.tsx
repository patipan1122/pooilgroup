"use client";
// ClawFleet — collect form (mobile-first · scroll เดียวจบ · กรอก 6/3 ช่อง + 4/3 รูป)
// Real-time delta display · client-side image resize · auto-save (sessionStorage)

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { submitEvent } from "@/lib/clawfleet/actions";
import { PhotoCaptureButton } from "./photo-capture-button";

type Props = {
  sessionId: string;
  sessionCode: string;
  machineId: string;
  machineCode: string;
  machineKind: "CLAW" | "EXCHANGER";
  qrToken: string;
  lastCoinMeter: number;
  lastDollMeter: number;
  lastDollStock: number;
  productName: string | null;
  pricePerPlayCoins: number;
  baseCoinPerBaht: number;
  userId: string;
  orgId: string;
};

type FormState = {
  coinMeterAfter: string;
  cashCounted: string; // in baht (UI) → convert to cents on submit
  dollMeterAfter: string;
  stockBefore: string;
  refillQty: string;
  stockAfter: string;
  promoCoinsDispensed: string;
  notes: string;
  photoMeterBeforeUrl: string;
  photoCashUrl: string;
  photoMeterAfterUrl: string;
  photoStockUrl: string;
};

const initial: FormState = {
  coinMeterAfter: "",
  cashCounted: "",
  dollMeterAfter: "",
  stockBefore: "",
  refillQty: "0",
  stockAfter: "",
  promoCoinsDispensed: "0",
  notes: "",
  photoMeterBeforeUrl: "",
  photoCashUrl: "",
  photoMeterAfterUrl: "",
  photoStockUrl: "",
};

export function CollectForm(p: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const storageKey = `clawfleet:collect:${p.sessionId}:${p.machineCode}`;
  // Restore from sessionStorage (lazy init — runs once, no setState in effect)
  const [state, setState] = useState<FormState>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) return { ...initial, ...JSON.parse(raw) };
    } catch {}
    return initial;
  });
  const [error, setError] = useState<string | null>(null);

  // Persist to sessionStorage on change (write-only effect ok)
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [state, storageKey]);

  const set = (k: keyof FormState, v: string) => setState((s) => ({ ...s, [k]: v }));

  // ===== Derived (real-time delta) =====
  const derived = useMemo(() => {
    const coinAfter = Number(state.coinMeterAfter) || 0;
    const coinsDelta = coinAfter - p.lastCoinMeter;
    // cashPerCoin: CLAW = price × 1000 cents (฿10/coin × pricePerPlay); EXCHANGER = 100/baseCoinPerBaht cents (1 coin = ?฿)
    const cashPerCoinCents =
      p.machineKind === "CLAW"
        ? p.pricePerPlayCoins * 1000
        : Math.round(100 / Math.max(p.baseCoinPerBaht, 0.0001));
    const expectedCents = coinsDelta * cashPerCoinCents;
    const cashCents = Math.round((Number(state.cashCounted) || 0) * 100);
    const varianceCents = cashCents - expectedCents;
    const absVar = Math.abs(varianceCents);
    const cashLight: "ok" | "warn" | "danger" =
      absVar <= 2000 ? "ok" : absVar <= 10000 ? "warn" : "danger";

    const dollAfter = Number(state.dollMeterAfter) || 0;
    const dollsDelta = dollAfter - p.lastDollMeter;
    const stockBefore = Number(state.stockBefore) || 0;
    const refill = Number(state.refillQty) || 0;
    const stockAfter = Number(state.stockAfter) || 0;
    const expectedStockAfter = stockBefore + refill - dollsDelta;
    const stockMath = stockAfter - expectedStockAfter;

    return {
      coinsDelta,
      expectedCents,
      varianceCents,
      cashLight,
      dollsDelta,
      stockMath,
      expectedStockAfter,
    };
  }, [state, p]);

  // ===== Photo F1 check =====
  const photosReady = useMemo(() => {
    if (!state.photoMeterBeforeUrl) return false;
    if (!state.photoCashUrl) return false;
    if (!state.photoMeterAfterUrl) return false;
    if (p.machineKind === "CLAW" && !state.photoStockUrl) return false;
    return true;
  }, [state, p.machineKind]);

  const numbersReady = useMemo(() => {
    if (state.coinMeterAfter === "" || state.cashCounted === "") return false;
    if (p.machineKind === "CLAW") {
      if (
        state.dollMeterAfter === "" ||
        state.stockBefore === "" ||
        state.stockAfter === ""
      )
        return false;
    }
    return true;
  }, [state, p.machineKind]);

  const canSubmit = photosReady && numbersReady && !pending;

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        sessionId: p.sessionId,
        machineId: p.machineId,
        qrToken: p.qrToken,
        coinMeterAfter: Number(state.coinMeterAfter),
        cashCountedCents: Math.round(Number(state.cashCounted) * 100),
        photoMeterBeforeUrl: state.photoMeterBeforeUrl,
        photoCashUrl: state.photoCashUrl,
        photoMeterAfterUrl: state.photoMeterAfterUrl,
        notes: state.notes || undefined,
      };
      if (p.machineKind === "CLAW") {
        payload.dollMeterAfter = Number(state.dollMeterAfter);
        payload.stockBefore = Number(state.stockBefore);
        payload.refillQty = Number(state.refillQty);
        payload.stockAfter = Number(state.stockAfter);
        payload.photoStockUrl = state.photoStockUrl;
      } else {
        payload.promoCoinsDispensed = Number(state.promoCoinsDispensed) || 0;
      }
      const r = await submitEvent(payload);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      router.push(`/clawfleet/sessions/${p.sessionId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-xs text-zinc-500">{p.sessionCode}</div>
        <h1 className="text-xl font-bold text-zinc-900">{p.machineCode}</h1>
        <p className="text-sm text-zinc-600">
          {p.machineKind === "CLAW"
            ? `🧸 ${p.productName ?? "-"} · ${p.pricePerPlayCoins} เหรียญ/ครั้ง`
            : `🪙 ตู้แลกเหรียญ · ${p.baseCoinPerBaht} เหรียญ/บาท`}
        </p>
      </header>

      {p.machineKind === "CLAW" && (
        <Section title="🧸 ตุ๊กตา">
          <Row>
            <NumField
              label="ก่อนเติม"
              value={state.stockBefore}
              onChange={(v) => set("stockBefore", v)}
              suffix="ตัว"
            />
            <NumField
              label="เติม"
              value={state.refillQty}
              onChange={(v) => set("refillQty", v)}
              suffix="ตัว"
            />
            <NumField
              label="หลังเติม"
              value={state.stockAfter}
              onChange={(v) => set("stockAfter", v)}
              suffix="ตัว"
            />
          </Row>
          {numbersReady && p.machineKind === "CLAW" && (
            <div className="text-xs text-zinc-500">
              {derived.dollsDelta > 0
                ? `► ตุ๊กตาออก ${derived.dollsDelta} ตัว (ตามมิเตอร์)`
                : derived.dollsDelta === 0
                ? "► ตุ๊กตาไม่ออก (มิเตอร์ไม่ขยับ)"
                : "► ⚠️ มิเตอร์ตุ๊กตาถอยหลัง"}
              {derived.stockMath !== 0 && (
                <span className="ml-2 font-semibold text-amber-700">
                  · นับ {derived.stockMath > 0 ? "เกิน" : "ขาด"} {Math.abs(derived.stockMath)} ตัว
                </span>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="📊 มิเตอร์ (จดหลังปิดตู้)">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 text-xs text-zinc-500">
          ครั้งก่อน · เหรียญ {p.lastCoinMeter.toLocaleString()}
          {p.machineKind === "CLAW" && ` · ตุ๊กตา ${p.lastDollMeter.toLocaleString()}`}
        </div>
        <NumField
          label="เหรียญ หลัง"
          value={state.coinMeterAfter}
          onChange={(v) => set("coinMeterAfter", v)}
          suffix=""
          big
        />
        {state.coinMeterAfter !== "" && (
          <div className="text-xs">
            Δ {derived.coinsDelta.toLocaleString()} ครั้ง · ควรได้{" "}
            <span className="font-semibold text-zinc-900">
              ฿{(derived.expectedCents / 100).toLocaleString()}
            </span>
          </div>
        )}
        {p.machineKind === "CLAW" && (
          <NumField
            label="ตุ๊กตา หลัง"
            value={state.dollMeterAfter}
            onChange={(v) => set("dollMeterAfter", v)}
            suffix=""
          />
        )}
      </Section>

      <Section title="💵 เงินสดที่เก็บ">
        <NumField
          label="เงินสด"
          value={state.cashCounted}
          onChange={(v) => set("cashCounted", v)}
          suffix="บาท"
          big
        />
        {state.cashCounted !== "" && state.coinMeterAfter !== "" && (
          <VarianceBadge
            varianceCents={derived.varianceCents}
            light={derived.cashLight}
          />
        )}
        {p.machineKind === "EXCHANGER" && (
          <NumField
            label="เหรียญ promo (ถ้าใช้ promo)"
            value={state.promoCoinsDispensed}
            onChange={(v) => set("promoCoinsDispensed", v)}
            suffix="เหรียญ"
          />
        )}
      </Section>

      <Section title={`📷 รูป (บังคับ ${p.machineKind === "CLAW" ? 4 : 3} ใบ)`}>
        <div className="grid grid-cols-2 gap-2">
          <PhotoCaptureButton
            label="มิเตอร์ก่อน"
            value={state.photoMeterBeforeUrl}
            onChange={(url) => set("photoMeterBeforeUrl", url)}
            orgId={p.orgId}
            machineCode={p.machineCode}
            eventScopeId={`${p.sessionId}-${p.machineId}`}
            phase="meter_before"
          />
          <PhotoCaptureButton
            label="เงินสด"
            value={state.photoCashUrl}
            onChange={(url) => set("photoCashUrl", url)}
            orgId={p.orgId}
            machineCode={p.machineCode}
            eventScopeId={`${p.sessionId}-${p.machineId}`}
            phase="cash"
          />
          {p.machineKind === "CLAW" && (
            <PhotoCaptureButton
              label="ตุ๊กตาในตู้"
              value={state.photoStockUrl}
              onChange={(url) => set("photoStockUrl", url)}
              orgId={p.orgId}
              machineCode={p.machineCode}
              eventScopeId={`${p.sessionId}-${p.machineId}`}
              phase="stock"
            />
          )}
          <PhotoCaptureButton
            label="มิเตอร์หลัง"
            value={state.photoMeterAfterUrl}
            onChange={(url) => set("photoMeterAfterUrl", url)}
            orgId={p.orgId}
            machineCode={p.machineCode}
            eventScopeId={`${p.sessionId}-${p.machineId}`}
            phase="meter_after"
          />
        </div>
      </Section>

      <Section title="📝 หมายเหตุ (optional)">
        <textarea
          value={state.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          className="w-full rounded-xl border border-zinc-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="เช่น ตู้แลกเสีย / เด็กแย่งเหรียญ / etc"
        />
      </Section>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="sticky bottom-3 z-10 w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending
          ? "กำลังบันทึก..."
          : !photosReady
          ? "ต้องอัพรูปครบก่อน"
          : !numbersReady
          ? "กรอกตัวเลขให้ครบ"
          : "บันทึก & ถัดไป →"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
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
          className={`w-full appearance-none border-0 bg-transparent py-2.5 focus:outline-none ${big ? "text-2xl font-bold" : "text-base font-semibold"} text-zinc-900`}
        />
        {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
      </div>
    </label>
  );
}

function VarianceBadge({
  varianceCents,
  light,
}: {
  varianceCents: number;
  light: "ok" | "warn" | "danger";
}) {
  const abs = Math.abs(varianceCents);
  const sign = varianceCents > 0 ? "เกิน" : varianceCents < 0 ? "ขาด" : "ตรง";
  const cls = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[light];
  const icon = light === "ok" ? "🟢" : light === "warn" ? "🟡" : "🔴";
  return (
    <div className={`rounded-xl border p-2.5 text-sm ${cls}`}>
      {icon} {sign}
      {varianceCents !== 0 && (
        <span className="ml-1 font-bold">฿{(abs / 100).toLocaleString()}</span>
      )}
      <span className="ml-1 text-xs">
        ({light === "ok" ? "ยอมรับได้" : light === "warn" ? "บันทึกได้ต้องอธิบาย" : "ขาดเยอะ · หัวหน้าต้องอนุมัติ"})
      </span>
    </div>
  );
}

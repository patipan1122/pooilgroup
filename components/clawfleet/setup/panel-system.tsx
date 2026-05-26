"use client";

// PanelSystem — editable thresholds + cron interval form.
// Source defaults: lib/clawfleet/types.ts:DEFAULTS
// Spec: §7.2 Settings · §3.6 — tolerance change LINE-notifies CEO (SA-D15).

import { useState, useTransition } from "react";
import { CheckCircle2, AlertTriangle, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEFAULTS } from "@/lib/clawfleet/types";
// TODO[claude-design]: server action not yet implemented — see §stubs_needed.
// import { updateSettings } from "@/lib/clawfleet/actions";

type Status = { kind: "idle" } | { kind: "ok" } | { kind: "err"; msg: string };

export function PanelSystem() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  interface SystemForm {
    toleranceBps: number;
    cashAcceptCents: number;
    cashWarnCents: number;
    autoPassBaht: number;
    sessionTimeoutHrs: number;
    staleOpenCronHrs: number;
  }
  const [form, setForm] = useState<SystemForm>({
    toleranceBps: DEFAULTS.GROUP_TOLERANCE_BPS, // 500 = 5%
    cashAcceptCents: DEFAULTS.CASH_VARIANCE_ACCEPTABLE_CENTS,
    cashWarnCents: DEFAULTS.CASH_VARIANCE_WARN_CENTS,
    autoPassBaht: 50, // auto-pass threshold (MGR-D · BA-D18 default)
    sessionTimeoutHrs: DEFAULTS.SESSION_AUTO_CLOSE_HOURS,
    staleOpenCronHrs: 4, // how often handover-stale cron runs
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      try {
        // TODO[claude-design]: wire when updateSettings exists.
        // const r = await updateSettings(form);
        // if (!r.ok) { setStatus({ kind: "err", msg: r.error }); return; }
        await new Promise((res) => setTimeout(res, 350)); // simulate
        setStatus({ kind: "ok" });
      } catch (e) {
        setStatus({ kind: "err", msg: (e as Error).message });
      }
    });
  }

  const toleranceLabel = `${(form.toleranceBps / 100).toFixed(1)}%`;

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <header>
        <h2 className="text-xl font-semibold text-zinc-900">ระบบ · ค่าเริ่มต้น</h2>
        <p className="mt-1 text-sm text-zinc-500">
          ค่าที่ใช้ทั้งระบบ · ปรับ tolerance ระดับกลุ่มได้แยกในหน้ากลุ่ม
        </p>
      </header>

      {/* CEO LINE notify warning — SA-D15 */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="text-sm text-amber-900">
          <p className="font-semibold">เปลี่ยน tolerance = LINE แจ้ง CEO ทันที</p>
          <p className="mt-1 text-amber-800">
            ทุกการปรับ tolerance จะถูกบันทึก audit + ส่งข้อความเข้า LINE ของ CEO
            พร้อมระบุผู้แก้ + ค่าก่อน/หลัง
          </p>
        </div>
      </div>

      {/* Tolerance slider */}
      <section className="space-y-4">
        <Field
          label={`Tolerance ระดับกลุ่ม · ${toleranceLabel}`}
          hint="ผลต่างเหรียญตู้แลก vs ตู้คีบ ที่ยอมรับได้ก่อนถูก flag"
        >
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={2000}
              step={50}
              value={form.toleranceBps}
              onChange={(e) =>
                setForm((f) => ({ ...f, toleranceBps: Number(e.target.value) }))
              }
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-indigo-600"
            />
            <div className="flex justify-between text-xs tabular-nums text-zinc-500">
              <span>0%</span>
              <span>5% (default)</span>
              <span>10%</span>
              <span>20%</span>
            </div>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="เงินขาดยอมรับได้ (บาท)"
            hint={`ปัจจุบัน ฿${(form.cashAcceptCents / 100).toLocaleString()} · เกินนี้ → flag P2`}
          >
            <Input
              inputMode="decimal"
              value={(form.cashAcceptCents / 100).toString()}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  cashAcceptCents: Math.round(
                    (Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) * 100,
                  ),
                }))
              }
              prefixSlot="฿"
            />
          </Field>

          <Field
            label="เงินขาด WARN (บาท)"
            hint={`เกิน ฿${(form.cashWarnCents / 100).toLocaleString()} → flag P1 + แจ้ง MGR`}
          >
            <Input
              inputMode="decimal"
              value={(form.cashWarnCents / 100).toString()}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  cashWarnCents: Math.round(
                    (Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) * 100,
                  ),
                }))
              }
              prefixSlot="฿"
            />
          </Field>

          <Field
            label="Auto-pass threshold (บาท)"
            hint="ผลต่างไม่เกิน ฿X อนุมัติอัตโนมัติ · ไม่ต้องเข้าคิว MGR"
          >
            <Input
              inputMode="decimal"
              value={form.autoPassBaht.toString()}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  autoPassBaht: Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                }))
              }
              prefixSlot="฿"
            />
          </Field>

          <Field
            label="Session timeout (ชั่วโมง)"
            hint="ปิด session ที่ค้าง OPEN เกินเวลานี้อัตโนมัติ"
          >
            <Input
              inputMode="numeric"
              value={form.sessionTimeoutHrs.toString()}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  sessionTimeoutHrs:
                    Number(e.target.value.replace(/[^0-9]/g, "")) || 24,
                }))
              }
              suffixSlot="ชม."
            />
          </Field>

          <Field
            label="Stale OPEN cron interval (ชม.)"
            hint="ทุกกี่ชั่วโมงให้ cron มาเช็ค session ค้าง"
          >
            <Input
              inputMode="numeric"
              value={form.staleOpenCronHrs.toString()}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  staleOpenCronHrs:
                    Number(e.target.value.replace(/[^0-9]/g, "")) || 4,
                }))
              }
              suffixSlot="ชม."
            />
          </Field>
        </div>
      </section>

      {/* Status + submit */}
      <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <div className="flex items-center gap-2 text-sm">
          {status.kind === "ok" && (
            <>
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span className="text-emerald-700">บันทึกแล้ว · audit log ถูกบันทึก</span>
            </>
          )}
          {status.kind === "err" && (
            <>
              <AlertTriangle className="size-4 text-rose-600" />
              <span className="text-rose-700">{status.msg}</span>
            </>
          )}
          {status.kind === "idle" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Info className="size-3.5" />
              ยังไม่มีการเปลี่ยนแปลงที่บันทึก
            </span>
          )}
        </div>
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> กำลังบันทึก…
            </>
          ) : (
            "บันทึกค่า"
          )}
        </Button>
      </div>
    </form>
  );
}

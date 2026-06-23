"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { bkkDateTime } from "@/lib/fuelos/utils/format";
import { Satellite, Plug, CheckCircle2, AlertTriangle } from "lucide-react";
import { upsertGpsConfig, testGpsConnection } from "./gps-actions";
import type { GpsConfigView } from "@/lib/fuelos/gps/report-data";

type TestResult =
  | { ok: true; accountName: string | null; quotaTotal: number | null; quotaUsed: number | null; quotaUnlimited: boolean }
  | { ok: false; error: string }
  | null;

export function GpsTab({ config }: { config: GpsConfigView | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<TestResult>(null);

  function onSubmit(formData: FormData) {
    start(async () => {
      const res = await upsertGpsConfig(formData);
      if (res.ok) {
        toast.success("บันทึกการตั้งค่า GPS แล้ว");
        router.refresh();
      } else {
        toast.error("บันทึกไม่สำเร็จ");
      }
    });
  }

  function onTest() {
    startTest(async () => {
      const res = await testGpsConnection();
      setTestResult(res);
      if (res.ok) toast.success(`เชื่อมต่อสำเร็จ: ${res.accountName ?? "—"}`);
      else toast.error(res.error ?? "ทดสอบไม่สำเร็จ");
      router.refresh();
    });
  }

  const quotaText = config?.quotaUnlimited
    ? "ไม่จำกัด"
    : config?.quotaTotal != null
      ? `${config.quotaUsed ?? 0} / ${config.quotaTotal}`
      : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Satellite className="size-5 text-brand-600" />
        <h2 className="font-bold">เชื่อมต่อ GPS (xsense)</h2>
      </div>

      <form action={onSubmit} className="rounded-2xl border border-border bg-surface p-4 grid gap-3">
        <div className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-[11px] text-zinc-500">
          ขอ <b>api-id</b> และ <b>api-key</b> จาก xsense (Tracking Open API) วางที่นี่ · เก็บแบบเข้ารหัส · ใช้แทนการตั้งใน env
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500">
              api-id {config?.hasApiId && <span className="text-zinc-400">(มีอยู่แล้ว · เว้นว่างเพื่อคงเดิม)</span>}
            </label>
            <input name="apiId" type="password" autoComplete="off" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm font-[family-name:var(--font-plex-mono)]" placeholder={config?.hasApiId ? "••••••••••" : "วาง api-id"} />
          </div>
          <div>
            <label className="text-xs text-zinc-500">
              api-key {config?.hasApiKey && <span className="text-zinc-400">(มีอยู่แล้ว · เว้นว่างเพื่อคงเดิม)</span>}
            </label>
            <input name="apiKey" type="password" autoComplete="off" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm font-[family-name:var(--font-plex-mono)]" placeholder={config?.hasApiKey ? "••••••••••" : "วาง api-key"} />
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-500">กลุ่มบริษัทที่ติดตาม (เว้นว่าง = ทุกกลุ่ม)</label>
          <input name="trackedGroups" defaultValue={config && !config.trackedGroups.includes("ALL") ? config.trackedGroups.join(", ") : ""} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="ALL หรือ เช่น พีโอออยล์, จักราชการปิโตรเลียม" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={config?.enabled ?? false} className="size-4 rounded border-border" />
          เปิดใช้งานคีย์นี้ (ให้แผนที่ + รายงานใช้คีย์จากในเว็บ)
        </label>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="outline" loading={testing} onClick={onTest}>
            <Plug className="size-4" /> ทดสอบเชื่อมต่อ
          </Button>
          <Button type="submit" loading={pending}>บันทึกการตั้งค่า</Button>
        </div>
      </form>

      {testResult && (
        <div className={cn("rounded-2xl border p-3.5 flex items-start gap-3", testResult.ok ? "border-leaf-300 bg-leaf-50" : "border-warning/40 bg-warning/5")}>
          {testResult.ok ? <CheckCircle2 className="size-5 text-leaf-600 shrink-0 mt-0.5" /> : <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />}
          <div className="text-sm">
            {testResult.ok ? (
              <>
                <div className="font-semibold">เชื่อมต่อสำเร็จ — {testResult.accountName ?? "—"}</div>
                <div className="text-zinc-500 mt-0.5">โควต้า: {testResult.quotaUnlimited ? "ไม่จำกัด" : `${testResult.quotaUsed ?? 0} / ${testResult.quotaTotal ?? "—"}`}</div>
              </>
            ) : (
              <div className="text-warning font-medium">{testResult.error}</div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4 grid sm:grid-cols-2 gap-3 text-sm">
        <Stat label="สถานะคีย์ในเว็บ" value={config?.enabled ? "เปิดใช้งาน" : "ปิด (ใช้ env)"} tone={config?.enabled ? "ok" : "off"} />
        <Stat label="บัญชี xsense" value={config?.accountName ?? "ยังไม่ทดสอบ"} />
        <Stat label="โควต้า" value={quotaText} />
        <Stat label="ทดสอบล่าสุด" value={config?.lastTestAt ? bkkDateTime(config.lastTestAt) : "—"} />
        {config?.lastError && <Stat label="ข้อผิดพลาดล่าสุด" value={config.lastError} tone="warn" />}
      </div>

      <div className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-[11px] text-zinc-500">
        💡 ดูตำแหน่งรถสด: เมนู <b>จัดส่ง → ติดตามรถ (แผนที่)</b> · ดูรายงาน กม./เครื่องเดินเปล่า: เมนู <b>รายงานรถ GPS</b>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "off" | "warn" }) {
  return (
    <div>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className={cn("font-medium mt-0.5 break-words", tone === "ok" && "text-leaf-700", tone === "off" && "text-zinc-400", tone === "warn" && "text-warning")}>{value}</div>
    </div>
  );
}

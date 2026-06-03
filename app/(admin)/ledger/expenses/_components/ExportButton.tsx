"use client";

// Export confirmed expenses → CSV (feeds TRCloud). Opens a tiny period picker,
// then downloads from GET /api/ledger/export (which delegates to the audited
// exportConfirmedCsv action). Confirmed/locked rows only — never drafts.
import { useState, useTransition } from "react";

// Current month in Asia/Bangkok (YYYY-MM). en-CA → "2026-06". Using the TZ
// formatter (not getUTC*) so the default export period matches the dashboard
// near the 1st of the month regardless of the browser's UTC offset.
function currentPeriod(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

export function ExportButton({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(currentPeriod());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download() {
    setError(null);
    startTransition(async () => {
      const url = `/api/ledger/export?company=${encodeURIComponent(
        companyId,
      )}&period=${encodeURIComponent(period)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(data?.error ?? "ส่งออกไม่สำเร็จ");
          return;
        }
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition") ?? "";
        const m = cd.match(/filename="(.+?)"/);
        const filename = m?.[1] ?? `ledger-${period}.csv`;
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
        setOpen(false);
      } catch {
        setError("ส่งออกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        ⬇ ส่งออก CSV
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs text-zinc-500">
            ส่งออกเฉพาะรายการที่ <b>ยืนยันแล้ว</b> ของงวดที่เลือก (เข้า TRCloud)
          </p>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            งวด (เดือน)
          </label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="mb-2 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
          />
          {error && (
            <p className="mb-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={download}
              disabled={pending || !/^\d{4}-\d{2}$/.test(period)}
              className="rounded-lg bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-700)] disabled:opacity-60"
            >
              {pending ? "กำลังส่งออก…" : "ดาวน์โหลด"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

// ปุ่มเช็คโควตาข้อความ LINE OA ของบริษัทนี้ (super admin). เรียก server action
// checkLineQuota → โชว์ "ส่งไปเดือนนี้ / เหลือ / เพดาน".
//
// สำคัญ: LINE นับ "push/broadcast" เข้าโควตา แต่ "reply" (ตอนลูกค้าทักมาก่อน) ฟรี
// ไม่นับ — เลข used ที่โชว์คือเฉพาะข้อความที่กินโควตา. การกดเช็คนี้เป็นการ "อ่าน"
// จึงไม่กินโควตาเอง.
import { useState, useTransition } from "react";
import { Gauge, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkLineQuota } from "../../_actions";

type QuotaView = { used: number; limit: number | null; unlimited: boolean };

export function LineQuotaButton({
  companyId,
  connected,
}: {
  companyId: string;
  connected: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<QuotaView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function check() {
    setErr(null);
    startTransition(async () => {
      const res = await checkLineQuota(companyId);
      if (!res.ok) {
        setData(null);
        setErr(res.error);
        return;
      }
      setData({ used: res.used, limit: res.limit, unlimited: res.unlimited });
    });
  }

  const remaining = data && data.limit != null ? Math.max(0, data.limit - data.used) : null;
  const nf = (n: number) => n.toLocaleString("th-TH");

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Gauge className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">โควตาข้อความ LINE</h3>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        ดูว่าเดือนนี้ส่งข้อความแจ้งเตือน (push) ไปกี่ครั้ง เหลือโควตาเท่าไหร่ — การกดเช็คนี้ไม่กินโควตา
      </p>

      <Button variant="secondary" onClick={check} disabled={pending || !connected}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        เช็คโควตาเดือนนี้
      </Button>

      {!connected && (
        <p className="mt-2 text-[11px] text-amber-600">
          เชื่อมต่อ LINE OA ก่อน (การ์ดด้านบน) จึงจะเช็คได้
        </p>
      )}

      {data && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <div className="text-[11px] text-zinc-500">ส่งไปเดือนนี้</div>
              <div className="text-base font-bold text-zinc-800">{nf(data.used)}</div>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <div className="text-[11px] text-zinc-500">เหลือ</div>
              <div
                className={
                  "text-base font-bold " +
                  (remaining != null && remaining < 50 ? "text-rose-600" : "text-emerald-600")
                }
              >
                {data.unlimited ? "ไม่จำกัด" : nf(remaining ?? 0)}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2 py-2">
              <div className="text-[11px] text-zinc-500">เพดาน/เดือน</div>
              <div className="text-base font-bold text-zinc-800">
                {data.unlimited ? "—" : nf(data.limit ?? 0)}
              </div>
            </div>
          </div>
          {data.unlimited && (
            <p className="mt-2 text-[11px] text-zinc-500">
              บัญชีนี้ไม่ได้ตั้งเพดานข้อความเพิ่ม (จ่ายตามใช้จริง/ไม่จำกัด) — ดูแพลนจริงได้ใน LINE OA
              Manager
            </p>
          )}
        </>
      )}

      {err && (
        <div
          className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}

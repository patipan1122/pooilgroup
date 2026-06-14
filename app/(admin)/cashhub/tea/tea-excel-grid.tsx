"use client";

// ตารางเต็มแบบ Excel ต่อสาขา — ตรึงหัว+คอลัมน์วันที่, แยกทุกช่องทาง, IV (TRC), ส่วนต่างแดงถ้า≠0,
// แถวรวมท้าย + ปุ่ม "ส่ง IV" (super_admin · เฉพาะวันที่ยังไม่มี IV) + คลิกเลข IV เปิดใน TRCloud.
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";
import type { SavedTeaDay } from "@/lib/cashhub/tea-data";
import { TEA_CHANNELS, type TeaChannelCode } from "@/lib/cashhub/tea-channels";

const cell = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Props = {
  branchLabel: string;
  branchCode: string;
  days: string[]; // ทุกวันในเดือน (YYYY-MM-DD)
  byDate: Map<string, SavedTeaDay>; // วัน → ข้อมูล (สาขานี้)
  canSend: boolean; // super_admin → ส่ง IV ได้
};

export function TeaExcelGrid({ branchLabel, branchCode, days, byDate, canSend }: Props) {
  const router = useRouter();
  const channelCols = TEA_CHANNELS;
  const [busy, setBusy] = useState<string | null>(null); // date กำลังทำงาน
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // เปิดใบ IV ใน TRCloud (ขอลิงก์ on-demand)
  const openIv = useCallback(async (ivId: string) => {
    setMsg(null);
    setBusy("link:" + ivId);
    try {
      const res = await fetch(`/api/cashhub/tea/iv-link?ivId=${encodeURIComponent(ivId)}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.open(data.url, "_blank", "noopener");
      else setMsg({ kind: "err", text: data.error ?? "เปิดใบไม่ได้" });
    } catch {
      setMsg({ kind: "err", text: "เปิดใบไม่ได้" });
    } finally {
      setBusy(null);
    }
  }, []);

  // สร้าง IV วันที่ยังไม่มี
  const sendIv = useCallback(
    async (date: string, pos: number) => {
      if (!window.confirm(`สร้าง IV วันที่ ${date} ยอด ${formatBaht(pos)} เข้า TRCloud?\n(สร้างเฉพาะวันที่ยังไม่มี IV — กันใบซ้ำให้แล้ว)`))
        return;
      setMsg(null);
      setBusy(date);
      try {
        const res = await fetch("/api/cashhub/tea/send-iv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchCode, date }),
        });
        const data = (await res.json()) as { ok?: boolean; ivNo?: string; duplicate?: boolean; error?: string };
        if (!res.ok || data.error) setMsg({ kind: "err", text: data.error ?? "สร้าง IV ไม่สำเร็จ" });
        else {
          setMsg({
            kind: "ok",
            text: data.duplicate ? `วันที่ ${date} มี IV อยู่แล้ว` : `สร้าง IV ${data.ivNo ?? ""} วันที่ ${date} สำเร็จ`,
          });
          router.refresh();
        }
      } catch {
        setMsg({ kind: "err", text: "สร้าง IV ไม่สำเร็จ" });
      } finally {
        setBusy(null);
      }
    },
    [branchCode, router],
  );

  const tot = { pos: 0, iv: 0, ch: {} as Record<string, number> };
  for (const d of byDate.values()) {
    tot.pos += d.pos_gross ?? 0;
    tot.iv += d.iv_gross ?? 0;
    for (const c of channelCols) tot.ch[c.code] = (tot.ch[c.code] ?? 0) + (d.pos_channels?.[c.code] ?? 0);
  }
  const totDiff = tot.iv - tot.pos;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {msg && (
        <div className={`m-3 rounded-xl px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-600">
              <th className="sticky left-0 z-10 bg-zinc-50 px-2.5 py-2 text-left font-semibold border-b border-zinc-200">วันที่</th>
              <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 bg-zinc-100/60">ยอดขาย POS</th>
              {channelCols.map((c) => (
                <th key={c.code} className="px-2.5 py-2 text-right font-medium border-b border-zinc-200 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 bg-blue-50/60 whitespace-nowrap">IV (TRC)</th>
              <th className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 whitespace-nowrap">ส่วนต่าง</th>
              <th className="px-2.5 py-2 text-center font-semibold border-b border-zinc-200 whitespace-nowrap">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const d = byDate.get(date);
              const pos = d?.pos_gross ?? null;
              const iv = d?.iv_gross ?? null;
              const ivId = d?.iv_doc_id ?? null;
              const diff = iv != null && pos != null ? iv - pos : null;
              const diffBad = diff != null && Math.abs(diff) >= 1;
              const noIv = pos != null && iv == null;
              return (
                <tr key={date} className="hover:bg-zinc-50/60">
                  <td className="sticky left-0 z-10 bg-white px-2.5 py-1.5 font-medium text-zinc-700 border-b border-zinc-100">{Number(date.slice(8, 10))}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-zinc-800 border-b border-zinc-100 bg-zinc-50/60">{cell(pos)}</td>
                  {channelCols.map((c) => {
                    const v = d?.pos_channels?.[c.code as TeaChannelCode] ?? null;
                    return (
                      <td key={c.code} className="px-2.5 py-1.5 text-right tabular-nums text-zinc-500 border-b border-zinc-100">
                        {v ? cell(v) : <span className="text-zinc-300">·</span>}
                      </td>
                    );
                  })}
                  <td className={`px-2.5 py-1.5 text-right tabular-nums font-medium border-b border-zinc-100 ${noIv ? "bg-amber-50 text-amber-700" : "text-blue-700 bg-blue-50/40"}`}>
                    {iv != null ? cell(iv) : noIv ? "ยังไม่คีย์" : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right tabular-nums border-b border-zinc-100 ${diffBad ? "bg-red-50 text-red-700 font-semibold" : noIv ? "bg-amber-50 text-amber-700" : "text-zinc-400"}`}>
                    {diff != null ? (Math.abs(diff) < 0.5 ? "0" : cell(diff)) : noIv ? "⚪" : ""}
                  </td>
                  <td className="px-2.5 py-1.5 text-center border-b border-zinc-100 whitespace-nowrap">
                    {iv != null && ivId ? (
                      <button
                        type="button"
                        onClick={() => openIv(ivId)}
                        disabled={busy === "link:" + ivId}
                        className="rounded-md px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                      >
                        ↗ เปิด IV
                      </button>
                    ) : noIv && canSend && pos != null ? (
                      <button
                        type="button"
                        onClick={() => sendIv(date, pos)}
                        disabled={busy === date}
                        className="rounded-md bg-[var(--ch-brand,#1e3aff)] px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {busy === date ? "กำลังส่ง…" : "ส่ง IV"}
                      </button>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-100 font-bold text-zinc-800">
              <td className="sticky left-0 z-10 bg-zinc-100 px-2.5 py-2">รวม</td>
              <td className="px-2.5 py-2 text-right tabular-nums">{cell(tot.pos)}</td>
              {channelCols.map((c) => (
                <td key={c.code} className="px-2.5 py-2 text-right tabular-nums text-zinc-600">{cell(tot.ch[c.code] ?? 0)}</td>
              ))}
              <td className="px-2.5 py-2 text-right tabular-nums text-blue-700 bg-blue-50/60">{cell(tot.iv)}</td>
              <td className={`px-2.5 py-2 text-right tabular-nums ${Math.abs(totDiff) >= 1 ? "text-red-700" : "text-zinc-500"}`}>
                {Math.abs(totDiff) < 0.5 ? "0" : cell(totDiff)}
              </td>
              <td className="px-2.5 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-3 py-2 text-xs text-zinc-400">
        {branchLabel} · POS รวมทุกช่องทางเทียบ IV ที่คีย์ใน TRCloud · ส่วนต่างแดง = ต้องตรวจ
        {canSend && " · วันที่ยังไม่มี IV กด “ส่ง IV” เพื่อสร้างเข้า TRCloud (กันใบซ้ำ)"}
      </div>
    </div>
  );
}

"use client";

// ตารางเต็มแบบ Excel ต่อสาขา — ตรึงหัว+คอลัมน์วันที่, แยกทุกช่องทาง, IV (TRC), ส่วนต่างแดงถ้า≠0,
// แถวรวมท้าย + ปุ่ม "ส่ง IV" (super_admin · เฉพาะวันที่ยังไม่มี IV) + คลิกเลข IV เปิดใน TRCloud.
import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatBaht } from "@/lib/utils/format";
import type { SavedTeaDay } from "@/lib/cashhub/tea-data";
import { TEA_CHANNELS, type TeaChannelCode } from "@/lib/cashhub/tea-channels";
import type { TeaReconcileCell } from "@/lib/cashhub/tea-settlement-data";
import { reconDiffKind } from "@/lib/cashhub/recon-diff";

// สถานะแมชธนาคารของ "ช่องทาง 1 วัน" → คลาสสี + ป้ายกำกับ (tooltip)
function channelMatchStyle(st: TeaReconcileCell | undefined): { cls: string; title?: string } {
  if (!st) return { cls: "text-zinc-500" }; // ยังไม่ส่งเข้าระบบ
  if (!st.reconciled) return { cls: "bg-amber-50/50 text-amber-600", title: "ส่งเข้าระบบแล้ว · รอธนาคารมาแมช" };
  const kind = reconDiffKind(st.deltaBaht);
  if (kind === "short")
    return { cls: "bg-red-100 font-semibold text-red-800", title: `แมชแล้ว แต่เงินเข้าน้อยกว่าที่ส่ง ฿${formatBaht(Math.abs(st.deltaBaht ?? 0))} (ขาด)` };
  if (kind === "excess")
    return { cls: "bg-orange-50 font-semibold text-orange-700", title: `แมชแล้ว แต่เงินเข้ามากกว่าที่ส่ง ฿${formatBaht(st.deltaBaht ?? 0)} (เกิน)` };
  return { cls: "cell-matched-iridescent font-semibold", title: "แมชกับ statement ธนาคารแล้ว เป๊ะ" };
}

const cell = (v: number | null | undefined) =>
  v == null ? "" : Math.abs(v) < 0.005 ? "0" : formatBaht(v);

type Props = {
  branchLabel: string;
  branchCode: string;
  days: string[]; // ทุกวันในเดือน (YYYY-MM-DD)
  byDate: Map<string, SavedTeaDay>; // วัน → ข้อมูล (สาขานี้)
  canSend: boolean; // super_admin → ส่ง IV ได้
  reconStatus?: Record<string, TeaReconcileCell>; // สถานะแมชธนาคารต่อ source_ref (tea:{branch}:{date}:{channel})
};

export function TeaExcelGrid({ branchLabel, branchCode, days, byDate, canSend, reconStatus = {} }: Props) {
  const router = useRouter();
  const channelCols = TEA_CHANNELS;
  const [busy, setBusy] = useState<string | null>(null); // date กำลังทำงาน
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showDiffs, setShowDiffs] = useState(false);

  // วันที่/ช่องทางที่ "แมชธนาคารแล้วแต่ยอดไม่ตรง" (POS-net ≠ statement) — โชว์ในแถบเปิด/ปิด
  const diffs = useMemo(() => {
    const out: { day: number; channel: string; delta: number; kind: "short" | "excess" }[] = [];
    for (const date of days) {
      for (const c of channelCols) {
        const st = reconStatus[`tea:${branchCode}:${date}:${c.code}`];
        if (!st?.reconciled || st.deltaBaht == null) continue;
        const k = reconDiffKind(st.deltaBaht);
        if (k === "short" || k === "excess")
          out.push({ day: Number(date.slice(8, 10)), channel: c.label, delta: st.deltaBaht, kind: k });
      }
    }
    return out;
  }, [days, channelCols, reconStatus, branchCode]);

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
              <th
                className="px-2.5 py-2 text-right font-semibold border-b border-zinc-200 whitespace-nowrap"
                title="เทียบยอด IV ที่คีย์ใน TRCloud กับยอดขายจริง POS (ไม่ใช่เงินเข้าธนาคาร)"
              >
                ส่วนต่าง<span className="block text-[10px] font-normal text-zinc-400">IV ↔ POS</span>
              </th>
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
                    const st = v ? reconStatus[`tea:${branchCode}:${date}:${c.code}`] : undefined;
                    const { cls, title } = channelMatchStyle(st);
                    return (
                      <td
                        key={c.code}
                        title={title}
                        className={`px-2.5 py-1.5 text-right tabular-nums border-b border-zinc-100 ${v ? cls : "text-zinc-500"}`}
                      >
                        {v ? cell(v) : <span className="text-zinc-300">·</span>}
                      </td>
                    );
                  })}
                  <td className={`px-2.5 py-1.5 text-right tabular-nums font-medium border-b border-zinc-100 ${noIv ? "bg-amber-50 text-amber-700" : "text-blue-700 bg-blue-50/40"}`}>
                    {iv != null ? cell(iv) : noIv ? "ยังไม่คีย์" : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right tabular-nums border-b border-zinc-100 ${diff != null && reconDiffKind(diff) === "exact" ? "cell-matched-iridescent" : diffBad ? "bg-red-50 text-red-700 font-semibold" : noIv ? "bg-amber-50 text-amber-700" : "text-zinc-400"}`}>
                    {diff != null ? (reconDiffKind(diff) === "exact" ? "เป๊ะ" : cell(diff)) : noIv ? "⚪" : ""}
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
      {/* แถบ "ส่วนต่างกับธนาคาร" — เปิด/ปิดได้ (โชว์เฉพาะวันที่ยอดที่ส่ง ≠ เงินเข้าธนาคารจริง) */}
      {diffs.length > 0 && (
        <div className="mx-3 mb-3 rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDiffs((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-amber-800"
          >
            <span>⚠️ ส่วนต่างกับธนาคาร {diffs.length} รายการ (POS ที่ส่ง ≠ เงินเข้าจริง)</span>
            <span className="text-xs">{showDiffs ? "ซ่อน ▲" : "ดู ▼"}</span>
          </button>
          {showDiffs && (
            <div className="px-3 pb-3 space-y-1">
              {diffs.map((x, i) => (
                <div key={i} className="text-xs text-amber-900 flex items-center gap-2">
                  <span className="font-semibold">วันที่ {x.day}</span>
                  <span className="text-amber-700">· {x.channel} ·</span>
                  <span className={x.kind === "short" ? "text-red-700 font-semibold" : "text-orange-700 font-semibold"}>
                    {x.kind === "short" ? `เงินเข้าน้อยกว่าที่ส่ง (ขาด) ฿${formatBaht(Math.abs(x.delta))}` : `เงินเข้ามากกว่าที่ส่ง (เกิน) ฿${formatBaht(x.delta)}`}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-amber-700 pt-1">
                สาเหตุที่พบบ่อย: ค่าธรรมเนียมที่ตั้งไว้ไม่ตรงจริง (เช่น Grab) · ฝากไม่ครบ/ปัดเศษ → ตรวจที่หน้าบัญชีธนาคาร
              </p>
            </div>
          )}
        </div>
      )}

      {/* คำอธิบายสี (legend) */}
      <div className="px-3 py-2.5 text-[11px] text-zinc-500 border-t border-zinc-100 space-y-1.5">
        <div className="font-semibold text-zinc-600">ความหมายของสี:</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><b>คอลัมน์ช่องทาง (เงินสด/QR/…)</b> = สถานะแมชกับธนาคาร:</span>
          <span><span className="cell-matched-iridescent rounded px-1.5">✦ รุ้ง</span> = แมช statement เป๊ะ</span>
          <span><span className="rounded px-1.5 bg-red-100 text-red-800">แดง</span> = เงินเข้าขาด</span>
          <span><span className="rounded px-1.5 bg-orange-50 text-orange-700">ส้ม</span> = เงินเข้าเกิน</span>
          <span><span className="rounded px-1.5 bg-amber-50/70 text-amber-600">เหลืองอ่อน</span> = ส่งแล้ว รอแมช</span>
          <span><span className="text-zinc-500">เทา</span> = ยังไม่ส่งเข้าระบบ</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><b>คอลัมน์ “ส่วนต่าง (IV ↔ POS)”</b> = เทียบใบที่คีย์ใน TRCloud กับยอดขายจริง POS · <span className="text-matched-iridescent font-semibold">เป๊ะ</span> = ตรง · <span className="text-red-700 font-semibold">แดง</span> = ไม่ตรง (คีย์ผิด/ตกหล่น) — คนละเรื่องกับเงินเข้าธนาคาร</span>
        </div>
        <div className="text-zinc-400">
          {branchLabel}
          {canSend && " · วันที่ยังไม่มี IV กด “ส่ง IV” เพื่อสร้างเข้า TRCloud (กันใบซ้ำ) · สีในช่องทางจะอัปเดตหลังกด “ส่งเข้าระบบบัญชี” ที่แผงด้านบน"}
        </div>
      </div>
    </div>
  );
}

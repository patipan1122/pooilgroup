"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { FuelChannelConfig } from "@/lib/cashhub/fuel-channels";
import type { BankAccountOpt, CompanyOpt } from "@/lib/cashhub/amazon-settlement-data";

type Props = {
  configs: FuelChannelConfig[];
  accounts: BankAccountOpt[];
  companies: CompanyOpt[];
};

// ป้ายบัญชี: "ธนาคาร ****เลข4ตัวท้าย · ชื่อบัญชี" — ระบุบัญชีจากธนาคาร+เลขชัดเจน
const acctLabel = (a: BankAccountOpt) => a.label;

export function FuelSettingsEditor({ configs, accounts, companies }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<FuelChannelConfig[]>(configs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const patch = (code: string, p: Partial<FuelChannelConfig>) =>
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, ...p } : r)));

  const save = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cashhub/fuel/channel-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: rows }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) setMsg({ kind: "err", text: data.error ?? "บันทึกไม่สำเร็จ" });
      else {
        setMsg({ kind: "ok", text: "บันทึกแล้ว" });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "เชื่อมต่อไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }, [rows, router]);

  return (
    <div className="space-y-4">
      {/* การ์ดสรุป: ดูแวบเดียวว่าช่องไหนเข้าบัญชีไหน */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-xs font-medium text-zinc-500 mb-2">สถานะปัจจุบัน — ช่องทาง → บัญชี</div>
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const acc = r.bankAccountId ? acctById.get(r.bankAccountId) : null;
            return (
              <li key={r.code} className="flex items-center gap-2 text-sm">
                <span className="min-w-[120px] font-medium text-zinc-700">{r.label}</span>
                <span className="text-zinc-400">→</span>
                {!r.isSettle ? (
                  <span className="text-zinc-400">ไม่ส่งเข้ากระทบยอด</span>
                ) : acc ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700">
                    {acctLabel(acc)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700">
                    ⚠️ ยังไม่ได้เลือกบัญชี
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* ตารางแก้ไข */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
              <th className="p-3">ช่องทาง</th>
              <th className="p-3 text-center">เป็นเงินเข้าธนาคาร?</th>
              <th className="p-3 text-right">ค่าธรรมเนียม %</th>
              <th className="p-3">บัญชีที่เงินเข้า</th>
              <th className="p-3">บริษัท</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-zinc-100">
                <td className="p-3 font-medium text-zinc-700">{r.label}</td>
                <td className="p-3 text-center">
                  <input
                    type="checkbox"
                    checked={r.isSettle}
                    onChange={(e) => patch(r.code, { isSettle: e.target.checked })}
                    aria-label={`เงินเข้าธนาคาร ${r.label}`}
                  />
                </td>
                <td className="p-3 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.feePercent}
                    disabled={!r.isSettle}
                    onChange={(e) => patch(r.code, { feePercent: Number(e.target.value) })}
                    aria-label={`ค่าธรรมเนียม ${r.label}`}
                    className="w-20 h-9 rounded-lg border border-zinc-200 px-2 text-right text-sm disabled:bg-zinc-50 disabled:text-zinc-300"
                  />
                </td>
                <td className="p-3">
                  <select
                    value={r.bankAccountId ?? ""}
                    disabled={!r.isSettle}
                    onChange={(e) => patch(r.code, { bankAccountId: e.target.value || null })}
                    aria-label={`บัญชี ${r.label}`}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-sm bg-white disabled:bg-zinc-50 disabled:text-zinc-300 max-w-[200px]"
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <select
                    value={r.companyId ?? ""}
                    disabled={!r.isSettle}
                    onChange={(e) => patch(r.code, { companyId: e.target.value || null })}
                    aria-label={`บริษัท ${r.label}`}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-sm bg-white disabled:bg-zinc-50 disabled:text-zinc-300 max-w-[180px]"
                  >
                    <option value="">—</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && (
        <div className={`rounded-xl px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="h-11 rounded-xl bg-[var(--ch-brand,#1e3aff)] px-6 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
        </button>
      </div>

      {accounts.length === 0 && (
        <div className="rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-sm">
          ยังไม่มีบัญชีธนาคารในระบบ — เพิ่มบัญชีที่ระบบบัญชี (LedgerLine) ก่อน แล้วค่อยกลับมาผูก
        </div>
      )}

      <p className="text-xs text-zinc-500">
        ทุกช่องที่ติ๊ก &ldquo;เป็นเงินเข้าธนาคาร&rdquo; + เลือกบัญชี จะถูกเตรียมส่งเข้าหน้ากระทบยอดของบัญชีนั้น
        (บัญชีใครบัญชีมัน) · เงินเข้าจริง = ยอดช่องทาง − ค่าธรรมเนียม
      </p>
    </div>
  );
}

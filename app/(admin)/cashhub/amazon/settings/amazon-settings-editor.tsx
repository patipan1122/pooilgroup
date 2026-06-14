"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ChannelConfig } from "@/lib/cashhub/amazon-settlement";
import type {
  BankAccountOpt,
  CompanyOpt,
} from "@/lib/cashhub/amazon-settlement-data";

type Props = {
  configs: ChannelConfig[];
  accounts: BankAccountOpt[];
  companies: CompanyOpt[];
};

export function AmazonSettingsEditor({ configs, accounts, companies }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<ChannelConfig[]>(configs);
  // บริษัทเดียวกันทุกช่อง (default จากช่องแรกที่ตั้งไว้)
  const [companyId, setCompanyId] = useState<string>(
    configs.find((c) => c.companyId)?.companyId ?? companies[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const patch = (cvar: string, p: Partial<ChannelConfig>) =>
    setRows((rs) => rs.map((r) => (r.cvar === cvar ? { ...r, ...p } : r)));

  const save = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    // ใส่ companyId เดียวกันทุกช่องที่ settle
    const payload = rows.map((r) => ({ ...r, companyId: r.isSettle ? companyId || null : null }));
    try {
      const res = await fetch("/api/cashhub/amazon-settlement/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: payload }),
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
  }, [rows, companyId, router]);

  const applyAccountToAll = (accId: string) =>
    setRows((rs) => rs.map((r) => (r.isSettle ? { ...r, bankAccountId: accId || null } : r)));

  return (
    <div className="space-y-4">
      {/* บริษัท + ตั้งบัญชีทุกช่องทีเดียว */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-zinc-600">บริษัทที่เงินเข้า:</label>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          aria-label="บริษัท"
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
        >
          <option value="">— เลือกบริษัท —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="grow" />
        <label className="text-xs text-zinc-500">ตั้งบัญชีทุกช่องพร้อมกัน:</label>
        <select
          aria-label="ตั้งบัญชีทุกช่อง"
          defaultValue=""
          onChange={(e) => e.target.value && applyAccountToAll(e.target.value)}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
        >
          <option value="">— เลือกบัญชี —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name || `${a.bankCode} ${a.last4}`}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
              <th className="p-3">ช่องทาง</th>
              <th className="p-3 text-center">เป็นเงินเข้าธนาคาร?</th>
              <th className="p-3 text-right">ค่าธรรมเนียม %</th>
              <th className="p-3 text-right">ขั้นต่ำที่โอน (฿)</th>
              <th className="p-3">บัญชีที่เงินเข้า</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cvar} className="border-b border-zinc-100">
                <td className="p-3 font-medium text-zinc-700">{r.label}</td>
                <td className="p-3 text-center">
                  <input
                    type="checkbox"
                    checked={r.isSettle}
                    onChange={(e) => patch(r.cvar, { isSettle: e.target.checked })}
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
                    onChange={(e) => patch(r.cvar, { feePercent: Number(e.target.value) })}
                    aria-label={`ค่าธรรมเนียม ${r.label}`}
                    className="w-20 h-9 rounded-lg border border-zinc-200 px-2 text-right text-sm disabled:bg-zinc-50 disabled:text-zinc-300"
                  />
                </td>
                <td className="p-3 text-right">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={r.minSettleBaht}
                    disabled={!r.isSettle}
                    onChange={(e) => patch(r.cvar, { minSettleBaht: Number(e.target.value) })}
                    aria-label={`ขั้นต่ำที่โอน ${r.label}`}
                    className="w-24 h-9 rounded-lg border border-zinc-200 px-2 text-right text-sm disabled:bg-zinc-50 disabled:text-zinc-300"
                  />
                </td>
                <td className="p-3">
                  <select
                    value={r.bankAccountId ?? ""}
                    disabled={!r.isSettle}
                    onChange={(e) => patch(r.cvar, { bankAccountId: e.target.value || null })}
                    aria-label={`บัญชี ${r.label}`}
                    className="h-9 rounded-lg border border-zinc-200 px-2 text-sm bg-white disabled:bg-zinc-50 disabled:text-zinc-300 max-w-[200px]"
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name || `${a.bankCode} ${a.last4}`}</option>
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

      <p className="text-xs text-zinc-500">
        เงินเข้าจริง = ยอดช่องทาง − ค่าธรรมเนียม · ถ้ายอด/วัน &lt; ขั้นต่ำ = ยังไม่โอน (รอสะสม) ·
        ช่องที่ไม่ติ๊ก &ldquo;เงินเข้าธนาคาร&rdquo; (Redeem/ส่วนลด) จะไม่ส่งเข้า reconcile
      </p>
    </div>
  );
}

"use client";

// ตั้งค่าช่องทาง → บัญชี/บริษัท (เตรียม reconcile) — มิเรอร์ amazon-settings-editor.
// แต่ละช่องทาง (เงินสด/QR/EDC/Grab/Lineman/Shopee/wallet): เงินเข้าธนาคารจริงไหม + ค่าธรรมเนียม + บัญชีปลายทาง.
// บริษัทเดียวกันทุกช่อง (เลือกครั้งเดียว). บันทึกได้เฉพาะ super_admin.
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TeaChannelConfig } from "@/lib/cashhub/tea-channels";
import type { BankAccountOpt, CompanyOpt } from "@/lib/cashhub/amazon-settlement-data";

type Props = {
  configs: TeaChannelConfig[];
  accounts: BankAccountOpt[];
  companies: CompanyOpt[];
  canEdit: boolean;
};

const accLabel = (a: BankAccountOpt) =>
  `${a.name}${a.bankCode ? ` · ${a.bankCode}` : ""}${a.last4 ? ` ···${a.last4}` : ""}`;

export function TeaSettingsEditor({ configs, accounts, companies, canEdit }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<TeaChannelConfig[]>(configs);
  const [companyId, setCompanyId] = useState<string>(
    configs.find((c) => c.companyId)?.companyId ?? companies[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const patch = (code: string, p: Partial<TeaChannelConfig>) =>
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, ...p } : r)));

  const applyAccountToAll = (accId: string) =>
    setRows((rs) => rs.map((r) => (r.isSettle ? { ...r, bankAccountId: accId || null } : r)));

  const save = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const payload = rows.map((r) => ({ ...r, companyId: r.isSettle ? companyId || null : null }));
    try {
      const res = await fetch("/api/cashhub/tea/channel-config", {
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

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-sm">
          ดูได้อย่างเดียว — เฉพาะ super_admin แก้/บันทึกการตั้งค่าบัญชีได้
        </div>
      )}

      {/* บริษัท + ตั้งบัญชีทุกช่องทีเดียว */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-zinc-600">บริษัทที่เงินเข้า:</label>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={!canEdit}
          aria-label="บริษัท"
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white disabled:opacity-60"
        >
          <option value="">— เลือกบริษัท —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="grow" />
        <label className="text-sm text-zinc-500">ตั้งบัญชีทุกช่องทีเดียว:</label>
        <select
          defaultValue=""
          disabled={!canEdit}
          onChange={(e) => applyAccountToAll(e.target.value)}
          aria-label="ตั้งบัญชีทุกช่อง"
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white disabled:opacity-60"
        >
          <option value="">— เลือกบัญชี —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accLabel(a)}
            </option>
          ))}
        </select>
      </div>

      {/* ตารางช่องทาง */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-50 text-zinc-600">
              <th className="px-3 py-2 text-left font-semibold border-b border-zinc-200">ช่องทาง</th>
              <th className="px-3 py-2 text-center font-semibold border-b border-zinc-200">เงินเข้าธนาคาร</th>
              <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">ค่าธรรมเนียม %</th>
              <th className="px-3 py-2 text-right font-semibold border-b border-zinc-200">ขั้นต่ำ/วัน (฿)</th>
              <th className="px-3 py-2 text-left font-semibold border-b border-zinc-200">บัญชีปลายทาง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className={`hover:bg-zinc-50/60 ${!r.isSettle ? "opacity-60" : ""}`}>
                <td className="px-3 py-2 font-medium text-zinc-800 border-b border-zinc-100">{r.label}</td>
                <td className="px-3 py-2 text-center border-b border-zinc-100">
                  <input
                    type="checkbox"
                    checked={r.isSettle}
                    disabled={!canEdit}
                    onChange={(e) => patch(r.code, { isSettle: e.target.checked })}
                    aria-label={`${r.label} เงินเข้าธนาคาร`}
                  />
                </td>
                <td className="px-3 py-2 text-right border-b border-zinc-100">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.feePercent}
                    disabled={!canEdit || !r.isSettle}
                    onChange={(e) => patch(r.code, { feePercent: Number(e.target.value) || 0 })}
                    aria-label={`${r.label} ค่าธรรมเนียม`}
                    className="h-9 w-20 rounded-lg border border-zinc-200 px-2 text-right text-sm disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2 text-right border-b border-zinc-100">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={r.minSettleBaht}
                    disabled={!canEdit || !r.isSettle}
                    onChange={(e) => patch(r.code, { minSettleBaht: Number(e.target.value) || 0 })}
                    aria-label={`${r.label} ขั้นต่ำ`}
                    className="h-9 w-24 rounded-lg border border-zinc-200 px-2 text-right text-sm disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2 border-b border-zinc-100">
                  <select
                    value={r.bankAccountId ?? ""}
                    disabled={!canEdit || !r.isSettle}
                    onChange={(e) => patch(r.code, { bankAccountId: e.target.value || null })}
                    aria-label={`${r.label} บัญชี`}
                    className="h-9 min-w-[200px] rounded-lg border border-zinc-200 px-2 text-sm bg-white disabled:opacity-50"
                  >
                    <option value="">— ยังไม่ผูกบัญชี —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {accLabel(a)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && (
        <div
          className={`rounded-xl px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="h-10 rounded-xl bg-[var(--ch-brand,#1e3aff)] px-6 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
          </button>
          <span className="text-xs text-zinc-400">
            ใช้เตรียมส่งยอดแต่ละช่องทางเข้า reconcile (จับคู่กับเงินเข้าธนาคารจริง) ในเฟสถัดไป
          </span>
        </div>
      )}

      {accounts.length === 0 && (
        <div className="rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-sm">
          ยังไม่มีบัญชีธนาคารในระบบ — เพิ่มบัญชีที่ระบบบัญชี (LedgerLine) ก่อน แล้วค่อยกลับมาผูก
        </div>
      )}
    </div>
  );
}

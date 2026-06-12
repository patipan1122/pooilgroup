"use client";

// LedgerLine — บัญชีธนาคาร manager (client).
// Grouped list + add/edit modal + activate/deactivate, backed by accounts/_actions.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BANK_LABELS, BANK_OPTIONS,
} from "@/lib/ledger/bank-adapters/types";
import {
  createBankAccountAction,
  updateBankAccountAction,
  toggleBankAccountActiveAction,
} from "../_actions";
import { Plus, Pencil, Landmark, Power, X, Building2 } from "lucide-react";

interface Account {
  id: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  accountType: string;
  legalEntity: string | null;
  flowType: string | null;
  isActive: boolean;
}

interface Props {
  companyId: string;
  canEdit: boolean;
  accounts: Account[];
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: "ออมทรัพย์",
  current: "กระแสรายวัน",
  card_terminal: "เครื่องรูดบัตร (EDC)",
};

const FLOW_PRESETS = [
  "ฝากเงินสด", "เงินสด", "เงินโอน QR/เครดิต", "เงินโอน",
  "EDC", "คนละครึ่ง", "Wallet", "เงินโอนพื้นที่เช่า",
];

type FormState = {
  id: string | null;
  bankCode: string;
  accountNo: string;
  accountName: string;
  legalEntity: string;
  flowType: string;
  accountType: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  bankCode: "BBL",
  accountNo: "",
  accountName: "",
  legalEntity: "",
  flowType: "",
  accountType: "savings",
};

export function AccountsManager({ companyId, canEdit, accounts }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group by bank code (active first within the page-level sort)
  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.bankCode] ??= []).push(a);
    return acc;
  }, {});

  function openCreate() {
    setError(null);
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(a: Account) {
    setError(null);
    setForm({
      id: a.id,
      bankCode: a.bankCode,
      accountNo: a.accountNo,
      accountName: a.accountName,
      legalEntity: a.legalEntity ?? "",
      flowType: a.flowType ?? "",
      accountType: a.accountType,
    });
  }

  function submit() {
    if (!form) return;
    setError(null);
    const payload = {
      bankCode: form.bankCode,
      accountNo: form.accountNo,
      accountName: form.accountName,
      legalEntity: form.legalEntity,
      flowType: form.flowType,
      accountType: form.accountType,
    };
    startTransition(async () => {
      const res = form.id
        ? await updateBankAccountAction(form.id, payload)
        : await createBankAccountAction(companyId, payload);
      if (res.ok) {
        setForm(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggle(a: Account) {
    startTransition(async () => {
      const res = await toggleBankAccountActiveAction(a.id, !a.isActive);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div>
      {/* Toolbar */}
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={16} />
            เพิ่มบัญชี
          </button>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-16 text-center">
          <Landmark size={32} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">ยังไม่มีบัญชีธนาคาร</p>
          <p className="mt-1 text-xs text-zinc-400">กดปุ่ม &ldquo;เพิ่มบัญชี&rdquo; ด้านบนเพื่อเริ่ม</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([bankCode, list]) => (
            <div key={bankCode}>
              <div className="mb-2 flex items-center gap-2">
                <Landmark size={15} className="text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-700">
                  {BANK_LABELS[bankCode] ?? bankCode}
                </h3>
                <span className="text-xs text-zinc-400">({list.length})</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-100">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-50">
                    {list.map((a) => (
                      <tr
                        key={a.id}
                        className={`hover:bg-zinc-50 ${a.isActive ? "" : "bg-zinc-50/60"}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-zinc-700">{a.accountNo}</span>
                            {!a.isActive && (
                              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                                ปิดใช้งาน
                              </span>
                            )}
                            {a.accountType === "card_terminal" && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                EDC
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-zinc-600">{a.accountName}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-400">
                            {a.legalEntity && (
                              <span className="inline-flex items-center gap-1">
                                <Building2 size={11} />
                                {a.legalEntity}
                              </span>
                            )}
                            {a.flowType && <span>{a.flowType}</span>}
                          </div>
                        </td>
                        {canEdit && (
                          <td className="px-3 py-3 text-right align-top whitespace-nowrap">
                            <button
                              onClick={() => openEdit(a)}
                              disabled={pending}
                              className="mr-1 inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                            >
                              <Pencil size={12} /> แก้ไข
                            </button>
                            <button
                              onClick={() => toggle(a)}
                              disabled={pending}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50 ${
                                a.isActive
                                  ? "border-zinc-200 text-zinc-500 hover:bg-zinc-100"
                                  : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                              }`}
                            >
                              <Power size={12} />
                              {a.isActive ? "ปิด" : "เปิด"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-800">
                {form.id ? "แก้ไขบัญชีธนาคาร" : "เพิ่มบัญชีธนาคาร"}
              </h3>
              <button onClick={() => setForm(null)} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">ธนาคาร</span>
                  <select
                    value={form.bankCode}
                    onChange={(e) => setForm({ ...form, bankCode: e.target.value })}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  >
                    {BANK_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">ประเภทบัญชี</span>
                  <select
                    value={form.accountType}
                    onChange={(e) => setForm({ ...form, accountType: e.target.value })}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  >
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">เลขที่บัญชี</span>
                <input
                  value={form.accountNo}
                  onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
                  placeholder="594-0-959934"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">ชื่อ / วัตถุประสงค์</span>
                <input
                  value={form.accountName}
                  onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                  placeholder="เช่น ฝากเงินสด ชาโนนคอย/ชุมพวง"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">บริษัทเจ้าของ</span>
                  <input
                    value={form.legalEntity}
                    onChange={(e) => setForm({ ...form, legalEntity: e.target.value })}
                    placeholder="บจก.เจพีซิ้ง กรู๊ป"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">ประเภทเงิน</span>
                  <input
                    list="flow-presets"
                    value={form.flowType}
                    onChange={(e) => setForm({ ...form, flowType: e.target.value })}
                    placeholder="ฝากเงินสด"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  />
                  <datalist id="flow-presets">
                    {FLOW_PRESETS.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </label>
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setForm(null)}
                disabled={pending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

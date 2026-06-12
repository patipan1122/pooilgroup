"use client";

// LedgerLine — ผังบัญชีรายได้ (channel→GL) manager (client).
// All 7 channels listed as rows (configured or not); each row → edit modal that
// sets gl_clearing / gl_income / gl_fee / label. Backed by revenue-channels/_actions.
// Same visual tokens as AccountsManager (zinc/blue, rounded-2xl, bottom-sheet modal).

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  REVENUE_CHANNELS,
  REVENUE_CHANNEL_LABELS,
  type RevenueChannelCode,
} from "@/lib/ledger/revenue-channel-types";
import {
  upsertRevenueChannelGlAction,
  listIncomeCategoriesAction,
} from "../_actions";
import { Pencil, Wallet, X, Banknote, Building2, Receipt } from "lucide-react";

interface Row {
  channelCode: string;
  glClearing: string | null;
  glIncome: string | null;
  glFee: string | null;
  categoryId: string | null;
  categoryName: string | null;
  label: string | null;
  isActive: boolean;
}

interface Props {
  companyId: string;
  canEdit: boolean;
  rows: Row[];
}

// Conventional GL suggestion per channel (Thai SME COA): where the money lands +
// (for card/QR) the MDR fee. Shown as helper text + prefilled defaults in the modal.
const CHANNEL_HINT: Record<
  RevenueChannelCode,
  { clearing: string; clearingName: string; fee?: string; note: string }
> = {
  cash:     { clearing: "1010", clearingName: "เงินสดในมือ",       note: "เงินสดหน้าร้าน → เงินสดในมือ" },
  transfer: { clearing: "1110", clearingName: "เงินฝากธนาคาร",     note: "โอนเข้าบัญชี → เงินฝากธนาคาร" },
  card:     { clearing: "1150", clearingName: "ลูกหนี้บัตร (clearing)", fee: "5210220", note: "รูดบัตร → ลูกหนี้บัตร + ค่าธรรมเนียม MDR" },
  qr:       { clearing: "1110", clearingName: "เงินฝากธนาคาร",     note: "QR / พร้อมเพย์ → เงินฝากธนาคาร" },
  wallet:   { clearing: "1110", clearingName: "เงินฝากธนาคาร",     fee: "5210220", note: "วอลเล็ต (TrueMoney ฯลฯ) → เงินฝากธนาคาร" },
  cod:      { clearing: "1150", clearingName: "ลูกหนี้เก็บปลายทาง", note: "เก็บเงินปลายทาง → ลูกหนี้รอเก็บ" },
  other:    { clearing: "1110", clearingName: "เงินฝากธนาคาร",     note: "ช่องทางอื่น ๆ" },
};

const CHANNEL_ICON: Record<RevenueChannelCode, typeof Wallet> = {
  cash: Banknote,
  transfer: Building2,
  card: Receipt,
  qr: Wallet,
  wallet: Wallet,
  cod: Banknote,
  other: Wallet,
};

type IncomeCategory = { id: string; name: string; trcloudAccCode: string | null };

type FormState = {
  channelCode: RevenueChannelCode;
  glClearing: string;
  glIncome: string;
  glFee: string;
  categoryId: string;
  label: string;
};

export function ChannelGlManager({ companyId, canEdit, rows }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<IncomeCategory[]>([]);

  // Index existing rows by channel for quick render.
  const byChannel = new Map<string, Row>();
  for (const r of rows) byChannel.set(r.channelCode, r);

  // Lazy-load income categories the first time the modal opens (for the GL-income picker).
  useEffect(() => {
    if (form && categories.length === 0) {
      listIncomeCategoriesAction(companyId).then(setCategories).catch(() => {});
    }
  }, [form, companyId, categories.length]);

  function openEdit(channel: RevenueChannelCode) {
    setError(null);
    const existing = byChannel.get(channel);
    const hint = CHANNEL_HINT[channel];
    setForm({
      channelCode: channel,
      // Prefill the conventional GL when the channel has no config yet (gentle default).
      glClearing: existing?.glClearing ?? hint.clearing,
      glIncome: existing?.glIncome ?? "",
      glFee: existing?.glFee ?? hint.fee ?? "",
      categoryId: existing?.categoryId ?? "",
      label: existing?.label ?? REVENUE_CHANNEL_LABELS[channel],
    });
  }

  function submit() {
    if (!form) return;
    setError(null);
    startTransition(async () => {
      const res = await upsertRevenueChannelGlAction({
        companyId,
        channelCode: form.channelCode,
        glClearing: form.glClearing,
        glIncome: form.glIncome,
        glFee: form.glFee,
        categoryId: form.categoryId,
        label: form.label,
      });
      if (res.ok) {
        setForm(null);
        router.refresh();
      } else {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div>
      {/* Intro helper — non-technical Thai */}
      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-relaxed text-blue-800">
        ตั้งค่าครั้งเดียวว่า <b>เงินที่เข้าแต่ละช่องทาง</b> (เงินสด / โอน / บัตร / QR …) จะลง
        <b>ผังบัญชี</b> ไหนโดยอัตโนมัติ — ระบบจะใช้ค่านี้ติดให้รายได้ใหม่ทุกบิล เพื่อนำไปกระทบยอดกับสเตทเมนต์ธนาคารได้ตรง
        {!canEdit && (
          <span className="mt-1 block text-blue-600">
            (เฉพาะผู้ดูแลสูงสุดเท่านั้นที่แก้ไขได้ — คุณดูได้อย่างเดียว)
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-100">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-zinc-50">
            {REVENUE_CHANNELS.map((channel) => {
              const row = byChannel.get(channel);
              const hint = CHANNEL_HINT[channel];
              const Icon = CHANNEL_ICON[channel];
              const configured = !!(row?.isActive && row.glClearing);
              return (
                <tr key={channel} className={`hover:bg-zinc-50 ${configured ? "" : "bg-amber-50/30"}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <Icon size={16} className="text-zinc-400" />
                      <span className="font-semibold text-zinc-700">
                        {REVENUE_CHANNEL_LABELS[channel]}
                      </span>
                      {row?.label && row.label !== REVENUE_CHANNEL_LABELS[channel] && (
                        <span className="text-xs text-zinc-400">· {row.label}</span>
                      )}
                      {!configured && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          ยังไม่ตั้งค่า
                        </span>
                      )}
                    </div>

                    {configured ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          เงินเข้า:
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700">
                            {row?.glClearing}
                          </span>
                        </span>
                        {row?.glIncome && (
                          <span className="inline-flex items-center gap-1">
                            รายได้:
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700">
                              {row.glIncome}
                            </span>
                          </span>
                        )}
                        {row?.categoryName && <span>หมวด: {row.categoryName}</span>}
                        {row?.glFee && (
                          <span className="inline-flex items-center gap-1">
                            ค่าธรรมเนียม:
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700">
                              {row.glFee}
                            </span>
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-zinc-400">
                        แนะนำ: {hint.note}
                      </div>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-3 text-right align-top whitespace-nowrap">
                      <button
                        onClick={() => openEdit(channel)}
                        disabled={pending}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        <Pencil size={12} /> {configured ? "แก้ไข" : "ตั้งค่า"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-800">
                ผังบัญชี — {REVENUE_CHANNEL_LABELS[form.channelCode]}
              </h3>
              <button onClick={() => setForm(null)} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>
            <p className="mb-4 text-xs text-zinc-500">
              ทุกเงินที่เข้าช่องทางนี้ จะลงผังบัญชีนี้อัตโนมัติ — {CHANNEL_HINT[form.channelCode].note}
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">
                  ผังบัญชีที่เงินเข้า (clearing) <span className="text-red-400">*</span>
                </span>
                <input
                  value={form.glClearing}
                  onChange={(e) => setForm({ ...form, glClearing: e.target.value })}
                  placeholder={CHANNEL_HINT[form.channelCode].clearing}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-zinc-400">
                  แนะนำ {CHANNEL_HINT[form.channelCode].clearing} ({CHANNEL_HINT[form.channelCode].clearingName})
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">
                  หมวดรายได้ (ไม่บังคับ)
                </span>
                <select
                  value={form.categoryId}
                  onChange={(e) => {
                    const cat = categories.find((c) => c.id === e.target.value);
                    setForm({
                      ...form,
                      categoryId: e.target.value,
                      // Convenience: adopt the category's GL code as gl_income if blank.
                      glIncome: form.glIncome || cat?.trcloudAccCode || "",
                    });
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                >
                  <option value="">— ไม่ระบุ —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.trcloudAccCode ? ` (${c.trcloudAccCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">
                    ผังบัญชีรายได้ (ไม่บังคับ)
                  </span>
                  <input
                    value={form.glIncome}
                    onChange={(e) => setForm({ ...form, glIncome: e.target.value })}
                    placeholder="4xxx"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">
                    ค่าธรรมเนียม MDR (ไม่บังคับ)
                  </span>
                  <input
                    value={form.glFee}
                    onChange={(e) => setForm({ ...form, glFee: e.target.value })}
                    placeholder={CHANNEL_HINT[form.channelCode].fee ?? "5210220"}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500">ป้ายชื่อ (สำหรับมนุษย์)</span>
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="เช่น เงินสดหน้าร้าน"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                />
              </label>

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

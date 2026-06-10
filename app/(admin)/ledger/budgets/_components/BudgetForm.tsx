"use client";

// ตั้ง/แก้งบรายหมวด (upsert). ถ้ามีงบ (หมวด+สาขา+งวด) เดิมอยู่แล้ว → แก้ทับ.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertBudget } from "../../_actions";

export function BudgetForm({
  companyId,
  period,
  categories,
  branches,
}: {
  companyId: string;
  period: string;
  categories: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({
    categoryId: categories[0]?.id ?? "",
    branchId: "",
    amount: "",
    alertPct: "90",
    period,
  });

  const input =
    "h-11 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";
  const label = "mb-1 block text-xs font-semibold text-zinc-600";

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const res = await upsertBudget({
        companyId,
        categoryId: form.categoryId,
        branchId: form.branchId || "",
        period: form.period,
        amount: Number(form.amount) || 0,
        alertPct: Number(form.alertPct) || 90,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "บันทึกงบแล้ว" });
        setForm((f) => ({ ...f, amount: "" }));
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "บันทึกไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={label}>หมวด</label>
        <select
          className={input}
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        >
          {categories.length === 0 && <option value="">— ไม่มีหมวด —</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={label}>สาขา (เว้นว่าง = ทั้งบริษัท)</label>
        <select
          className={input}
          value={form.branchId}
          onChange={(e) => setForm({ ...form, branchId: e.target.value })}
        >
          <option value="">ทั้งบริษัท</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>เดือนที่ตั้งงบ</label>
          <input
            className={input}
            type="month"
            value={form.period}
            onChange={(e) => setForm({ ...form, period: e.target.value })}
            placeholder="2026-06"
          />
        </div>
        <div>
          <label className={label}>เตือนที่ %</label>
          <input
            className={input}
            type="number"
            min={0}
            max={200}
            value={form.alertPct}
            onChange={(e) => setForm({ ...form, alertPct: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className={label}>งบ (บาท)</label>
        <input
          className={input}
          inputMode="decimal"
          value={form.amount}
          onChange={(e) =>
            setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })
          }
          placeholder="0.00"
        />
      </div>

      {msg && (
        <p className={msg.ok ? "text-xs text-emerald-700" : "text-xs text-rose-600"}>
          {msg.text}
        </p>
      )}

      <Button
        variant="primary"
        fullWidth
        disabled={pending || !form.categoryId || !form.amount}
        onClick={submit}
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        บันทึกงบ
      </Button>
    </div>
  );
}

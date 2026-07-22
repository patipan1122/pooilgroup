"use client";

// จัดการหมวดค่าใช้จ่าย — เพิ่มใหม่ + เปิด/ปิดใช้งาน + ผูก GL + SKU + VAT claimable
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, Check, X, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createCategory,
  toggleCategory,
  updateCategoryTrcloud,
  seedStandardCategories,
} from "../../_actions";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { SearchableSelect } from "@/components/ledger/SearchableSelect";
import {
  EXPENSE_ACCOUNTS,
  SYSTEM_ACCOUNTS,
  STANDARD_CATEGORIES,
  accountName,
} from "@/lib/ledger/coa-chart";

const SKUS = [
  { value: "", label: "— เลือก SKU —" },
  { value: "JPS-100", label: "JPS-100 · สินค้าทั่วไป" },
  { value: "JPS-101", label: "JPS-101 · ซื้อบริการ" },
  { value: "JPS-103", label: "JPS-103 · วัสดุก่อสร้าง" },
];

// ป้ายสั้น ๆ ของ SKU สำหรับคอลัมน์ "ประเภท" ในตาราง (ให้อ่านง่ายกว่ารหัสดิบ)
const SKU_SHORT: Record<string, string> = {
  "JPS-100": "สินค้า",
  "JPS-101": "บริการ",
  "JPS-103": "วัสดุก่อสร้าง",
};

// ตัวเลือกรหัสบัญชี GL (คงที่ · มาจากผังบัญชีที่นักบัญชีรับรอง) — "รหัส · ชื่อบัญชี".
const GL_OPTIONS = EXPENSE_ACCOUNTS.map((a) => ({
  id: a.code,
  name: `${a.code} · ${a.name}`,
}));

// หาหมวดมาตรฐานที่ตรงกับหมวดนี้ (จับคู่ด้วยรหัส GL ก่อน แล้วค่อยชื่อ) เพื่อดึง wht/note.
function standardEntryFor(code: string, name: string) {
  const c = code.trim();
  const n = name.trim().toLowerCase();
  return (
    STANDARD_CATEGORIES.find((s) => s.glCode === c) ??
    STANDARD_CATEGORIES.find((s) => s.name.trim().toLowerCase() === n) ??
    null
  );
}

// ตัวอย่างการลงบัญชี (Dr/Cr) — read-only · ให้ CEO เห็นว่าเลือกหมวดนี้แล้ว "ลงบัญชียังไง".
function DrCrPreview({
  code,
  vatClaimable,
  name,
}: {
  code: string;
  vatClaimable: boolean;
  name: string;
}) {
  const std = standardEntryFor(code, name);
  const glName = accountName(code);
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-2.5">
      <p className="mb-1.5 text-[11px] font-medium text-zinc-500">ตัวอย่างการลงบัญชี</p>
      <div className="space-y-1 font-mono text-[11px]">
        {code ? (
          <div className="text-emerald-700">
            Dr {code} {glName ?? ""}
          </div>
        ) : (
          <div className="text-zinc-400">Dr — ยังไม่ได้เลือกรหัสบัญชี</div>
        )}
        {vatClaimable ? (
          <div className="text-emerald-700">
            Dr {SYSTEM_ACCOUNTS.inputVat.code} {SYSTEM_ACCOUNTS.inputVat.name}
          </div>
        ) : (
          <div className="font-sans text-zinc-400">ภาษีซื้อขอคืนไม่ได้ (รวมเป็นต้นทุน)</div>
        )}
        <div className="text-zinc-700">
          Cr {SYSTEM_ACCOUNTS.payable.code} {SYSTEM_ACCOUNTS.payable.name}
        </div>
      </div>
      {std?.wht !== undefined && (
        <p className="mt-1.5 text-[11px] text-amber-700">หัก ณ ที่จ่าย {std.wht}%</p>
      )}
      {std?.note && <p className="mt-1 text-[11px] text-zinc-500">{std.note}</p>}
    </div>
  );
}

type Cat = {
  id: string;
  name: string;
  color: string | null;
  trcloudAccCode: string | null;
  trcloudProductCode: string | null;
  vatClaimable: boolean;
  sort: number;
  active: boolean;
};

type EditState = {
  trcloudAccCode: string;
  trcloudProductCode: string;
  vatClaimable: boolean;
};

export function CategoryManager({
  companyId,
  categories,
}: {
  companyId: string;
  categories: Cat[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trcloudAccCode: "", trcloudProductCode: "", vatClaimable: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    trcloudAccCode: "",
    trcloudProductCode: "",
    vatClaimable: true,
  });
  const [accCodeError, setAccCodeError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [unboundOnly, setUnboundOnly] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  // จำนวนหมวดที่ยังไม่ผูก "รหัสบัญชี GL" — ตัวชี้วัดว่ายังตั้งค่าไม่ครบกี่หมวด.
  const unboundCount = useMemo(
    () => categories.filter((c) => !c.trcloudAccCode).length,
    [categories],
  );

  const input =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  // ค้นหา/กรอง/เรียง ในรายการที่โหลดมาแล้ว (client-side)
  // - ค้นหา: ชื่อหมวด หรือ รหัสบัญชี GL
  // - กรอง "ยังไม่ผูก TRCloud": เฉพาะหมวดที่ยังไม่มีทั้ง GL และ SKU
  // - เรียง: ใช้งานอยู่ก่อนปิดใช้งาน, ในกลุ่มเดียวกันคงลำดับ sort เดิม
  const visibleCategories = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const filtered = categories.filter((c) => {
      if (unboundOnly && (c.trcloudAccCode || c.trcloudProductCode)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.trcloudAccCode ?? "").toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.sort - b.sort;
    });
  }, [categories, filterText, unboundOnly]);

  function startEdit(c: Cat) {
    setEditingId(c.id);
    setAccCodeError(null);
    setEditState({
      trcloudAccCode: c.trcloudAccCode ?? "",
      trcloudProductCode: c.trcloudProductCode ?? "",
      vatClaimable: c.vatClaimable,
    });
  }

  function saveEdit(id: string) {
    // Validate GL code: must be exactly 7 digits if provided
    const code = editState.trcloudAccCode.trim();
    if (code && !/^[0-9]{7}$/.test(code)) {
      setAccCodeError("รหัสบัญชีต้องเป็นตัวเลข 7 หลัก เช่น 5101001");
      return;
    }
    setAccCodeError(null);
    startTransition(async () => {
      const res = await updateCategoryTrcloud({
        id,
        trcloudAccCode: code,
        trcloudProductCode: editState.trcloudProductCode,
        vatClaimable: editState.vatClaimable,
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setMsg(res.error ?? "บันทึกไม่สำเร็จ");
      }
    });
  }

  function add() {
    if (!form.name.trim()) return;
    const code = form.trcloudAccCode.trim();
    if (code && !/^[0-9]{7}$/.test(code)) {
      setMsg("รหัสบัญชีต้องเป็นตัวเลข 7 หลัก เช่น 5101001");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createCategory({
        companyId,
        name: form.name.trim(),
        trcloudAccCode: code,
        trcloudProductCode: form.trcloudProductCode,
        vatClaimable: form.vatClaimable,
      });
      if (res.ok) {
        setForm({ name: "", trcloudAccCode: "", trcloudProductCode: "", vatClaimable: false });
        router.refresh();
      } else {
        setMsg(res.error ?? "เพิ่มไม่สำเร็จ");
      }
    });
  }

  function toggle(id: string, active: boolean) {
    startTransition(async () => {
      await toggleCategory(id, active);
      router.refresh();
    });
  }

  // สร้างหมวดมาตรฐานทั้งชุดในครั้งเดียว (ข้ามหมวดที่ชื่อซ้ำ) → refresh + สรุปผล.
  function seed() {
    setSeedMsg(null);
    startTransition(async () => {
      const res = await seedStandardCategories(companyId);
      if (res.ok) {
        setSeedMsg(`สร้าง ${res.created ?? 0} หมวด · มีอยู่แล้ว ${res.skipped ?? 0}`);
        router.refresh();
      } else {
        setSeedMsg(res.error ?? "สร้างหมวดมาตรฐานไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      {/* Add form */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={`${input} flex-1`}
            placeholder="ชื่อหมวด เช่น ค่าน้ำมัน/ขนส่ง"
            value={form.name}
            onChange={(e) => { setMsg(null); setForm({ ...form, name: e.target.value }); }}
          />
          <SearchableSelect
            className="sm:w-56"
            label="รหัสบัญชี GL"
            placeholder="— เลือกรหัสบัญชี —"
            searchPlaceholder="ค้นหารหัส/ชื่อบัญชี…"
            options={GL_OPTIONS}
            value={form.trcloudAccCode}
            onChange={(code) => { setMsg(null); setForm({ ...form, trcloudAccCode: code }); }}
          />
          <select
            aria-label="SKU TRCloud"
            className={`${input} sm:w-44`}
            value={form.trcloudProductCode}
            onChange={(e) => setForm({ ...form, trcloudProductCode: e.target.value })}
          >
            {SKUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              className="rounded"
              checked={form.vatClaimable}
              onChange={(e) => setForm({ ...form, vatClaimable: e.target.checked })}
            />
            <span>VAT ขอคืนได้ <span className="text-zinc-400">(เปิดถ้ามีใบกำกับภาษีแบบเต็มจากผู้ขายจด VAT)</span></span>
          </label>
          <Button variant="primary" disabled={pending || !form.name.trim()} onClick={add}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            เพิ่ม
          </Button>
        </div>
      </div>
      {msg && <p className="mb-2 text-xs text-rose-600">{msg}</p>}

      {/* Summary + สร้างหมวดมาตรฐาน — โชว์เสมอ (รวมตอนยังไม่มีหมวดเลย จะได้ seed ได้) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
        <div className="text-xs text-zinc-600">
          หมวดที่ยังไม่ผูกรหัสบัญชี:{" "}
          <span className={unboundCount > 0 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
            {unboundCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {seedMsg && <span className="text-[11px] text-zinc-500">{seedMsg}</span>}
          <Button variant="secondary" disabled={pending} onClick={seed}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            สร้างหมวดมาตรฐาน ({STANDARD_CATEGORIES.length} หมวด)
          </Button>
        </div>
      </div>

      {/* Search + filter — ทำงานบนรายการที่โหลดมาแล้ว */}
      {categories.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              type="search"
              placeholder="ค้นหาหมวด หรือ รหัสบัญชี GL…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              aria-label="ค้นหาหมวดค่าใช้จ่าย"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-brand-200)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setUnboundOnly((v) => !v)}
            aria-pressed={unboundOnly ? "true" : "false"}
            className={
              "inline-flex h-9 shrink-0 items-center justify-center rounded-lg border px-3 text-xs font-medium " +
              (unboundOnly
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50")
            }
          >
            เฉพาะที่ยังไม่ผูก TRCloud
          </button>
        </div>
      )}

      {/* List */}
      {categories.length === 0 ? (
        <LedgerEmptyState
          mascotSize={48}
          className="py-6"
          title="ยังไม่มีหมวด"
          hint="เพิ่มหมวดแรกด้านบน เช่น ค่าน้ำมัน/ขนส่ง"
        />
      ) : visibleCategories.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400">ไม่พบหมวดที่ค้นหา</p>
      ) : (
        <div className="overflow-x-auto">
          {/* คำอธิบายสั้น ๆ ว่าทุกใบลงบัญชีแบบเดียวกัน — กัน CEO งงว่า "ลงบัญชียังไง" */}
          <div className="mb-2 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">💡 ทุกใบลงบัญชีแบบเดียวกัน — <b>Dr</b> บัญชีค่าใช้จ่าย (ตามหมวดที่เลือก) <b>+ Dr</b> ภาษีซื้อ 1432000 (ถ้า VAT ขอคืนได้) <b>/ Cr</b> เจ้าหนี้การค้า 2101000</div>
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] font-medium text-zinc-500">
                <th className="py-2 pr-3 text-left font-medium">หมวดค่าใช้จ่าย</th>
                <th className="py-2 pr-3 text-left font-medium">รหัสบัญชี</th>
                <th className="py-2 pr-3 text-left font-medium">ชื่อบัญชี</th>
                <th className="py-2 pr-3 text-left font-medium">ประเภท</th>
                <th className="py-2 pr-3 text-center font-medium">VAT ขอคืน</th>
                <th className="py-2 pr-3 text-center font-medium">หัก ณ ที่จ่าย</th>
                <th className="py-2 pl-3 text-right font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibleCategories.map((c) => {
                if (editingId === c.id) {
                  // แถวแก้ไข — กินเต็มความกว้าง (colSpan 7) แล้ววาง edit panel เดิมไว้ข้างในไม่แตะไส้ใน
                  return (
                    <tr key={c.id}>
                      <td colSpan={7} className="py-2">
                        {/* Expanded edit panel — bordered card below the row */}
                        <div className="rounded-xl border border-[var(--color-brand-200,theme(colors.violet.200))] bg-zinc-50 p-3">
                          {/* Panel header */}
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-zinc-800">{c.name}</span>
                            <button
                              type="button"
                              aria-label="ปิดแก้ไข"
                              onClick={() => { setEditingId(null); setAccCodeError(null); }}
                              disabled={pending}
                              className="rounded-md p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                            >
                              <X className="size-4" />
                            </button>
                          </div>

                          {/* Fields grid — 2-col on sm+ */}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {/* GL code */}
                            <div>
                              <label className="mb-1 block text-xs font-medium text-zinc-600">
                                รหัสบัญชี GL
                              </label>
                              <SearchableSelect
                                label="รหัสบัญชี GL"
                                placeholder="— เลือกรหัสบัญชี —"
                                searchPlaceholder="ค้นหารหัส/ชื่อบัญชี…"
                                options={GL_OPTIONS}
                                value={editState.trcloudAccCode}
                                onChange={(code) => {
                                  setAccCodeError(null);
                                  setEditState({ ...editState, trcloudAccCode: code });
                                }}
                                selectClassName={accCodeError ? "border-rose-400 focus:ring-rose-300" : ""}
                              />
                              {accCodeError ? (
                                <p className="mt-0.5 text-[11px] text-rose-600">{accCodeError}</p>
                              ) : (
                                <p className="mt-0.5 text-[11px] text-zinc-500">เลือกจากผังบัญชี TRCloud (รหัส · ชื่อบัญชี)</p>
                              )}
                            </div>

                            {/* SKU select — option labels include description; hint echoes selection */}
                            <div>
                              <label className="mb-1 block text-xs font-medium text-zinc-600">
                                SKU สินค้า TRCloud
                              </label>
                              <select
                                aria-label="SKU สินค้า TRCloud"
                                className={`${input} w-full`}
                                value={editState.trcloudProductCode}
                                onChange={(e) =>
                                  setEditState({ ...editState, trcloudProductCode: e.target.value })
                                }
                              >
                                {SKUS.map((s) => (
                                  <option key={s.value} value={s.value}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-0.5 text-[11px] text-zinc-500">
                                {editState.trcloudProductCode
                                  ? (SKUS.find((s) => s.value === editState.trcloudProductCode)?.label ?? "")
                                  : "เลือก SKU ที่ตรงกับประเภทค่าใช้จ่าย"}
                              </p>
                            </div>
                          </div>

                          {/* VAT checkbox */}
                          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={editState.vatClaimable}
                              onChange={(e) =>
                                setEditState({ ...editState, vatClaimable: e.target.checked })
                              }
                            />
                            <span>
                              VAT ขอคืนได้{" "}
                              <span className="text-zinc-400">(ปิดถ้าซื้อจากผู้ขายไม่จด VAT)</span>
                            </span>
                          </label>

                          {/* ตัวอย่างการลงบัญชี — อัปเดตสดตามรหัส/VAT ที่กำลังเลือก */}
                          <DrCrPreview
                            code={editState.trcloudAccCode}
                            vatClaimable={editState.vatClaimable}
                            name={c.name}
                          />

                          {/* Action bar */}
                          <div className="mt-3 flex justify-end gap-2 border-t border-zinc-200 pt-3">
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setAccCodeError(null); }}
                              disabled={pending}
                              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                            >
                              ยกเลิก
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(c.id)}
                              disabled={pending}
                              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
                            >
                              {pending ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Check className="size-3" />
                              )}
                              บันทึก
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                // แถวแสดงผลปกติ — 7 คอลัมน์ ให้กวาดตาอ่านได้ทีเดียว
                const std = standardEntryFor(c.trcloudAccCode ?? "", c.name);
                return (
                  <tr key={c.id} className={c.active ? "align-top" : "align-top text-zinc-400"}>
                    {/* 1. หมวดค่าใช้จ่าย */}
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-zinc-800">{c.name}</span>
                      {!c.active && (
                        <Badge tone="neutral" className="ml-2 text-[10px]">
                          ปิดใช้งาน
                        </Badge>
                      )}
                    </td>
                    {/* 2. รหัสบัญชี */}
                    <td className="py-2.5 pr-3 font-mono text-xs text-zinc-600">
                      {c.trcloudAccCode ? (
                        c.trcloudAccCode
                      ) : (
                        <span className="text-amber-600">— ยังไม่ผูก —</span>
                      )}
                    </td>
                    {/* 3. ชื่อบัญชี */}
                    <td className="py-2.5 pr-3 text-zinc-600">
                      {accountName(c.trcloudAccCode) ?? "—"}
                    </td>
                    {/* 4. ประเภท (SKU ป้ายสั้น) */}
                    <td className="py-2.5 pr-3 text-xs text-zinc-600">
                      {c.trcloudProductCode
                        ? (SKU_SHORT[c.trcloudProductCode] ?? c.trcloudProductCode)
                        : "—"}
                    </td>
                    {/* 5. VAT ขอคืน */}
                    <td className="py-2.5 pr-3 text-center">
                      {c.vatClaimable ? (
                        <span className="text-emerald-600">✓ ได้</span>
                      ) : (
                        <span className="text-zinc-400">✕ ไม่ได้</span>
                      )}
                    </td>
                    {/* 6. หัก ณ ที่จ่าย */}
                    <td className="py-2.5 pr-3 text-center text-xs text-zinc-600">
                      {std?.wht ? `${std.wht}%` : "—"}
                    </td>
                    {/* 7. จัดการ */}
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          aria-label="แก้ไข GL/SKU"
                          onClick={() => startEdit(c)}
                          disabled={pending}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(c.id, !c.active)}
                          disabled={pending}
                          className="text-xs font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
                        >
                          {c.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

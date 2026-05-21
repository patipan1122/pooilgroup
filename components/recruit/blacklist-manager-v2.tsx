"use client";

// Blacklist Manager v2 — redesigned per canvas Section 07
// Severity badges + table layout + cleaner add modal

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addToBlacklist, removeFromBlacklist } from "@/lib/recruit/actions";
import { Plus, ShieldCheck, Trash2, X, AlertTriangle } from "lucide-react";

type Severity = "critical" | "medium" | "low";

interface Entry {
  id: string;
  fullName: string;
  phone: string | null;
  reason: string;
  scope: "POOIL" | "JPSYNC" | "BOTH";
  addedAt: string;
  addedBy: string;
  expiresAt: string;
  severity: Severity;
}

interface Props {
  active: Entry[];
  expired: Entry[];
  removed: Entry[];
  canWrite: boolean;
  canRemove: boolean;
}

const SEVERITY_META: Record<
  Severity,
  { label: string; bg: string; text: string; border: string }
> = {
  critical: {
    label: "Critical",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  medium: {
    label: "Medium",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  low: {
    label: "Low",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
};

export function BlacklistManagerV2({
  active,
  expired,
  removed,
  canWrite,
  canRemove,
}: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [tab, setTab] = useState<"active" | "expired" | "removed">("active");
  const lists = { active, expired, removed };

  return (
    <div className="space-y-3">
      {/* Tab + add row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(["active", "expired", "removed"] as const).map((t) => {
            const isActive = tab === t;
            const cls = isActive
              ? t === "active"
                ? "bg-red-600 text-white"
                : "bg-zinc-700 text-white"
              : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`text-xs h-9 px-3 rounded-full font-bold inline-flex items-center gap-1.5 ${cls}`}
              >
                {t === "active" ? "ใช้งานอยู่" : t === "expired" ? "หมดอายุ" : "ถอนแล้ว"}
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-num ${
                    isActive ? "bg-white/30" : "bg-zinc-100"
                  }`}
                >
                  {lists[t].length}
                </span>
              </button>
            );
          })}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-red-600 px-3.5 h-9 rounded-lg hover:bg-red-700"
          >
            <Plus className="size-3.5" />
            เพิ่ม Blacklist
          </button>
        )}
      </div>

      {/* Add modal */}
      {showAddForm && (
        <div
          className="fixed inset-0 z-50 bg-zinc-900/60 flex items-center justify-center p-4"
          onClick={() => setShowAddForm(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <AddForm onClose={() => setShowAddForm(false)} />
          </div>
        </div>
      )}

      {/* List */}
      {lists[tab].length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white py-12 text-center">
          <ShieldCheck className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 text-sm font-bold text-zinc-700">
            {tab === "active"
              ? "ยังไม่มีคนใน Blacklist · ดีไม่มีปัญหา 👍"
              : tab === "expired"
                ? "ยังไม่มีรายการหมดอายุ"
                : "ยังไม่มีรายการถอน"}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          {/* Header */}
          <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 bg-zinc-50/60 border-b border-zinc-200 text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
            <div className="col-span-3">ระดับ + ชื่อ</div>
            <div className="col-span-4">เหตุผล</div>
            <div className="col-span-2">เพิ่มโดย</div>
            <div className="col-span-2">หมดอายุ</div>
            <div className="col-span-1" />
          </div>
          <div className="divide-y divide-zinc-100">
            {lists[tab].map((e) => (
              <BlacklistRowV2
                key={e.id}
                entry={e}
                canRemove={canRemove && tab === "active"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ onClose }: { onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        await addToBlacklist({ fullName, phone: phone || undefined, reason });
        toast.success("เพิ่ม Blacklist แล้ว");
        onClose();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="size-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
            <AlertTriangle className="size-4" />
          </span>
          <h2 className="text-lg font-extrabold font-display text-zinc-900">
            เพิ่มเข้า Blacklist
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="size-8 rounded-lg hover:bg-zinc-100 grid place-items-center"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1.5">
            ชื่อ-นามสกุล *
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="เช่น สมชาย ใจดี"
            maxLength={120}
            className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-300"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1.5">
            เบอร์โทร (ถ้ามี)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0812345678"
            maxLength={10}
            className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-300"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-700 mb-1.5">
            เหตุผล * <span className="text-zinc-400 font-normal">(อย่างน้อย 20 ตัวอักษร)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ระบุชัดเจน · อ้างถึงเหตุการณ์ที่เกิด · มีหลักฐานประกอบดียิ่งขึ้น"
            rows={4}
            maxLength={1000}
            className="w-full px-3 py-2 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            {reason.length}/1000 อักษร · ต้อง ≥ 20 อักษร
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
          ⚖️ ตามกฎหมาย PDPA · Blacklist ต้องมีเหตุผลชัดเจน + ผู้บันทึกรับผิดชอบ · เก็บ
          audit log · หมดอายุอัตโนมัติใน 5 ปี
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold px-4 h-10 rounded-lg text-zinc-600 hover:bg-zinc-100"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !fullName.trim() || reason.trim().length < 20}
            className="text-xs font-bold text-white bg-red-600 px-5 h-10 rounded-lg hover:bg-red-700 disabled:opacity-40"
          >
            {pending ? "กำลังบันทึก..." : "ยืนยันเพิ่มเข้า Blacklist"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BlacklistRowV2({
  entry,
  canRemove,
}: {
  entry: Entry;
  canRemove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const sev = SEVERITY_META[entry.severity];

  function remove() {
    if (!confirm(`ถอน ${entry.fullName} ออกจาก Blacklist?`)) return;
    startTransition(async () => {
      try {
        await removeFromBlacklist(entry.id);
        toast.success("ถอนแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const expiryDate = new Date(entry.expiresAt);
  const daysLeft = Math.floor(
    (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  const expiryLabel =
    daysLeft > 365
      ? `อีก ${Math.floor(daysLeft / 365)} ปี`
      : daysLeft > 30
        ? `อีก ${Math.floor(daysLeft / 30)} เดือน`
        : daysLeft > 0
          ? `อีก ${daysLeft} วัน`
          : "หมดอายุแล้ว";

  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 items-start">
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sev.bg} ${sev.text} ${sev.border}`}
          >
            {sev.label}
          </span>
        </div>
        <p className="font-bold text-zinc-900 text-sm">{entry.fullName}</p>
        {entry.phone && (
          <p className="text-xs text-zinc-500 font-mono mt-0.5">{entry.phone}</p>
        )}
      </div>
      <div className="md:col-span-4">
        <p className="text-sm text-zinc-700 leading-relaxed line-clamp-3">
          {entry.reason}
        </p>
      </div>
      <div className="md:col-span-2 text-xs text-zinc-600">
        <p className="font-medium">{entry.addedBy}</p>
        <p className="text-zinc-400">
          {new Date(entry.addedAt).toLocaleDateString("th-TH")}
        </p>
      </div>
      <div className="md:col-span-2 text-xs">
        <p className="font-bold text-zinc-700">{expiryLabel}</p>
        <p className="text-zinc-400">
          {expiryDate.toLocaleDateString("th-TH")}
        </p>
      </div>
      <div className="md:col-span-1 flex md:justify-end">
        {canRemove && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            title="ถอนจาก Blacklist"
            className="size-9 rounded-lg border border-zinc-200 text-zinc-500 hover:text-red-700 hover:border-red-200 hover:bg-red-50 flex items-center justify-center"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

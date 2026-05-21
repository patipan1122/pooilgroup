"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addToBlacklist, removeFromBlacklist } from "@/lib/recruit/actions";
import { Plus, ShieldCheck, Trash2, X } from "lucide-react";

interface Entry {
  id: string;
  fullName: string;
  phone: string | null;
  reason: string;
  scope: "POOIL" | "JPSYNC" | "BOTH";
  addedAt: string;
  addedBy: string;
  expiresAt: string;
}

interface Props {
  active: Entry[];
  expired: Entry[];
  removed: Entry[];
  canWrite: boolean;
  canRemove: boolean;
}

export function BlacklistManager({
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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(["active", "expired", "removed"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`text-sm h-10 px-4 rounded-full font-medium ${
                tab === t
                  ? "bg-[var(--color-brand-100)] text-[var(--color-brand-800)]"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t === "active" ? "ใช้งานอยู่" : t === "expired" ? "หมดอายุ" : "ถอนแล้ว"}
              <span className="ml-1.5 tabular-num">{lists[t].length}</span>
            </button>
          ))}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-10 rounded-xl hover:bg-[var(--color-brand-700)]"
          >
            <Plus className="size-4" />
            เพิ่ม Blacklist
          </button>
        )}
      </div>

      {showAddForm && <AddForm onClose={() => setShowAddForm(false)} />}

      <div className="space-y-2">
        {lists[tab].length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white py-12 text-center">
            <ShieldCheck className="size-10 mx-auto text-zinc-300" />
            <p className="mt-3 text-sm font-bold text-zinc-700">
              {tab === "active"
                ? "ยังไม่มีคนใน Blacklist"
                : tab === "expired"
                  ? "ยังไม่มีรายการที่หมดอายุ"
                  : "ยังไม่มีรายการที่ถอน"}
            </p>
            {tab === "active" && (
              <p className="text-xs text-zinc-500 mt-1">
                กดปุ่ม &quot;เพิ่ม Blacklist&quot; ด้านบนเมื่อเจอเคสที่ต้องบันทึก
              </p>
            )}
          </div>
        ) : (
          lists[tab].map((e) => (
            <BlacklistRow
              key={e.id}
              entry={e}
              canRemove={canRemove && tab === "active"}
            />
          ))
        )}
      </div>
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
    <div className="rounded-2xl border-2 border-red-200 bg-red-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-bold text-red-900 text-sm">เพิ่มเข้า Blacklist</p>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="ชื่อ-นามสกุล"
          className="h-11 px-3 rounded-xl border border-zinc-300"
          maxLength={120}
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="เบอร์โทร (ถ้ามี)"
          className="h-11 px-3 rounded-xl border border-zinc-300"
          maxLength={10}
        />
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เหตุผล (อย่างน้อย 20 ตัวอักษร · ระบุชัดเจน · อ้างถึงเหตุการณ์ที่เกิด)"
        rows={3}
        className="w-full px-3 py-2 rounded-xl border border-zinc-300"
        maxLength={1000}
      />
      <p className="text-xs text-zinc-600">
        ⚖️ Blacklist จะหมดอายุอัตโนมัติใน 5 ปี · เก็บ audit log ผู้บันทึก
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-sm px-4 h-10 rounded-lg text-zinc-600 hover:bg-zinc-100"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !fullName.trim() || reason.trim().length < 20}
          className="text-sm font-bold text-white bg-red-600 px-4 h-10 rounded-lg hover:bg-red-700 disabled:opacity-40"
        >
          {pending ? "กำลังบันทึก..." : "เพิ่มเข้า Blacklist"}
        </button>
      </div>
    </div>
  );
}

function BlacklistRow({
  entry,
  canRemove,
}: {
  entry: Entry;
  canRemove: boolean;
}) {
  const [pending, startTransition] = useTransition();

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

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-zinc-900">{entry.fullName}</p>
          {entry.phone && (
            <p className="text-xs text-zinc-500 mt-0.5">📞 {entry.phone}</p>
          )}
          <p className="text-sm text-zinc-700 mt-2 leading-relaxed">
            {entry.reason}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500 flex-wrap">
            <span>เพิ่ม: {entry.addedBy}</span>
            <span className="text-zinc-300">·</span>
            <span>{new Date(entry.addedAt).toLocaleDateString("th-TH")}</span>
            <span className="text-zinc-300">·</span>
            <span>หมดอายุ: {new Date(entry.expiresAt).toLocaleDateString("th-TH")}</span>
            <span className="text-zinc-300">·</span>
            <span>{entry.scope === "BOTH" ? "ทั้งคู่" : entry.scope}</span>
          </div>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-sm text-red-600 hover:bg-red-50 px-3 h-10 rounded-lg flex items-center gap-1.5 shrink-0"
          >
            <Trash2 className="size-4" />
            ถอน
          </button>
        )}
      </div>
    </div>
  );
}

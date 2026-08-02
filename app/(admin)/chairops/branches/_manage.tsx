"use client";

// CEO 2026-08-02 Pinpoint · self-service controls on /chairops/branches.
// Three tiny client widgets that call the OFFICE+ server actions and refresh
// the RSC on success. Kept compact (RULE L density budget): a control is a
// single button that reveals ONE inline form row, never a permanent card.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Check, X } from "lucide-react";
import { MALL_RAIL_ORDER, MALL_GROUPS } from "@/lib/chairops/utils/mall-groups";
import { createBranch, addSingleChair, renameChair } from "./actions";

// ── ＋ เพิ่มสาขา (list head) ─────────────────────────────────────────────────
export function AddBranchButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mallGroup, setMallGroup] = useState("");
  const [floor, setFloor] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      const res = await createBranch({
        name,
        mallGroup: mallGroup || undefined,
        floor: floor || undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setName("");
      setMallGroup("");
      setFloor("");
      setOpen(false);
      // Land on the new branch so the CEO can add chairs immediately.
      router.push(`/chairops/branches?branch=${res.data.branchId}&tab=chairs`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)} type="button">
        <Plus size={13} /> เพิ่มสาขา
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-background p-3 text-sm shadow-sm">
      <div className="mb-2 font-medium">เพิ่มสาขาใหม่</div>
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อสาขา (เช่น Central พระราม 2)"
          className="h-9 rounded-md border border-border bg-background px-2"
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
        />
        <div className="flex gap-2">
          <select
            value={mallGroup}
            onChange={(e) => setMallGroup(e.target.value)}
            className="h-9 flex-1 rounded-md border border-border bg-background px-2"
            aria-label="ห้าง"
          >
            <option value="">ห้าง (ไม่บังคับ)</option>
            {MALL_RAIL_ORDER.map((k) => (
              <option key={k} value={k}>
                {MALL_GROUPS[k].label}
              </option>
            ))}
          </select>
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="ชั้น (ไม่บังคับ)"
            className="h-9 w-24 rounded-md border border-border bg-background px-2"
          />
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
          >
            {pending ? "กำลังบันทึก…" : "บันทึกสาขา"}
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setOpen(false);
              setErr(null);
            }}
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ＋ เพิ่มเก้าอี้ (chairs tab) ──────────────────────────────────────────────
export function AddChairForm({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    setOk(null);
    start(async () => {
      const res = await addSingleChair({
        branchId,
        chairCode: code,
        name: name || undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setCode("");
      setName("");
      setOk(res.data.created ? `เพิ่ม ${res.data.chairCode} แล้ว` : `${res.data.chairCode} มีอยู่แล้ว`);
      router.refresh();
    });
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2 text-sm">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="รหัสเก้าอี้ (เช่น G0318264)"
        className="h-9 w-48 rounded-md border border-border bg-background px-2 font-mono"
        onKeyDown={(e) => e.key === "Enter" && code.trim() && submit()}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ชื่อเล่น (ไม่บังคับ)"
        className="h-9 w-40 rounded-md border border-border bg-background px-2"
        onKeyDown={(e) => e.key === "Enter" && code.trim() && submit()}
      />
      <button
        className="btn btn-sm btn-primary"
        type="button"
        onClick={submit}
        disabled={pending || !code.trim()}
      >
        <Plus size={13} /> {pending ? "กำลังเพิ่ม…" : "เพิ่มเก้าอี้"}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
      {ok && <span className="text-xs text-emerald-600">{ok}</span>}
    </div>
  );
}

// ── ✎ ตั้ง/แก้ชื่อเล่นเก้าอี้ (per chair card) ───────────────────────────────
export function ChairNameEditor({
  chairId,
  name,
}: {
  chairId: string;
  name: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await renameChair({ chairId, name: value });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(name ?? "");
          setEditing(true);
        }}
        title="ตั้ง/แก้ชื่อเล่น"
        className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
      >
        {name ? <span className="font-medium text-foreground">{name}</span> : <span>ตั้งชื่อ</span>}
        <Pencil size={10} />
      </button>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ชื่อเล่น"
        className="h-6 w-24 rounded border border-border bg-background px-1 text-[11px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        title="บันทึก"
        className="text-emerald-600 disabled:opacity-50"
      >
        <Check size={13} />
      </button>
      <button type="button" onClick={() => setEditing(false)} title="ยกเลิก" className="text-muted-foreground">
        <X size={13} />
      </button>
    </div>
  );
}

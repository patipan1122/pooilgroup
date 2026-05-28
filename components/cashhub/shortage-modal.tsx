"use client";

import { useEffect, useState } from "react";
import { User, AlertCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { formatBaht } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface PersonOption {
  id: string;
  name: string;
}

export interface ShortageInfo {
  amount: number;
  personId: string | null;
  personName: string | null;
  isIdentified: boolean;
  note: string | null;
}

interface Props {
  open: boolean;
  amount: number;
  branchId: string;
  initial?: ShortageInfo | null;
  onClose: () => void;
  onConfirm: (info: ShortageInfo) => void;
}

export function ShortageModal({
  open,
  amount,
  branchId,
  initial,
  onClose,
  onConfirm,
}: Props) {
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [mode, setMode] = useState<"identified" | "unknown">("identified");
  const [personId, setPersonId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Initialize form state from `initial` prop เมื่อ modal เปิดใหม่
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPersonId(initial?.personId ?? "");
    setNote(initial?.note ?? "");
    setMode(initial?.isIdentified === false ? "unknown" : "identified");

    let cancelled = false;
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/admin/branches?branchId=${branchId}&onlyMembers=1`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setPeople(j.members ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setPeople([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, branchId, initial]);

  function handleSubmit() {
    if (mode === "identified") {
      if (!personId) return;
      const person = people.find((p) => p.id === personId);
      onConfirm({
        amount,
        personId,
        personName: person?.name ?? null,
        isIdentified: true,
        note: note.trim() || null,
      });
    } else {
      onConfirm({
        amount,
        personId: null,
        personName: null,
        isIdentified: false,
        note: note.trim() || "รวมร้าน",
      });
    }
    onClose();
  }

  const canSubmit =
    mode === "unknown" || (mode === "identified" && personId !== "");

  return (
    <Dialog open={open} onClose={onClose} title="ระบุเงินขาด">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-900">
              เงินขาด {formatBaht(amount)}
            </div>
            <div className="text-xs text-amber-800 mt-0.5">
              ระบุข้อมูลก่อนส่งรายงาน — Owner จะเห็นในรายงานเงินขาดรายเดือน
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-100 rounded-xl">
          <button
            type="button"
            onClick={() => setMode("identified")}
            className={cn(
              "py-2 rounded-lg text-sm font-medium transition-colors",
              mode === "identified"
                ? "bg-white shadow-soft text-zinc-900"
                : "text-zinc-600",
            )}
          >
            ระบุชื่อได้
          </button>
          <button
            type="button"
            onClick={() => setMode("unknown")}
            className={cn(
              "py-2 rounded-lg text-sm font-medium transition-colors",
              mode === "unknown"
                ? "bg-white shadow-soft text-zinc-900"
                : "text-zinc-600",
            )}
          >
            รวมร้าน (ระบุไม่ได้)
          </button>
        </div>

        {mode === "identified" ? (
          <Field label="ชื่อพนักงาน" required>
            {loading ? (
              <div className="h-12 rounded-xl shimmer" />
            ) : people.length === 0 ? (
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 text-sm text-zinc-500">
                ไม่มีพนักงาน assigned สาขานี้ — แสดงว่าผู้ใช้ของระบบทุกคน
                ยังไม่ได้ผูกกับสาขานี้
                <br />
                <span className="text-xs">
                  ลอง &quot;รวมร้าน&quot; ไปก่อน หรือไปเพิ่มพนักงานที่{" "}
                  <a href="/users" className="underline" target="_blank">
                    /users
                  </a>
                </span>
              </div>
            ) : (
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
              >
                <option value="">— เลือกชื่อ —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 text-sm text-zinc-600 flex items-start gap-2">
            <User className="size-4 mt-0.5 shrink-0" />
            <span>
              ระบุไม่ได้ว่าใครขาด — เก็บไว้เป็น &quot;รวมร้าน&quot;
              เพื่อสรุปยอดรายเดือน
            </span>
          </div>
        )}

        <Field label="หมายเหตุ" optional>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น สลับช่วงกะ ยังเช็คไม่จบ"
            maxLength={200}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            fullWidth
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            fullWidth
          >
            ยืนยัน
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

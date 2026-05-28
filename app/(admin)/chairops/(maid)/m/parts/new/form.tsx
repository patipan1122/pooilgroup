"use client";

// Maid mobile parts-request form (mockup Phone "PartsForm").
//   - part typeahead (datalist from catalog)
//   - quantity spinner (− / qty / +)
//   - reason text
//   - submit → requestPartFromMaid (PENDING movement · audit)
// Idempotency key generated client-side, regenerated on error so legit retries
// aren't dedup'd against a failed attempt.
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Minus, Package, Plus, Search } from "lucide-react";
import { requestPartFromMaid } from "@/lib/chairops/parts/actions";
import { newIdempotencyKey } from "@/lib/chairops/utils/idempotency";

interface PartOption {
  id: string;
  partCode: string;
  name: string;
  unit: string;
}

export function MaidPartsForm({ parts }: { parts: ReadonlyArray<PartOption> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  const listId = useId();
  const reasonId = useId();

  // Resolve typed text → part. Match by "CODE · name" or exact code/name.
  const selected = useMemo<PartOption | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      parts.find(
        (p) =>
          `${p.partCode} · ${p.name}`.toLowerCase() === q ||
          p.partCode.toLowerCase() === q ||
          p.name.toLowerCase() === q,
      ) ?? null
    );
  }, [query, parts]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      toast.error("เลือกอะไหล่จากรายการก่อน");
      return;
    }
    if (qty < 1) {
      toast.error("จำนวนต้องมากกว่า 0");
      return;
    }
    if (!reason.trim()) {
      toast.error("ระบุเหตุผลที่เบิก");
      return;
    }

    startTransition(async () => {
      const res = await requestPartFromMaid({
        partId: selected.id,
        quantity: qty,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      if (!res.ok) {
        idempotencyKeyRef.current = newIdempotencyKey();
        toast.error(res.error);
        return;
      }
      toast.success("ส่งคำขอเบิกแล้ว · รอออฟฟิศอนุมัติ");
      router.push("/chairops/m");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardBody className="space-y-2 p-4">
          <label htmlFor={listId} className="text-sm font-semibold text-zinc-800">
            เลือกของที่ต้องการเบิก
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <Input
              id={listId}
              type="text"
              list={`${listId}-options`}
              autoComplete="off"
              placeholder="พิมพ์ชื่อ/รหัสอะไหล่"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 pl-9 text-base"
            />
            <datalist id={`${listId}-options`}>
              {parts.map((p) => (
                <option key={p.id} value={`${p.partCode} · ${p.name}`} />
              ))}
            </datalist>
          </div>
          {selected ? (
            <p className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Package className="size-3.5" aria-hidden /> เลือก: {selected.name}{" "}
              ({selected.unit})
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              {parts.length === 0
                ? "ยังไม่มีอะไหล่ในคลัง · ติดต่อออฟฟิศ"
                : "เลือกจากรายการที่เด้งขึ้นมา"}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Quantity spinner (mockup .co-qty) */}
      <Card>
        <CardBody className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm font-semibold text-zinc-800">จำนวน</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={pending || qty <= 1}
              aria-label="ลดจำนวน"
              className="grid size-11 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100 disabled:opacity-40"
            >
              <Minus className="size-5" aria-hidden />
            </button>
            <span className="w-12 text-center text-2xl font-bold tabular-nums text-zinc-900">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(999, q + 1))}
              disabled={pending}
              aria-label="เพิ่มจำนวน"
              className="grid size-11 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100 disabled:opacity-40"
            >
              <Plus className="size-5" aria-hidden />
            </button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-4">
          <label htmlFor={reasonId} className="text-sm font-semibold text-zinc-800">
            เหตุผลที่เบิก
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="เช่น หมึกพิมพ์สลิปหมด · ผ้าเช็ดเบาะใกล้หมด"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || !selected || !reason.trim()}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังส่ง...
          </>
        ) : (
          <>
            <Check className="mr-2 h-5 w-5" aria-hidden /> ส่งคำขอเบิก
          </>
        )}
      </Button>
    </form>
  );
}

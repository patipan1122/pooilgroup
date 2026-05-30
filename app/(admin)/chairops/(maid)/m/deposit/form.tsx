"use client";

// Batch-deposit client form. Maid checks 1+ pending collection rounds,
// confirms the actual amount that landed in the bank, optional bank fee, and
// uploads ONE slip photo. Submits to batchDeposit() which creates the
// ChairopsCashDeposit row + flips every chosen collection.depositId.

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Landmark,
  Loader2,
  WifiOff,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { compressImage } from "@/lib/chairops/utils/image-compress";
import { isOnline } from "@/lib/chairops/utils/maid-outbox";
import {
  batchDeposit,
  presignSlipUpload,
} from "@/app/(admin)/chairops/collect/actions";

interface PendingCollection {
  id: string;
  countedAmount: number;
  collectedAt: string;
  notes: string | null;
}

interface Props {
  pendingCollections: ReadonlyArray<PendingCollection>;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SlipState {
  publicUrl: string;
  hash: string;
  previewUrl: string;
  sizeKb: number;
}

export function BatchDepositForm({ pendingCollections }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [online, setOnline] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pendingCollections.map((p) => p.id)),
  );
  const [deposited, setDeposited] = useState("");
  const [bankFee, setBankFee] = useState("");
  const [notes, setNotes] = useState("");
  const [slip, setSlip] = useState<SlipState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftIdRef = useRef<string>(newUuid());

  const depositedId = useId();
  const bankFeeId = useId();
  const notesId = useId();

  useEffect(() => {
    setOnline(isOnline());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const selectedSum = useMemo(() => {
    return pendingCollections
      .filter((p) => selectedIds.has(p.id))
      .reduce((s, p) => s + p.countedAmount, 0);
  }, [pendingCollections, selectedIds]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(new Set(pendingCollections.map((p) => p.id)));
  }
  function clearAll() {
    setSelectedIds(new Set());
  }

  const depositedNum = Number(deposited.replace(/,/g, "")) || 0;
  const bankFeeNum = Number(bankFee.replace(/,/g, "")) || 0;
  const diff = selectedSum - depositedNum;
  const absDiff = Math.abs(diff);

  async function onPickSlip(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error("ต้องเป็นไฟล์รูปภาพ");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ถ่ายใหม่");
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const blob = compressed.blob;
      const buf = await blob.arrayBuffer();
      const hash = await sha256Hex(buf);
      const presign = await presignSlipUpload({
        contentType: compressed.compressed ? "image/jpeg" : file.type,
        depositDraftId: draftIdRef.current,
      });
      if (!presign.ok) {
        toast.error(presign.error);
        return;
      }
      if (!isOnline()) {
        toast.error("ออฟไลน์ · เชื่อมต่อก่อนแล้วลองอีกครั้ง");
        return;
      }
      const putRes = await fetch(presign.data.url, {
        method: "PUT",
        body: blob,
        headers: {
          "Content-Type": compressed.compressed ? "image/jpeg" : file.type,
        },
      });
      if (!putRes.ok) {
        toast.error("อัปโหลดรูปไม่สำเร็จ");
        return;
      }
      setSlip({
        publicUrl: presign.data.publicUrl,
        hash,
        previewUrl: URL.createObjectURL(blob),
        sizeKb: Math.round(blob.size / 1024),
      });
      toast.success(`แนบสลิปแล้ว (${Math.round(blob.size / 1024)} KB)`);
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setUploading(false);
    }
  }

  function validateBeforeSubmit(): string | null {
    if (selectedIds.size === 0) return "เลือกอย่างน้อย 1 รอบ";
    if (depositedNum <= 0) return "กรอกยอดที่ฝากจริง (มากกว่า 0)";
    if (bankFeeNum < 0) return "ค่าธรรมเนียมต้องไม่ติดลบ";
    if (!slip) return "แนบสลิปธนาคารก่อนบันทึก";
    return null;
  }

  function submitNow() {
    if (!slip) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const res = await batchDeposit({
        collectionIds: ids,
        depositedAmount: depositedNum,
        bankFee: bankFeeNum,
        slipPhotoUrl: slip.publicUrl,
        slipImageHash: slip.hash,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ฝากเงินก้อนบันทึกแล้ว ✓");
      router.push("/chairops/m");
      router.refresh();
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateBeforeSubmit();
    if (err) {
      toast.error(err);
      return;
    }
    if (!isOnline()) {
      toast.error("ออฟไลน์ · เชื่อมต่อก่อนแล้วลองอีกครั้ง");
      return;
    }
    submitNow();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {!online && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800">
          <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
          ออฟไลน์ · เชื่อมต่อก่อนกดบันทึก
        </div>
      )}

      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardBody className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs text-emerald-700">ยอดรวมที่เลือก</div>
            <div className="text-2xl font-bold tabular-nums text-emerald-900">
              {selectedSum.toLocaleString()} ฿
            </div>
            <div className="text-xs text-emerald-700">
              {selectedIds.size} จาก {pendingCollections.length} รอบ
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 text-xs"
              onClick={selectAll}
              disabled={selectedIds.size === pendingCollections.length}
            >
              เลือกทั้งหมด
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 text-xs"
              onClick={clearAll}
              disabled={selectedIds.size === 0}
            >
              ล้างเลือก
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Pending rounds — each checkbox flips selectedIds. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-700">
          รอบที่ยังไม่ได้ฝาก ({pendingCollections.length})
        </h2>
        <ul className="space-y-2">
          {pendingCollections.map((p) => {
            const checked = selectedIds.has(p.id);
            return (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors active:bg-zinc-100",
                    checked
                      ? "border-emerald-300 bg-emerald-50/60"
                      : "border-zinc-200 bg-white",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    className="size-5 accent-emerald-600"
                  />
                  <div className="min-w-0 grow">
                    <div className="text-base font-semibold tabular-nums text-zinc-900">
                      {p.countedAmount.toLocaleString()} ฿
                    </div>
                    <div className="text-xs text-zinc-500">
                      นับเมื่อ {fmtDate(p.collectedAt)}
                      {p.notes ? ` · ${p.notes.slice(0, 50)}` : ""}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <Card>
        <CardBody className="space-y-4 p-4">
          <div className="space-y-2">
            <label
              htmlFor={depositedId}
              className="text-sm font-semibold text-zinc-800"
            >
              ยอดที่ฝากธนาคารจริง (บาท)
            </label>
            <Input
              id={depositedId}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={deposited}
              onChange={(e) =>
                setDeposited(e.target.value.replace(/[^0-9]/g, ""))
              }
              className="h-14 text-right text-2xl font-semibold tabular-nums"
            />
            <p className="text-xs text-zinc-500">
              ยอดในสลิป · ถ้านับรวม {selectedSum.toLocaleString()} ก็ฝากเท่านั้น
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={bankFeeId}
              className="text-sm font-semibold text-zinc-800"
            >
              ค่าธรรมเนียม (ถ้ามี)
            </label>
            <Input
              id={bankFeeId}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={bankFee}
              onChange={(e) =>
                setBankFee(e.target.value.replace(/[^0-9]/g, ""))
              }
              className="h-12 text-right text-lg font-semibold tabular-nums"
            />
            <p className="text-xs text-zinc-500">
              บางสาขาฝากต่างจังหวัดมีค่าธรรมเนียม · ใส่ตามจริง
            </p>
          </div>

          {depositedNum > 0 && (
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                absDiff > 100
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700",
              )}
              aria-live="polite"
            >
              ผลต่าง (นับรวม − ฝาก):{" "}
              <span className="font-semibold tabular-nums">
                {diff >= 0 ? "+" : ""}
                {diff.toLocaleString()} ฿
              </span>
              {absDiff > 100 && (
                <span className="ml-2 font-medium">⚠ ต่างมากกว่า 100฿</span>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">
            สลิปธนาคาร (ต้องแนบ)
          </div>
          {slip ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slip.previewUrl}
                alt="สลิป"
                className="max-h-72 w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> อัปโหลดเรียบร้อย
                </span>
                <span className="font-mono text-zinc-500">{slip.sizeKb} KB</span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || pending}
                className="h-12 w-full"
              >
                ถ่ายใหม่
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || pending}
              className="h-14 w-full text-base"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังอัปโหลด...
                </>
              ) : (
                <>
                  <Camera className="mr-2 h-5 w-5" /> ถ่ายรูปสลิปธนาคาร
                </>
              )}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPickSlip}
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-4">
          <label
            htmlFor={notesId}
            className="text-sm font-semibold text-zinc-800"
          >
            หมายเหตุ (ถ้ามี)
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="เช่น แลกเงินก่อนฝาก, รวมหลายวัน, ..."
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || !slip || selectedIds.size === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          <>
            <Landmark className="mr-2 h-5 w-5" />
            ยืนยันฝากเงินก้อน · {selectedIds.size} รอบ
          </>
        )}
      </Button>
    </form>
  );
}

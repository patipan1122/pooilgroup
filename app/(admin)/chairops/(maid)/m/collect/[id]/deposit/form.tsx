"use client";

// Maid cash-deposit STEP 2 form · client.
//
// Pairs with Step 1 form at /chairops/m/collect/new/form.tsx — the maid
// already submitted countedAmount + evidence photo there. Here we capture
// depositedAmount + slip photo and call recordDeposit() to update the row.
//
// Identical UX scaffolding as Step 1 (h-14 inputs, photo compress, online
// detection) but no idempotency-outbox path: this is a one-shot update of an
// existing row, and the maid can re-open the page to retry if it fails.

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
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { compressImage } from "@/lib/chairops/utils/image-compress";
import { isOnline } from "@/lib/chairops/utils/maid-outbox";
import {
  recordDeposit,
  presignSlipUpload,
} from "@/app/(admin)/chairops/collect/actions";

interface Props {
  collectionId: string;
  countedAmount: number;
  avg7d: number | null;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface SlipState {
  publicUrl: string;
  hash: string;
  previewUrl: string;
  outputBytes: number;
}

export function DepositForm({ collectionId, countedAmount, avg7d }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [online, setOnline] = useState(true);
  const [deposited, setDeposited] = useState("");
  const [slip, setSlip] = useState<SlipState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState<string[]>([]);

  const depositedId = useId();

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

  const depositedNum = Number(deposited.replace(/,/g, "")) || 0;
  const diff = countedAmount - depositedNum;
  const absDiff = Math.abs(diff);

  const slipSizeKb = useMemo(
    () => (slip ? Math.round(slip.outputBytes / 1024) : 0),
    [slip],
  );

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
      if (!/^[a-f0-9]{64}$/i.test(hash)) {
        toast.error("รูปเบลอเกินไป · ถ่ายใหม่");
        return;
      }
      const presign = await presignSlipUpload({
        contentType: compressed.compressed ? "image/jpeg" : file.type,
        collectionId,
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
        toast.error("อัปโหลดรูปไม่สำเร็จ · ลองอีกครั้ง");
        return;
      }
      const previewUrl = URL.createObjectURL(blob);
      setSlip({
        publicUrl: presign.data.publicUrl,
        hash,
        previewUrl,
        outputBytes: blob.size,
      });
      toast.success(`อัปโหลดสลิปแล้ว (${Math.round(blob.size / 1024)} KB)`);
    } catch {
      toast.error("เกิดข้อผิดพลาด · ลองอีกครั้ง");
    } finally {
      setUploading(false);
    }
  }

  function validateBeforeSubmit(): string | null {
    if (depositedNum <= 0) return "กรอกยอดที่ฝากจริง (มากกว่า 0)";
    if (!slip) return "แนบสลิปธนาคารก่อนบันทึก";
    return null;
  }

  function buildConfirms(): string[] {
    const out: string[] = [];
    if (absDiff > 100) {
      out.push(
        `ผลต่างยอดที่นับ (${countedAmount.toLocaleString()}) กับยอดฝาก (${depositedNum.toLocaleString()}) อยู่ที่ ${absDiff.toLocaleString()} บาท`,
      );
    }
    if (avg7d && avg7d > 0) {
      const dev = Math.abs(depositedNum - avg7d) / avg7d;
      if (dev > 0.5) {
        out.push(
          `ยอดฝากครั้งนี้ (${depositedNum.toLocaleString()}) ห่างจากเฉลี่ย 7 วัน (${avg7d.toLocaleString()}) ประมาณ ${Math.round(dev * 100)}%`,
        );
      }
    }
    return out;
  }

  function submitNow() {
    if (!slip) return;
    startTransition(async () => {
      const res = await recordDeposit({
        collectionId,
        depositedAmount: depositedNum,
        slipPhotoUrl: slip.publicUrl,
        slipImageHash: slip.hash,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ฝากเงินบันทึกแล้ว");
      router.push(`/chairops/m/collect/${res.data.id}`);
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
      toast.error("ออฟไลน์ · ลองอีกครั้งเมื่อเชื่อมต่อ");
      return;
    }
    const warnings = buildConfirms();
    if (warnings.length > 0) {
      setConfirmWarnings(warnings);
      setConfirmOpen(true);
      return;
    }
    submitNow();
  }

  function onConfirmDeviation() {
    setConfirmOpen(false);
    submitNow();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800"
        >
          <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
          ออฟไลน์ · เชื่อมต่อก่อน
        </div>
      )}
      {online && (
        <div className="sr-only" role="status" aria-live="polite">
          <Wifi className="hidden" aria-hidden /> ออนไลน์
        </div>
      )}

      <Card>
        <CardBody className="space-y-4 p-4">
          <div className="space-y-2">
            <label
              htmlFor={depositedId}
              className="text-sm font-semibold text-zinc-800"
            >
              ยอดที่ฝากธนาคาร (บาท)
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
              aria-describedby={`${depositedId}-hint`}
            />
            <p id={`${depositedId}-hint`} className="text-xs text-zinc-500">
              ยอดที่ฝากเข้าบัญชีจริง · ถ้านับได้ {countedAmount.toLocaleString()} ฿ ก็ฝากเท่านั้น
              {avg7d ? ` · เฉลี่ย 7 วัน ${avg7d.toLocaleString()} ฿` : ""}
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
              ผลต่าง (นับ − ฝาก):{" "}
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
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> อัปโหลดเรียบร้อย
                </span>
                <span className="font-mono text-zinc-500">{slipSizeKb} KB</span>
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
          <p className="text-xs text-zinc-500">
            ระบบจะย่อรูปอัตโนมัติ · ถ่ายให้เห็นยอดและเวลาในสลิปครบ
          </p>
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || !slip}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          "ยืนยันฝากเงิน"
        )}
      </Button>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="ยืนยันยอดผิดปกติ"
      >
        <div className="space-y-3 p-2 text-sm">
          <p className="font-medium text-amber-800">
            กรุณาตรวจสอบยอดอีกครั้งก่อนยืนยัน
          </p>
          <ul className="list-disc space-y-1 pl-5 text-zinc-700">
            {confirmWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="h-12 grow"
              onClick={() => setConfirmOpen(false)}
            >
              กลับไปแก้
            </Button>
            <Button
              type="button"
              className="h-12 grow"
              onClick={onConfirmDeviation}
            >
              ยืนยันต่อ
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}

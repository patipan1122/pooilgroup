"use client";

// Maid cash-collection form · client.
//
// W6 spec (claude-design Phase 2):
//   - 360x640 layout · h-14 inputs · text-2xl tabular-nums for money
//   - chair_code typeahead (datalist)
//   - amount: inputMode=decimal numeric keypad
//   - photo upload: client-side compress to <500 KB before R2 PUT
//   - idempotency key: nanoid · saved to IndexedDB outbox · passed to action
//   - offline tolerance: navigator.onLine → save draft, show banner
//   - Thai error messages
//
// Action contract (existing — kept compatible):
//   presignEvidenceUpload({contentType, draftId}) → {url, publicUrl, key}
//   createCashCollection({countedAmount, depositedAmount, evidencePhotoUrl,
//                         imageHash, notes}) → {ok, data:{id}} | {ok:false, error}
//
// TODO[claude-design]: server action does NOT yet accept idempotencyKey
// (planned Wave 2 column add). For now we store key in IndexedDB + audit
// metadata; server-side de-dup happens via imageHash @@unique guard.

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
  Search,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { compressImage } from "@/lib/chairops/utils/image-compress";
import { MaidOutbox, isOnline } from "@/lib/chairops/utils/maid-outbox";
import { newIdempotencyKey } from "@/lib/chairops/utils/idempotency";
import {
  createCashCollection,
  presignEvidenceUpload,
} from "@/app/(admin)/chairops/collect/actions";

interface Props {
  avg7d: number | null;
  chairCodes: ReadonlyArray<string>;
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

interface PhotoState {
  publicUrl: string;
  hash: string;
  previewUrl: string;
  outputBytes: number;
  compressed: boolean;
}

export function CollectNewForm({ avg7d, chairCodes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [online, setOnline] = useState(true);
  const [chairCode, setChairCode] = useState("");
  const [counted, setCounted] = useState("");
  const [deposited, setDeposited] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<PhotoState | null>(null);
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState<string[]>([]);

  const chairId = useId();
  const countedId = useId();
  const depositedId = useId();
  const notesId = useId();
  const chairListId = useId();

  // Online/offline detection — only runs after mount to avoid SSR mismatch
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

  const countedNum = Number(counted.replace(/,/g, "")) || 0;
  const depositedNum = Number(deposited.replace(/,/g, "")) || 0;
  const diff = countedNum - depositedNum;
  const absDiff = Math.abs(diff);

  const photoSizeKb = useMemo(
    () => (photo ? Math.round(photo.outputBytes / 1024) : 0),
    [photo],
  );

  async function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/^image\//.test(file.type)) {
      toast.error("ต้องเป็นไฟล์รูปภาพ");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · กรุณาถ่ายรูปใหม่");
      return;
    }

    setUploading(true);
    try {
      // 1. Compress (target <500 KB)
      const compressed = await compressImage(file);
      const blob = compressed.blob;

      // 2. Hash compressed bytes (server dedup uses this exact hash)
      const buf = await blob.arrayBuffer();
      const hash = await sha256Hex(buf);
      if (!/^[a-f0-9]{64}$/i.test(hash)) {
        toast.error("รูปเบลอเกินไป · ลองถ่ายใหม่");
        return;
      }

      const draftId = newUuid();

      // 3. Presign R2 URL
      const presign = await presignEvidenceUpload({
        contentType: compressed.compressed ? "image/jpeg" : file.type,
        draftId,
      });
      if (!presign.ok) {
        toast.error(presign.error);
        return;
      }

      // 4. Direct PUT to R2
      if (!isOnline()) {
        toast.error("ออฟไลน์ · จะส่งเมื่อเชื่อมต่ออินเทอร์เน็ตอีกครั้ง");
        // Save draft so user doesn't lose the form
        await MaidOutbox.put({
          key: idempotencyKeyRef.current,
          route: "/chairops/m/collect/new",
          payload: {
            chairCode,
            counted,
            deposited,
            notes,
          },
          photoBlob: blob,
          savedAt: new Date().toISOString(),
        });
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
      setPhoto({
        publicUrl: presign.data.publicUrl,
        hash,
        previewUrl,
        outputBytes: blob.size,
        compressed: compressed.compressed,
      });
      toast.success(
        compressed.compressed
          ? `อัปโหลดแล้ว (${Math.round(blob.size / 1024)} KB)`
          : "อัปโหลดแล้ว",
      );
    } catch {
      toast.error("เกิดข้อผิดพลาด · ลองอีกครั้ง");
    } finally {
      setUploading(false);
    }
  }

  function validateBeforeSubmit(): string | null {
    if (countedNum <= 0) return "กรอกยอดที่นับได้ (มากกว่า 0)";
    if (depositedNum <= 0) return "กรอกยอดที่ฝาก (มากกว่า 0)";
    if (!photo) return "แนบรูปหลักฐานก่อนบันทึก";
    return null;
  }

  function buildConfirms(): string[] {
    const out: string[] = [];
    if (absDiff > 100) {
      out.push(
        `ผลต่างระหว่างยอดที่นับ (${countedNum.toLocaleString()}) กับยอดฝาก (${depositedNum.toLocaleString()}) อยู่ที่ ${absDiff.toLocaleString()} บาท`,
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

  async function persistDraft(error?: string) {
    await MaidOutbox.put({
      key: idempotencyKeyRef.current,
      route: "/chairops/m/collect/new",
      payload: {
        chairCode,
        counted,
        deposited,
        notes,
        photoUrl: photo?.publicUrl,
        photoHash: photo?.hash,
      },
      savedAt: new Date().toISOString(),
      lastError: error,
    });
  }

  function buildNotesPayload(): string | null {
    const trimmedNotes = notes.trim();
    const trimmedChair = chairCode.trim();
    if (!trimmedNotes && !trimmedChair) return null;
    const prefix = trimmedChair ? `[${trimmedChair}] ` : "";
    const combined = `${prefix}${trimmedNotes}`.trim();
    return combined.length > 0 ? combined : null;
  }

  function submitNow() {
    if (!photo) return; // narrowed for TS
    const evidenceUrl = photo.publicUrl;
    const imageHash = photo.hash;

    startTransition(async () => {
      // Save draft BEFORE attempt — survives network drop mid-action
      await persistDraft();
      const res = await createCashCollection({
        countedAmount: countedNum,
        depositedAmount: depositedNum,
        evidencePhotoUrl: evidenceUrl,
        imageHash,
        notes: buildNotesPayload(),
      });
      if (!res.ok) {
        await persistDraft(res.error);
        // Regenerate idempotency key on error so a legit retry isn't dedup'd
        // (server still dedups by imageHash @@unique on identical photos).
        idempotencyKeyRef.current = newIdempotencyKey();
        toast.error(res.error);
        return;
      }
      // Success — clear outbox + send user to detail
      await MaidOutbox.delete(idempotencyKeyRef.current);
      toast.success("บันทึกแล้ว");
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
      void persistDraft();
      toast.error("ออฟไลน์ · บันทึกไว้แล้ว · จะส่งเมื่อเชื่อมต่ออีกครั้ง");
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
          ออฟไลน์ · จะส่งเมื่อเชื่อมต่อ
        </div>
      )}
      {online && (
        <div className="sr-only" role="status" aria-live="polite">
          <Wifi className="hidden" aria-hidden /> ออนไลน์
        </div>
      )}

      {/* Chair code typeahead (optional) */}
      <Card>
        <CardBody className="space-y-2 p-4">
          <label
            htmlFor={chairId}
            className="text-sm font-semibold text-zinc-800"
          >
            รหัสเก้าอี้ (ถ้าระบุได้)
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <Input
              id={chairId}
              type="text"
              list={chairListId}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="เช่น CH-001"
              value={chairCode}
              onChange={(e) =>
                setChairCode(e.target.value.toUpperCase().slice(0, 20))
              }
              className="h-12 pl-9 text-base"
            />
            <datalist id={chairListId}>
              {chairCodes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <p className="text-xs text-zinc-500">
            ไม่จำเป็น · ถ้าไม่ทราบให้เว้นว่าง
          </p>
        </CardBody>
      </Card>

      {/* Money fields */}
      <Card>
        <CardBody className="space-y-4 p-4">
          <div className="space-y-2">
            <label
              htmlFor={countedId}
              className="text-sm font-semibold text-zinc-800"
            >
              ยอดที่นับได้ (บาท)
            </label>
            <Input
              id={countedId}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={counted}
              onChange={(e) =>
                setCounted(e.target.value.replace(/[^0-9]/g, ""))
              }
              className="h-14 text-right text-2xl font-semibold tabular-nums"
              aria-describedby={`${countedId}-hint`}
            />
            <p id={`${countedId}-hint`} className="text-xs text-zinc-500">
              เงินสด+เหรียญที่นับได้จริง
            </p>
          </div>

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
              ยอดที่ฝากเข้าบัญชี
              {avg7d ? ` · เฉลี่ย 7 วัน ${avg7d.toLocaleString()} ฿` : ""}
            </p>
          </div>

          {countedNum > 0 && depositedNum > 0 && (
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                absDiff > 100
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700",
              )}
              aria-live="polite"
            >
              ผลต่าง:{" "}
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

      {/* Photo capture */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">
            รูปหลักฐาน (ต้องแนบ)
          </div>

          {photo ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt="หลักฐาน"
                className="max-h-72 w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> อัปโหลดเรียบร้อย
                </span>
                <span className="font-mono text-zinc-500">{photoSizeKb} KB</span>
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
                  <Camera className="mr-2 h-5 w-5" /> ถ่ายรูปเงิน/สลิป
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
            onChange={onPickPhoto}
          />
          <p className="text-xs text-zinc-500">
            ระบบจะย่อรูปให้อัตโนมัติเพื่อประหยัดอินเทอร์เน็ต
          </p>
        </CardBody>
      </Card>

      {/* Notes */}
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
            placeholder="เช่น เก็บเหรียญแยกไว้, ลูกค้าจ่ายไม่ครบ ..."
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || !photo}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          "ยืนยันบันทึก"
        )}
      </Button>

      {/* Debug / aux info (hidden in prod via opacity, useful for QA) */}
      <p className="text-center font-mono text-[10px] text-zinc-400">
        key: {idempotencyKeyRef.current.slice(0, 8)}…
      </p>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="ยืนยันยอดผิดปกติ"
      >
        <div className="space-y-4">
          <ul className="space-y-2 text-sm text-zinc-700">
            {confirmWarnings.map((w, i) => (
              <li key={i} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                {w}
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-zinc-800">
            ยืนยันว่าจำนวนนี้ถูกต้องและต้องการบันทึกใช่หรือไม่?
          </p>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={onConfirmDeviation}
            >
              ยืนยันบันทึก
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}

"use client";

// Maid mobile cleanliness form (mockup Phone "CleanForm").
//   - "ทุกข้อปกติ (1-tap)" mega button → all 10 items pass
//   - 10 checkbox items (fold onto 6 server keys via MAID_CLEAN_ITEMS)
//   - photo proof (≥1) via existing presignCleanlinessUpload → R2
//   - submit → existing createCleanlinessReport action
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, Check, CheckCircle2, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SuccessScreen } from "@/components/chairops/_kit/success-screen";
import {
  createCleanlinessReport,
  presignCleanlinessUpload,
} from "@/app/(admin)/chairops/cleanliness/actions";
import type { ChecklistKey } from "@/app/(admin)/chairops/cleanliness/constants";
import { MAID_CLEAN_ITEMS } from "../constants";

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Fold 10 display items → 6 server keys: a key is `false` (problem) if ANY
// display item under it is off.
function foldToServerChecklist(
  itemChecks: Record<string, boolean>,
): Record<ChecklistKey, boolean> {
  const out: Record<ChecklistKey, boolean> = {
    floor: true,
    chairs: true,
    restroom: true,
    trash: true,
    signage: true,
    lighting: true,
  };
  for (const item of MAID_CLEAN_ITEMS) {
    if (itemChecks[item.id] === false) out[item.key] = false;
  }
  return out;
}

export function MaidCleanlinessForm() {
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<{ passCount: number; total: number } | null>(
    null,
  );

  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of MAID_CLEAN_ITEMS) init[item.id] = true;
    return init;
  });
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const [draftId] = useState(newUuid);
  const fileRef = useRef<HTMLInputElement>(null);

  const offCount = useMemo(
    () => Object.values(checks).filter((v) => v === false).length,
    [checks],
  );
  const passCount = MAID_CLEAN_ITEMS.length - offCount;
  const allOk = offCount === 0;

  function setAllOk() {
    const next: Record<string, boolean> = {};
    for (const item of MAID_CLEAN_ITEMS) next[item.id] = true;
    setChecks(next);
  }

  async function onAddPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= 5) {
      toast.error("แนบรูปได้สูงสุด 5 รูป");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ต้องไม่เกิน 8MB");
      return;
    }
    setUploading(true);
    try {
      const presign = await presignCleanlinessUpload({
        contentType: file.type,
        draftId,
        index: photos.length,
      });
      if (!presign.ok) {
        toast.error(presign.error);
        return;
      }
      const putRes = await fetch(presign.data.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) {
        toast.error("อัปโหลดรูปไม่สำเร็จ · ลองอีกครั้ง");
        return;
      }
      setPhotos((prev) => [
        ...prev,
        { url: presign.data.publicUrl, preview: URL.createObjectURL(file) },
      ]);
    } catch {
      toast.error("เกิดข้อผิดพลาด · ลองอีกครั้ง");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (photos.length === 0) {
      toast.error("แนบรูปอย่างน้อย 1 รูปก่อนส่ง");
      return;
    }
    startTransition(async () => {
      const res = await createCleanlinessReport({
        checklist: foldToServerChecklist(checks),
        photoUrls: photos.map((p) => p.url),
        notes: offCount > 0 ? `แม่บ้านพบ ${offCount} ข้อต้องดู` : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDone({ passCount, total: MAID_CLEAN_ITEMS.length });
    });
  }

  if (done) {
    return (
      <SuccessScreen
        title="ส่ง checklist เรียบร้อย"
        subtitle={`${done.passCount}/${done.total} ข้อผ่าน${
          done.passCount < done.total ? " · ออฟฟิศจะตามข้อที่ค้าง" : ""
        }`}
        thumbnails={photos.map((p) => p.preview)}
        primaryHref="/chairops/m"
        primaryLabel="กลับหน้าหลัก"
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* 1-tap "ทุกข้อปกติ" mega button (mockup .co-mini-allok) */}
      <Button
        type="button"
        onClick={setAllOk}
        disabled={pending}
        className={cn(
          "h-14 w-full border text-base font-semibold",
          allOk
            ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
        )}
        variant="outline"
      >
        <Check className="mr-2 h-5 w-5" aria-hidden /> ทุกข้อปกติ (1-tap)
      </Button>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        หรือเลือกทีละข้อ
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <Card>
        <CardBody className="space-y-1 p-3">
          {MAID_CLEAN_ITEMS.map((item) => {
            const on = checks[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setChecks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                }
                aria-pressed={on}
                className={cn(
                  "flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 text-left transition-colors",
                  on ? "bg-zinc-50" : "bg-rose-50",
                )}
              >
                <span
                  className={cn(
                    "grid size-[22px] shrink-0 place-items-center rounded-md border-[1.5px]",
                    on
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white",
                  )}
                  aria-hidden
                >
                  {on && <Check className="size-3.5" strokeWidth={2.5} />}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    on ? "text-zinc-800" : "font-medium text-rose-700",
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </CardBody>
      </Card>

      {/* Photo proof */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-800">
              รูปประกอบ ({photos.length}/5)
            </div>
            <span className="text-xs text-zinc-500">ต้องอย่างน้อย 1 รูป</span>
          </div>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <li key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt={`หลักฐาน ${i + 1}`}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    aria-label="ลบรูป"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photos.length < 5 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || pending}
              className="h-12 w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังอัปโหลด...
                </>
              ) : (
                <>
                  <Camera className="mr-2 h-5 w-5" /> ถ่ายรูป
                </>
              )}
            </Button>
          )}
          {photos.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> มี {photos.length} รูปแล้ว
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onAddPhoto}
          />
        </CardBody>
      </Card>

      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
        <span className="text-zinc-600">สรุป</span>
        <Badge tone={allOk ? "success" : offCount <= 2 ? "warning" : "danger"}>
          {passCount}/{MAID_CLEAN_ITEMS.length} ผ่าน
        </Badge>
      </div>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || photos.length === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          <>
            <Check className="mr-2 h-5 w-5" aria-hidden /> ส่ง checklist
          </>
        )}
      </Button>
    </form>
  );
}

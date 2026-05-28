"use client";

// Maid mobile damage-report form · /chairops/m/damage/new (CEO mockup "แจ้งซ่อม").
//   - chair picker chips (optional · "ไม่ระบุเครื่อง" allowed) + offline dot
//   - urgency pills: ด่วน (URGENT, rose) / ปกติ (NORMAL) — matches the 2-value
//     Prisma enum (no migration; 3-level mockup deferred per AUDIT D-CO §3)
//   - 5 category chips (DAMAGE_CATEGORIES) + อาการ textarea (≥5 chars)
//   - photo proof (0–3) via presignDamageUpload → R2 (same pattern as cleanliness)
//   - submit → createDamageTicket → full-screen SuccessScreen (RP-####)
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, CircleAlert, Loader2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SuccessScreen } from "@/components/chairops/_kit/success-screen";
import {
  createDamageTicket,
  presignDamageUpload,
} from "@/app/(admin)/chairops/damage/actions";
import {
  DAMAGE_CATEGORIES,
  type DamageCategory,
} from "@/app/(admin)/chairops/damage/new/constants";

interface ChairOpt {
  id: string;
  chairCode: string;
  isOnline: boolean;
}

interface Props {
  chairs: ReadonlyArray<ChairOpt>;
  /** Chair ids that already have an open ticket — selecting warns (BA soft-guard). */
  openTicketChairIds: ReadonlyArray<string>;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const MAX_PHOTOS = 3;

export function MaidDamageForm({ chairs, openTicketChairIds }: Props) {
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const [chairId, setChairId] = useState<string | null>(null);
  const [priority, setPriority] = useState<"URGENT" | "NORMAL">("NORMAL");
  const [category, setCategory] = useState<DamageCategory>(DAMAGE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const [draftId] = useState(newUuid);
  const [result, setResult] = useState<{
    ticketCode: string;
    chairCode: string | null;
    priority: "URGENT" | "NORMAL";
  } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const descOk = description.trim().length >= 5;
  const selectedHasOpenTicket = chairId != null && openTicketChairIds.includes(chairId);
  const selectedChairCode =
    chairId != null ? (chairs.find((c) => c.id === chairId)?.chairCode ?? null) : null;

  async function onAddPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      toast.error(`แนบรูปได้สูงสุด ${MAX_PHOTOS} รูป`);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ต้องไม่เกิน 8MB");
      return;
    }
    setUploading(true);
    try {
      const presign = await presignDamageUpload({
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

  function reset() {
    setChairId(null);
    setPriority("NORMAL");
    setCategory(DAMAGE_CATEGORIES[0]);
    setDescription("");
    setPhotos([]);
    setResult(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!descOk) {
      toast.error("อธิบายอาการอย่างน้อย 5 ตัวอักษร");
      return;
    }
    startTransition(async () => {
      const res = await createDamageTicket({
        chairId,
        category,
        description: description.trim(),
        priority,
        photoUrls: photos.map((p) => p.url),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult({
        ticketCode: res.data.ticketCode,
        chairCode: selectedChairCode,
        priority,
      });
    });
  }

  if (result) {
    return (
      <SuccessScreen
        title="ส่งให้ช่างเรียบร้อย"
        subtitle="ช่างจะตามงานจากเลขแจ้งซ่อมนี้"
        refLabel="เลขแจ้งซ่อม"
        refCode={result.ticketCode}
        meta={
          <span className="inline-flex items-center gap-2">
            {result.chairCode ? `เก้าอี้ ${result.chairCode}` : "ไม่ระบุเครื่อง"}
            {" · "}
            {result.priority === "URGENT" ? "🔴 ด่วน" : "ปกติ"}
          </span>
        }
        thumbnails={photos.map((p) => p.preview)}
        primaryHref="/chairops/m/damage"
        primaryLabel="กลับหน้าแจ้งซ่อม"
        secondaryLabel="แจ้งอีกรายการ"
        onSecondary={reset}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Chair picker */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">เก้าอี้ที่เสีย</div>
          {chairs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              สาขานี้ยังไม่มีรายการเก้าอี้ · แจ้งแบบไม่ระบุเครื่องได้
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {chairs.map((c) => {
                const active = chairId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChairId(active ? null : c.id)}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100",
                      )}
                    >
                      {!c.isOnline && (
                        <span
                          className="size-1.5 rounded-full bg-rose-500"
                          aria-label="ออฟไลน์"
                        />
                      )}
                      {c.chairCode}
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  aria-pressed={chairId === null}
                  onClick={() => setChairId(null)}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                    chairId === null
                      ? "border-zinc-400 bg-zinc-100 text-zinc-800"
                      : "border-dashed border-zinc-300 bg-white text-zinc-500 active:bg-zinc-100",
                  )}
                >
                  — ไม่ระบุเครื่อง —
                </button>
              </li>
            </ul>
          )}
          {selectedHasOpenTicket && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              เก้าอี้นี้มีใบแจ้งซ่อมค้างอยู่แล้ว · ส่งเพิ่มได้ถ้าเป็นอาการใหม่
            </div>
          )}
        </CardBody>
      </Card>

      {/* Urgency */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">ความเร่งด่วน</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={priority === "URGENT"}
              onClick={() => setPriority("URGENT")}
              className={cn(
                "flex h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors",
                priority === "URGENT"
                  ? "border-rose-400 bg-rose-100 text-rose-700"
                  : "border-zinc-200 bg-white text-zinc-600 active:bg-zinc-50",
              )}
            >
              🔴 ด่วน
            </button>
            <button
              type="button"
              aria-pressed={priority === "NORMAL"}
              onClick={() => setPriority("NORMAL")}
              className={cn(
                "flex h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors",
                priority === "NORMAL"
                  ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                  : "border-zinc-200 bg-white text-zinc-600 active:bg-zinc-50",
              )}
            >
              ปกติ
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Category + description */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">ประเภทอาการ</div>
          <ul className="flex flex-wrap gap-2">
            {DAMAGE_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <li key={cat}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-zinc-200 bg-white text-zinc-700 active:bg-zinc-100",
                    )}
                  >
                    {cat}
                  </button>
                </li>
              );
            })}
          </ul>
          <label htmlFor="damage-desc" className="block text-sm font-semibold text-zinc-800">
            อาการที่พบ
          </label>
          <textarea
            id="damage-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
            rows={4}
            enterKeyHint="done"
            placeholder="เช่น เบาะไม่ทำงาน · จอดับ · มีเสียงดังผิดปกติ"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
          <p className="text-xs text-zinc-500">
            {description.trim().length < 5
              ? "พิมพ์อย่างน้อย 5 ตัวอักษร"
              : `${description.trim().length}/1000`}
          </p>
        </CardBody>
      </Card>

      {/* Photos */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-800">
              รูปอาการ ({photos.length}/{MAX_PHOTOS})
            </div>
            <span className="text-xs text-zinc-500">ช่วยช่างเตรียมอะไหล่</span>
          </div>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <li key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt={`อาการ ${i + 1}`}
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
          {photos.length < MAX_PHOTOS && (
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

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || !descOk}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังส่ง...
          </>
        ) : (
          <>
            <Wrench className="mr-2 h-5 w-5" aria-hidden /> ส่งให้ช่าง
          </>
        )}
      </Button>
    </form>
  );
}

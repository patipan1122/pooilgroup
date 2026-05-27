"use client";

// Damage report form (maid).
// Chair picker + category dropdown + multi-photo + description + URGENT toggle.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Camera, Loader2, X, AlertTriangle } from "lucide-react";
import { createDamageTicket, presignDamageUpload } from "../actions";
import { DAMAGE_CATEGORIES } from "./constants";

interface Chair {
  id: string;
  chairCode: string;
  generation: string | null;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function DamageNewForm({ chairs }: { chairs: Chair[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const [chairId, setChairId] = useState<string>("");
  const [category, setCategory] = useState<(typeof DAMAGE_CATEGORIES)[number]>(
    DAMAGE_CATEGORIES[0]
  );
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"URGENT" | "NORMAL">("NORMAL");
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const [draftId] = useState(newUuid);
  const fileRef = useRef<HTMLInputElement>(null);
  const [chairFilter, setChairFilter] = useState("");

  const filteredChairs = chairFilter
    ? chairs.filter((c) =>
        c.chairCode.toLowerCase().includes(chairFilter.toLowerCase())
      )
    : chairs;

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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 5) {
      toast.error("อธิบายอาการอย่างน้อย 5 ตัวอักษร");
      return;
    }
    if (priority === "URGENT") {
      if (!confirm("ยืนยันว่านี่คือเรื่องด่วน (URGENT)?")) return;
    }

    startTransition(async () => {
      const res = await createDamageTicket({
        chairId: chairId || null,
        category,
        description: description.trim(),
        priority,
        photoUrls: photos.map((p) => p.url),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`แจ้งซ่อมแล้ว · ${res.data.ticketCode}`);
      router.push("/chairops/collect");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardBody className="space-y-3 p-5">
          <label className="text-sm font-semibold">เลือกเครื่อง (ถ้าระบุได้)</label>
          {chairs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              ยังไม่มีรายการเครื่องในสาขา · ติดต่อออฟฟิศ
            </p>
          ) : (
            <>
              <Input
                value={chairFilter}
                onChange={(e) => setChairFilter(e.target.value)}
                placeholder="ค้นหารหัสเครื่อง (เช่น G031, FC30)"
                autoComplete="off"
              />
              <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                <ul className="divide-y divide-border">
                  <li>
                    <button
                      type="button"
                      onClick={() => setChairId("")}
                      className={
                        "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm " +
                        (chairId === "" ? "bg-muted font-semibold" : "")
                      }
                    >
                      <span>— ไม่ระบุเครื่อง —</span>
                    </button>
                  </li>
                  {filteredChairs.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setChairId(c.id)}
                        className={
                          "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm " +
                          (chairId === c.id ? "bg-muted font-semibold" : "")
                        }
                      >
                        <span>{c.chairCode}</span>
                        {c.generation && (
                          <Badge tone="neutral">{c.generation}</Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 p-5">
          <label className="text-sm font-semibold">ประเภทอาการ</label>
          <div className="grid grid-cols-2 gap-2">
            {DAMAGE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={
                  "rounded-md border px-3 py-2.5 text-sm font-medium transition-colors " +
                  (category === cat
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted")
                }
              >
                {cat}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-5">
          <label className="text-sm font-semibold">อธิบายอาการ</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="เช่น เครื่อง G031xx-3 ไม่มีไฟ กดปุ่ม Power ไม่ทำงาน"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">อย่างน้อย 5 ตัวอักษร</p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">รูปประกอบ ({photos.length}/5)</div>
            <span className="text-xs text-muted-foreground">ทางเลือก แต่ช่วยช่างมาก</span>
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

          {photos.length < 5 && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || pending}
              className="w-full"
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

      <Card>
        <CardBody className="space-y-3 p-5">
          <div className="text-sm font-semibold">ระดับความเร่งด่วน</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPriority("NORMAL")}
              className={
                "rounded-md border px-3 py-3 text-sm font-medium transition-colors " +
                (priority === "NORMAL"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted")
              }
            >
              ปกติ
            </button>
            <button
              type="button"
              onClick={() => setPriority("URGENT")}
              className={
                "rounded-md border px-3 py-3 text-sm font-medium transition-colors " +
                (priority === "URGENT"
                  ? "border-danger bg-danger text-white"
                  : "border-border bg-background hover:bg-muted")
              }
            >
              <AlertTriangle className="mr-1 inline h-4 w-4" /> ด่วน
            </button>
          </div>
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base"
        disabled={pending || uploading || description.trim().length < 5}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังส่ง...
          </>
        ) : (
          "ส่งใบแจ้งซ่อม"
        )}
      </Button>
    </form>
  );
}

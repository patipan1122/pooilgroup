"use client";

// Cleanliness checklist + photo form.
// 6 toggles → grade derived server-side; up to 5 photos via R2 presigned upload.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { createCleanlinessReport, presignCleanlinessUpload } from "../actions";
import { CHECKLIST_ITEMS, type ChecklistKey } from "../constants";

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function CleanlinessNewForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  // checklist defaults to all true (PASS); maid taps off items that are bad.
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>(() => {
    const init = {} as Record<ChecklistKey, boolean>;
    for (const item of CHECKLIST_ITEMS) init[item.key] = true;
    return init;
  });
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const [draftId] = useState(newUuid);
  const fileRef = useRef<HTMLInputElement>(null);

  const offCount = Object.values(checks).filter((v) => v === false).length;
  const previewGrade = offCount === 0 ? "PASS" : offCount <= 2 ? "WARN" : "FAIL";
  const gradeStyle =
    previewGrade === "PASS"
      ? { tone: "success" as const, label: "ผ่าน" }
      : previewGrade === "WARN"
        ? { tone: "warning" as const, label: "เฝ้าดู" }
        : { tone: "danger" as const, label: "ไม่ผ่าน" };

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
      toast.error("ต้องแนบรูปอย่างน้อย 1 รูป");
      return;
    }

    if (previewGrade === "FAIL") {
      if (!confirm("ผลออกมา 'ไม่ผ่าน' · ยืนยันส่งรายงานหรือไม่?")) return;
    }

    startTransition(async () => {
      const res = await createCleanlinessReport({
        checklist: checks,
        photoUrls: photos.map((p) => p.url),
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`บันทึกแล้ว · เกรด ${res.data.grade}`);
      router.push("/chairops/cleanliness");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardBody className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">รายการตรวจ</div>
            <Badge tone={gradeStyle.tone}>เกรดปัจจุบัน: {gradeStyle.label}</Badge>
          </div>
          <ul className="divide-y divide-border">
            {CHECKLIST_ITEMS.map((item) => {
              const on = checks[item.key];
              return (
                <li key={item.key} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium">{item.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setChecks((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                    }
                    aria-pressed={on}
                    className={
                      "inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-full px-4 text-xs font-semibold transition-colors " +
                      (on
                        ? "bg-success text-white"
                        : "bg-danger/15 text-[hsl(0,84%,40%)]")
                    }
                  >
                    {on ? "ปกติ" : "มีปัญหา"}
                  </button>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              รูปประกอบ ({photos.length}/5)
            </div>
            <span className="text-xs text-muted-foreground">ต้องอย่างน้อย 1 รูป</span>
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
          {photos.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-success">
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

      <Card>
        <CardBody className="space-y-2 p-5">
          <label className="text-sm font-semibold">หมายเหตุ (ถ้ามี)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="อธิบายปัญหาหรือสภาพเพิ่มเติม"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base"
        disabled={pending || uploading || photos.length === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          "ส่งรายงาน"
        )}
      </Button>
    </form>
  );
}

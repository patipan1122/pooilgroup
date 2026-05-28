"use client";

// Client form for cash collection
// Flow:
//   1. maid types countedAmount + depositedAmount (numeric pad)
//   2. snaps a photo via camera intent
//   3. browser hashes the photo (SHA-256) + asks server for presigned R2 URL
//   4. uploads photo directly to R2
//   5. anti-stupid double-confirm if diff(counted vs deposited) > 100฿
//      or deposit deviates > 50% from 7-day avg
//   6. calls createCashCollection · on success redirects to detail page

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import {
  createCashCollection,
  presignEvidenceUpload,
} from "../actions";

interface Props {
  avg7d: number | null;
}

// Browser SHA-256 of an ArrayBuffer → hex string
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
  // Fallback (should never hit in modern browsers)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function CollectNewForm({ avg7d }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [counted, setCounted] = useState("");
  const [deposited, setDeposited] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const countedId = useId();
  const depositedId = useId();
  const notesId = useId();

  const countedNum = Number(counted.replace(/,/g, "")) || 0;
  const depositedNum = Number(deposited.replace(/,/g, "")) || 0;
  const diff = countedNum - depositedNum;
  const absDiff = Math.abs(diff);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/^image\//.test(file.type)) {
      toast.error("ต้องเป็นไฟล์รูปภาพ");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ต้องไม่เกิน 8MB");
      return;
    }

    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      const draftId = newUuid();

      const presign = await presignEvidenceUpload({
        contentType: file.type,
        draftId,
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

      setPhotoUrl(presign.data.publicUrl);
      setPhotoHash(hash);
      setPhotoPreview(URL.createObjectURL(file));
      toast.success("อัปโหลดรูปแล้ว");
    } catch {
      toast.error("เกิดข้อผิดพลาด · ลองอีกครั้ง");
    } finally {
      setUploading(false);
    }
  }

  function validateBeforeSubmit(): string | null {
    if (countedNum <= 0) return "กรอกยอดที่นับได้ (มากกว่า 0)";
    if (depositedNum <= 0) return "กรอกยอดที่ฝาก (มากกว่า 0)";
    if (!photoUrl || !photoHash) return "แนบรูปหลักฐานก่อนบันทึก";
    return null;
  }

  function buildConfirms(): string[] {
    const out: string[] = [];
    if (absDiff > 100) {
      out.push(`ผลต่างระหว่างยอดที่นับ (${countedNum.toLocaleString()}) กับยอดฝาก (${depositedNum.toLocaleString()}) อยู่ที่ ${absDiff.toLocaleString()} บาท`);
    }
    if (avg7d && avg7d > 0) {
      const dev = Math.abs(depositedNum - avg7d) / avg7d;
      if (dev > 0.5) {
        out.push(
          `ยอดฝากครั้งนี้ (${depositedNum.toLocaleString()}) ห่างจากเฉลี่ย 7 วัน (${avg7d.toLocaleString()}) ประมาณ ${Math.round(dev * 100)}%`
        );
      }
    }
    return out;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateBeforeSubmit();
    if (err) {
      toast.error(err);
      return;
    }
    const warnings = buildConfirms();
    if (warnings.length > 0) {
      const msg =
        warnings.join("\n\n") + "\n\nยืนยันว่าจำนวนนี้ถูกต้องและต้องการบันทึกใช่หรือไม่?";
      if (!confirm(msg)) return;
    }

    startTransition(async () => {
      const res = await createCashCollection({
        countedAmount: countedNum,
        depositedAmount: depositedNum,
        evidencePhotoUrl: photoUrl!,
        imageHash: photoHash!,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.push(`/chairops/collect/${res.data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardBody className="space-y-4 p-5">
          <div className="space-y-2">
            <label htmlFor={countedId} className="text-sm font-semibold">
              ยอดที่นับได้ (บาท)
            </label>
            <Input
              id={countedId}
              type="tel"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={counted}
              onChange={(e) => setCounted(e.target.value.replace(/[^0-9]/g, ""))}
              className="text-right text-2xl font-semibold tabular-nums"
              aria-describedby={`${countedId}-hint`}
            />
            <p id={`${countedId}-hint`} className="text-xs text-muted-foreground">
              ยอดเงินสด+เหรียญที่นับได้จริง
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={depositedId} className="text-sm font-semibold">
              ยอดที่ฝากธนาคาร (บาท)
            </label>
            <Input
              id={depositedId}
              type="tel"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={deposited}
              onChange={(e) => setDeposited(e.target.value.replace(/[^0-9]/g, ""))}
              className="text-right text-2xl font-semibold tabular-nums"
              aria-describedby={`${depositedId}-hint`}
            />
            <p id={`${depositedId}-hint`} className="text-xs text-muted-foreground">
              ยอดที่ฝากเข้าบัญชี{avg7d ? ` · เฉลี่ย 7 วัน ${avg7d.toLocaleString()} ฿` : ""}
            </p>
          </div>

          {countedNum > 0 && depositedNum > 0 && (
            <div
              className={
                "rounded-md border p-3 text-sm " +
                (absDiff > 100
                  ? "border-warning/40 bg-warning/5"
                  : "border-border bg-muted/40")
              }
            >
              ผลต่าง:{" "}
              <span className="font-semibold tabular-nums">
                {diff >= 0 ? "+" : ""}
                {diff.toLocaleString()} ฿
              </span>
              {absDiff > 100 && (
                <span className="ml-2 text-warning">⚠ ต่างมากกว่า 100฿</span>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 p-5">
          <div className="text-sm font-semibold">รูปหลักฐาน (ต้องแนบ)</div>

          {photoPreview ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="หลักฐาน"
                className="max-h-72 w-full rounded-md object-contain"
              />
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-4 w-4" /> อัปโหลดเรียบร้อย
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || pending}
              >
                ถ่ายใหม่
              </Button>
            </div>
          ) : (
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
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2 p-5">
          <label htmlFor={notesId} className="text-sm font-semibold">
            หมายเหตุ (ถ้ามี)
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="เช่น เก็บไว้ส่วนตัวเล็กน้อย, ...."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base"
        disabled={pending || uploading || !photoUrl}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          "ยืนยันบันทึก"
        )}
      </Button>
    </form>
  );
}

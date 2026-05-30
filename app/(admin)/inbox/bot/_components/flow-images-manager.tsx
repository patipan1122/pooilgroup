"use client";

// "รูปประกอบบอท" tab — upload one image per topic that the bot will send
// along with its canned reply (e.g., photo of coin slot for money_lost).
// The image is hosted on R2; LINE / FB fetch it directly to deliver.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2, AlertTriangle } from "lucide-react";
import {
  uploadBotFlowImage,
  removeBotFlowImage,
} from "@/lib/inbox/bot/knowledge-actions";

export type FlowImages = Partial<
  Record<"money_lost" | "scan_fail" | "strong" | "buy" | "feedback" | "intro", string>
>;

interface Slot {
  topic: keyof FlowImages;
  label: string;
  hint: string;
}

const SLOTS: Slot[] = [
  {
    topic: "money_lost",
    label: "หยอดเงินแล้วเครื่องไม่ทำงาน",
    hint: "เช่น รูปจุดหยอดเหรียญ/แบงค์ที่ลูกค้าควรถ่ายให้ดู",
  },
  {
    topic: "scan_fail",
    label: "สแกนจ่ายแล้วใช้ไม่ได้",
    hint: "เช่น รูป QR code ที่ถูกต้อง/วิธีสแกน",
  },
  {
    topic: "strong",
    label: "นวดแรง/เจ็บ — วิธีปรับ",
    hint: "เช่น รูปแผงปุ่มปรับความแรง · Zero Gravity",
  },
  {
    topic: "buy",
    label: "สนใจซื้อ",
    hint: "เช่น รูปแคตตาล็อก/ราคา/รุ่นยอดนิยม",
  },
  {
    topic: "feedback",
    label: "ติชม/ขอบคุณ",
    hint: "เช่น รูป \"ขอบคุณค่ะ\" แบรนด์ของเรา (ออปชัน)",
  },
  {
    topic: "intro",
    label: "ทักทาย/แนะนำ",
    hint: "เช่น รูปแบรนด์ · ใช้ตอนทักทายเปิดบทสนทนา (ออปชัน)",
  },
];

const MAX_BYTES = 5 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    r.readAsDataURL(file);
  });
}

export function FlowImagesManager({
  businessTag,
  initialImages,
}: {
  businessTag: string;
  initialImages: FlowImages;
}) {
  const [images, setImages] = useState<FlowImages>(initialImages);

  // The 6 topic slots (money_lost / scan_fail / strong / buy / feedback /
  // intro) are written specifically for the chairops vertical.  Live engine
  // only renders the topic templates when businessTag === "chairops", so for
  // other businesses an uploaded image would never reach the customer —
  // show an empty-state explaining that instead (audit BOT-009).
  if (businessTag !== "chairops") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm leading-relaxed text-zinc-700">
        <p className="font-bold text-zinc-900">
          รูปประกอบ flow ใช้ได้กับธุรกิจ "เก้าอี้นวด" เท่านั้น
        </p>
        <p className="mt-2 text-zinc-600">
          ระบบมี flow ตายตัว 6 หัวข้อ (เงินหาย / สแกนไม่ได้ / นวดแรง / สนใจซื้อ
          / ติชม / ทักทาย) เขียนไว้สำหรับเก้าอี้นวด ·
          ธุรกิจอื่นใช้คลังคำตอบ (FAQ) + ข้อมูลร้าน (AI) เป็นหลักครับ
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          อยากแนบรูปกับคำตอบของธุรกิจนี้ → ใส่ลิงก์รูปไว้ในข้อความ FAQ หรือ
          เนื้อหา &ldquo;ข้อมูลร้าน&rdquo; ได้ตอนนี้
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            บอทจะส่งรูปนี้<strong className="font-bold">ตามหลังข้อความตอบ</strong>
            อัตโนมัติ เมื่อ classify ได้ว่าเป็นหัวข้อนี้ · รองรับ JPEG/PNG/WebP/GIF
            ขนาดไม่เกิน 5 MB · ใช้รูปกว้าง ≥1024px จะคมที่สุด
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SLOTS.map((slot) => (
          <ImageSlot
            key={slot.topic}
            businessTag={businessTag}
            slot={slot}
            url={images[slot.topic]}
            onChange={(url) =>
              setImages((prev) => {
                const next = { ...prev };
                if (url) next[slot.topic] = url;
                else delete next[slot.topic];
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function ImageSlot({
  businessTag,
  slot,
  url,
  onChange,
}: {
  businessTag: string;
  slot: Slot;
  url: string | undefined;
  onChange: (url: string | undefined) => void;
}) {
  const [uploading, startUpload] = useTransition();
  const [removing, startRemove] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function pick() {
    inputRef.current?.click();
  }

  function onPicked(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("ไฟล์ใหญ่เกิน 5 MB");
      return;
    }
    startUpload(async () => {
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await uploadBotFlowImage({
          topic: slot.topic,
          dataUrl,
          businessTag,
        });
        onChange(res.url);
        toast.success(`อัปโหลดรูป "${slot.label}" แล้ว`);
      } catch (e) {
        toast.error((e as Error).message || "อัปโหลดไม่สำเร็จ");
      }
    });
  }

  function remove() {
    if (!url) return;
    if (!confirm(`ลบรูปประกอบของหัวข้อ "${slot.label}"?`)) return;
    startRemove(async () => {
      try {
        await removeBotFlowImage({ topic: slot.topic, businessTag });
        onChange(undefined);
        toast.success("ลบรูปแล้ว");
      } catch (e) {
        toast.error((e as Error).message || "ลบไม่สำเร็จ");
      }
    });
  }

  const busy = uploading || removing;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-soft">
      <div className="aspect-[4/3] bg-zinc-50">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={slot.label}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            ยังไม่มีรูปประกอบ
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="text-sm font-bold text-zinc-900">{slot.label}</p>
        <p className="text-[11px] leading-relaxed text-zinc-500">{slot.hint}</p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 text-xs font-bold text-[var(--color-brand-800)] hover:bg-[var(--color-brand-100)] disabled:opacity-50"
          >
            <ImagePlus className="size-4" />
            {uploading ? "กำลังอัปโหลด..." : url ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
          </button>
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              aria-label="ลบรูป"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => onPicked(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Send, Tag, Landmark, FileText, Loader2, Smile } from "lucide-react";
import { cn } from "@/lib/fuelos/utils/cn";
import { sendReply, quickStatus, todayPriceText, bankText, sendSticker } from "./actions";

const STATUS_CHIPS = ["เสนอราคาแล้ว", "รอลูกค้าตัดสินใจ", "ปิดการขาย/ได้ออเดอร์"];

const stickerCdn = (id: string) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/android/sticker.png`;
// สติกเกอร์ชุดมาตรฐานที่ LINE อนุญาตให้ส่งผ่าน API (packageId 11537 "Brown & Friends")
const STICKERS: { p: string; s: string }[] = [
  { p: "11537", s: "52002734" }, { p: "11537", s: "52002735" }, { p: "11537", s: "52002736" },
  { p: "11537", s: "52002738" }, { p: "11537", s: "52002739" }, { p: "11537", s: "52002740" },
  { p: "11537", s: "52002741" }, { p: "11537", s: "52002744" }, { p: "11537", s: "52002745" },
  { p: "11537", s: "52002746" }, { p: "11537", s: "52002748" }, { p: "11537", s: "52002753" },
];

export function ReplyBox({ convId, zone }: { convId: string; zone: string | null }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [toolLoading, setToolLoading] = useState<string | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  const router = useRouter();

  function sticker(p: string, s: string) {
    start(async () => {
      const r = await sendSticker(convId, p, s);
      setShowStickers(false);
      if (r.ok) { router.refresh(); if (r.warning) toast.error(r.warning); }
    });
  }

  function send() {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const r = await sendReply(convId, body);
      if (r.ok) { setText(""); router.refresh(); }
    });
  }

  async function paste(kind: "price" | "bank") {
    setToolLoading(kind);
    try {
      const t = kind === "price" ? await todayPriceText(zone) : await bankText();
      setText((prev) => (prev ? prev + "\n" + t : t));
    } finally {
      setToolLoading(null);
    }
  }

  function status(label: string) {
    start(async () => {
      await quickStatus(convId, label);
      toast.success(`ตั้งสถานะ: ${label}`);
      router.refresh();
    });
  }

  return (
    <div className="border-t border-border bg-surface p-2.5 space-y-2">
      {/* quick status */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {STATUS_CHIPS.map((s) => (
          <button
            key={s} onClick={() => status(s)} disabled={pending}
            className="shrink-0 h-7 px-2.5 rounded-full bg-surface-2 text-zinc-600 text-xs hover:bg-brand-50 hover:text-brand-700"
          >
            {s}
          </button>
        ))}
      </div>
      {/* assist tools */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        <button onClick={() => paste("price")} disabled={!!toolLoading} className="shrink-0 h-8 px-2.5 rounded-lg border border-border text-xs inline-flex items-center gap-1 hover:bg-surface-2">
          {toolLoading === "price" ? <Loader2 className="size-3.5 animate-spin" /> : <Tag className="size-3.5 text-brand-600" />} แปะราคาวันนี้
        </button>
        <button onClick={() => paste("bank")} disabled={!!toolLoading} className="shrink-0 h-8 px-2.5 rounded-lg border border-border text-xs inline-flex items-center gap-1 hover:bg-surface-2">
          {toolLoading === "bank" ? <Loader2 className="size-3.5 animate-spin" /> : <Landmark className="size-3.5 text-brand-600" />} เลขบัญชี
        </button>
        <Link href={`/fuelos/quotes/new?conv=${convId}`} className="shrink-0 h-8 px-2.5 rounded-lg border border-border text-xs inline-flex items-center gap-1 hover:bg-surface-2">
          <FileText className="size-3.5 text-brand-600" /> ออกใบเสนอราคา
        </Link>
        <button onClick={() => setShowStickers((v) => !v)} disabled={pending} className={cn("shrink-0 h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1", showStickers ? "border-brand-300 bg-brand-50 text-brand-700" : "border-border hover:bg-surface-2")}>
          <Smile className="size-3.5 text-brand-600" /> สติกเกอร์
        </button>
      </div>
      {/* sticker picker */}
      {showStickers && (
        <div className="grid grid-cols-6 gap-1 rounded-xl border border-border bg-surface-2 p-2">
          {STICKERS.map((st) => (
            <button key={st.s} onClick={() => sticker(st.p, st.s)} disabled={pending} title="ส่งสติกเกอร์นี้"
              className="aspect-square rounded-lg hover:bg-brand-50 grid place-items-center p-1 disabled:opacity-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stickerCdn(st.s)} alt="สติกเกอร์" className="size-full object-contain" />
            </button>
          ))}
        </div>
      )}
      {/* composer */}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          rows={1}
          placeholder="พิมพ์ข้อความ… (⌘+Enter ส่ง)"
          className="flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand-500 max-h-32"
        />
        <button
          onClick={send} disabled={pending || !text.trim()}
          className={cn("size-11 rounded-xl grid place-items-center shrink-0", text.trim() ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-400")}
        >
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
        </button>
      </div>
    </div>
  );
}

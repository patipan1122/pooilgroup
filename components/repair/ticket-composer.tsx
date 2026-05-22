"use client";
// Chat-style composer attached to the bottom of TicketDetailPanel.
// Wires the `.composer` input to lib/repair/actions.addComment + photo upload.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment, addPhoto } from "@/lib/repair/actions";
import { Camera, Send, Loader2 } from "lucide-react";

async function compressImage(file: File, maxEdge = 1024, quality = 0.65): Promise<string> {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  let url = canvas.toDataURL("image/webp", quality);
  if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", quality);
  return url;
}

export function TicketComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function send() {
    const text = body.trim();
    if (text.length === 0) return;
    setError(null);
    startTransition(async () => {
      const r = await addComment({ ticketId, body: text });
      if (!r.ok) {
        setError(r.error ?? "ส่งไม่สำเร็จ");
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await compressImage(file);
      startTransition(async () => {
        const r = await addPhoto({ ticketId, phase: "DURING", dataUrl });
        if (!r.ok) {
          setError(r.error ?? "อัปโหลดไม่สำเร็จ");
          return;
        }
        router.refresh();
      });
    } catch {
      setError("ย่อรูปไม่สำเร็จ");
    }
  }

  return (
    <div className="composer" style={{ flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, width: "100%" }}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="พิมพ์เพื่อเพิ่มความคิดเห็น · กด Enter ส่ง"
          disabled={isPending}
        />
        <label className="btn" style={{ cursor: "pointer" }}>
          <Camera />
          <input
            type="file" accept="image/*" capture="environment"
            style={{ display: "none" }}
            onChange={pickPhoto}
            disabled={isPending}
          />
        </label>
        <button
          type="button"
          onClick={send}
          disabled={isPending || body.trim().length === 0}
          className="btn btn-primary"
        >
          {isPending ? <Loader2 size={14} className="rf-spin" /> : <Send />}
        </button>
      </div>
      {error && (
        <div style={{
          fontSize: 11, color: "var(--bad)",
          padding: "4px 8px",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

"use client";
// Chat-style composer attached to the bottom of TicketDetailPanel.
// Wires the `.composer` input to lib/repair/actions.addComment + photo upload
// with a phase selector (BEFORE / DURING / AFTER / PART / RECEIPT).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment, addPhoto } from "@/lib/repair/actions";
import type { RepairPhotoPhase, RepairTicketStatus } from "@/lib/generated/prisma/enums";
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

const PHASE_OPTIONS: { value: RepairPhotoPhase; label: string }[] = [
  { value: "BEFORE", label: "ก่อนซ่อม" },
  { value: "DURING", label: "ระหว่างซ่อม" },
  { value: "AFTER", label: "หลังซ่อม" },
  { value: "PART", label: "อะไหล่" },
  { value: "RECEIPT", label: "บิล/ใบเสร็จ" },
];

/**
 * Pick a sensible default photo phase based on the current ticket status.
 * RealUser persona feedback: tech uploads "after" photo when closing, but
 * dropdown defaulted to "ระหว่างซ่อม" causing mis-tagged photos.
 */
function defaultPhotoPhase(status?: RepairTicketStatus): RepairPhotoPhase {
  switch (status) {
    case "NEW":
    case "ACK":
      return "BEFORE";
    case "RESOLVED":
    case "CLOSED":
      return "AFTER";
    case "WAITING_PARTS":
      return "PART";
    default:
      return "DURING";
  }
}

export function TicketComposer({
  ticketId,
  ticketStatus,
}: {
  ticketId: string;
  ticketStatus?: RepairTicketStatus;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [photoPhase, setPhotoPhase] = useState<RepairPhotoPhase>(defaultPhotoPhase(ticketStatus));
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
        const r = await addPhoto({ ticketId, phase: photoPhase, dataUrl });
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
    <div className="composer" style={{ flexDirection: "column", gap: 6 }}>
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
        <select
          value={photoPhase}
          onChange={(e) => setPhotoPhase(e.target.value as RepairPhotoPhase)}
          title="ระยะของรูป"
          style={{
            height: 32,
            padding: "0 8px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            fontSize: 11.5,
            fontFamily: "inherit",
            color: "var(--ink-700)",
            outline: "none",
            cursor: "pointer",
          }}
          disabled={isPending}
        >
          {PHASE_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <label className="btn" style={{ cursor: "pointer" }} title={"แนบรูป · " + PHASE_OPTIONS.find((p) => p.value === photoPhase)?.label}>
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

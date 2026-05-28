"use client";
// Pooil App · public track-form (uses .rf-* classes)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trackLookup } from "@/lib/repair/actions";
import { AlertCircle, Loader2, Search } from "lucide-react";

export function TrackForm({
  initialCode = "",
  initialError = null as string | null,
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await trackLookup({ ticketCode: code, phone });
      if (!r.ok) { setError(r.error); return; }
      router.push(
        `/r/track/${encodeURIComponent(code.toUpperCase())}?p=${encodeURIComponent(phone)}`,
      );
    });
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "white", border: "1px solid #E5EAF2",
        borderRadius: 24, padding: 24,
        display: "flex", flexDirection: "column", gap: 14,
      }}
    >
      <div>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>
          เลขที่ใบ
        </label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required autoFocus
          placeholder="RP-2569-0001"
          className="rf-input"
          style={{
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            fontWeight: 700, textTransform: "uppercase",
          }}
        />
        <p style={{ marginTop: 4, fontSize: 11, color: "#94A3B8" }}>รูปแบบ RP-25YY-NNNN</p>
      </div>
      <div>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>
          เบอร์โทรที่ใช้ตอนแจ้ง
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required inputMode="tel"
          placeholder="08x-xxx-xxxx"
          className="rf-input"
        />
      </div>
      {error && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA",
          borderRadius: 12, padding: 12,
          display: "flex", gap: 8, alignItems: "flex-start",
          color: "#B91C1C", fontSize: 12.5,
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="rf-btn primary"
      >
        {isPending ? <Loader2 size={18} /> : <Search size={18} />}
        ดูสถานะ
      </button>
    </form>
  );
}

"use client";

// DriveExportButton — export a document to Google Drive (Track B Item 11)
// POST /api/docuflow/[id]/drive-export · admin tier only (gated by parent).
// 3 states: not exported → exporting (spinner) → exported (link + re-export).
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { DfButton } from "@/components/docuflow/df-ui";
import { bkkDateTime } from "@/lib/utils/format";

interface Props {
  documentId: string;
  initialDriveFileId: string | null;
  initialDriveFileUrl: string | null;
  /** ISO timestamp of the last successful export, or null if never
   *  exported — CEO Pinpoint item #15 (2026-10-13): CEO reported being
   *  unsure whether this button is "really connected" since the only
   *  feedback was a toast that disappears. This persists a visible
   *  confirmation across page loads, not just right after clicking. */
  initialDriveExportedAt?: string | null;
}

export function DriveExportButton({
  documentId,
  initialDriveFileId,
  initialDriveFileUrl,
  initialDriveExportedAt = null,
}: Props) {
  const [driveFileUrl, setDriveFileUrl] = useState(initialDriveFileUrl);
  const [isExported, setIsExported] = useState(initialDriveFileId != null);
  const [exportedAt, setExportedAt] = useState(initialDriveExportedAt);
  const [busy, setBusy] = useState(false);

  async function runExport() {
    setBusy(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}/drive-export`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
      setDriveFileUrl(data.driveUrl as string);
      setIsExported(true);
      // The API doesn't echo back the server timestamp — `new Date()`
      // here is accurate to within the same request/response round trip
      // (the server set its own `new Date()` right before responding).
      setExportedAt(new Date().toISOString());
      toast.success("ส่งออกไป Google Drive เรียบร้อย");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  // CEO Pinpoint item #15 (2026-10-13): "ส่งออกไป Google Drive" already
  // genuinely works end-to-end (real OAuth reuse + real error states) —
  // the gap was communication, not wiring. One short caption explains what
  // the button actually does, shown in both states below.
  const explainer = (
    <p style={{ fontSize: 11, color: "var(--df-muted)", margin: 0 }}>
      ส่งสำเนาไฟล์นี้ไปเก็บใน Google Drive ที่เชื่อมต่อไว้ (ทางเดียว — ไม่ sync กลับ)
    </p>
  );

  if (isExported && driveFileUrl) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
          <DfButton
            href={driveFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost"
            style={{ justifyContent: "center" }}
          >
            <ExternalLink size={14} />
            เปิดใน Drive
          </DfButton>
          <DfButton
            variant="ghost"
            onClick={runExport}
            disabled={busy}
            title="ส่งออกใหม่ — เขียนทับไฟล์เดิมใน Drive ด้วยสำเนาล่าสุด"
            style={{ justifyContent: "center" }}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            ส่งออกใหม่
          </DfButton>
        </div>
        {/* Clear, persistent confirmation — not just a toast that
            disappears — so a CEO re-opening this document later can still
            see at a glance "yes, this really exported." */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--df-success)",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <CheckCircle2 size={12} />
          ส่งไปแล้ว{exportedAt ? ` · ${bkkDateTime(exportedAt)}` : ""}
        </p>
        {explainer}
        <p style={{ fontSize: 11, color: "var(--df-muted)", margin: 0 }}>
          ส่งออกแบบทางเดียว (snapshot ล่าสุด) — แก้ไฟล์ใน Drive จะไม่ย้อนกลับมาที่ระบบนี้
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <DfButton
        variant="ghost"
        onClick={runExport}
        disabled={busy}
        style={{ justifyContent: "center" }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
        {busy ? "กำลังส่งออก..." : "ส่งออกไป Google Drive"}
      </DfButton>
      {explainer}
    </div>
  );
}

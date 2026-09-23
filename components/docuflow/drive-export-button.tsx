"use client";

// DriveExportButton — export a document to Google Drive (Track B Item 11)
// POST /api/docuflow/[id]/drive-export · admin tier only (gated by parent).
// 3 states: not exported → exporting (spinner) → exported (link + re-export).
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { DfButton } from "@/components/docuflow/df-ui";

interface Props {
  documentId: string;
  initialDriveFileId: string | null;
  initialDriveFileUrl: string | null;
}

export function DriveExportButton({
  documentId,
  initialDriveFileId,
  initialDriveFileUrl,
}: Props) {
  const [driveFileUrl, setDriveFileUrl] = useState(initialDriveFileUrl);
  const [isExported, setIsExported] = useState(initialDriveFileId != null);
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
      toast.success("ส่งออกไป Google Drive เรียบร้อย");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

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
        <p style={{ fontSize: 11, color: "var(--df-muted)", margin: 0 }}>
          ส่งออกแบบทางเดียว (snapshot ล่าสุด) — แก้ไฟล์ใน Drive จะไม่ย้อนกลับมาที่ระบบนี้
        </p>
      </div>
    );
  }

  return (
    <DfButton
      variant="ghost"
      onClick={runExport}
      disabled={busy}
      style={{ justifyContent: "center" }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <HardDrive size={14} />}
      {busy ? "กำลังส่งออก..." : "ส่งออกไป Google Drive"}
    </DfButton>
  );
}

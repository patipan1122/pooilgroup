"use client";

// Reusable ID-card / document uploader for ChairOps maid flows (CEO 2026-07-12).
// Uploads to R2 via the generic /api/r2/sign presign route and exposes the
// resulting URL + filename through hidden inputs so a plain <form> submit picks
// them up. Accepts image or PDF. PDPA note: the R2 URL is an obscure-UUID public
// object — sensitive docs; a Drive-private move is a recommended hardening.

import { useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";

/** fetch() only throws TypeError for network-level failures (Safari surfaces
 *  this as the bare, unhelpful message "Load failed") — retry once since
 *  mobile signal drops are the common cause, but never retry a real HTTP
 *  error response. */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return await fetch(input, init);
  }
}

interface Props {
  /** hidden-input name prefix → `${name}ImageUrl` + `${name}FileName` */
  name?: string;
  label?: string;
  initialUrl?: string | null;
  initialName?: string | null;
  /** controlled-flow callback — fires when the uploaded/removed url changes */
  onChange?: (url: string | null, fileName: string | null) => void;
}

export function IdCardUpload({
  name = "idCard",
  label = "รูปบัตรประชาชน",
  initialUrl = null,
  initialName = null,
  onChange,
}: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [fileName, setFileName] = useState<string | null>(initialName);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const presign = await fetchWithRetry("/api/r2/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      if (!presign.ok) {
        const j = (await presign.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");
      }
      const { uploadUrl, publicUrl } = (await presign.json()) as {
        uploadUrl: string;
        publicUrl: string;
      };
      const put = await fetchWithRetry(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("อัปโหลดไฟล์ไม่สำเร็จ");
      setUrl(publicUrl);
      setFileName(file.name);
      onChange?.(publicUrl, file.name);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "เน็ตหลุดกลางทางตอนอัปโหลดรูป — เช็คสัญญาณแล้วลองใหม่อีกครั้ง"
          : err instanceof Error
            ? err.message
            : "อัปโหลดไม่สำเร็จ",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const isImage = !!url && !/\.pdf($|\?)/i.test(fileName ?? url);

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">{label}</span>
      <input type="hidden" name={`${name}ImageUrl`} value={url ?? ""} />
      <input type="hidden" name={`${name}FileName`} value={fileName ?? ""} />

      {url ? (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
          {/* เดิมเป็นแค่รูปเล็ก/ไอคอนเฉยๆ กดดูไฟล์เต็มไม่ได้เลย (CEO report
              2026-09-23 — office ดูเอกสารบัตรประชาชนที่แม่บ้านแนบมาไม่ได้) */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="บัตรประชาชน"
                className="h-16 w-24 shrink-0 rounded-md object-cover transition hover:opacity-80"
              />
            ) : (
              <FileText className="size-8 shrink-0 text-zinc-400" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-blue-600 hover:underline">
              {fileName ?? "ดูไฟล์ที่แนบ"}
            </span>
          </a>
          <button
            type="button"
            onClick={() => {
              setUrl(null);
              setFileName(null);
              onChange?.(null, null);
            }}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            aria-label="เอาไฟล์ออก"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-3 py-3.5 text-sm text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> กำลังอัปโหลด…
            </>
          ) : (
            <>
              <Upload className="size-4" /> ถ่าย / เลือกรูปบัตรประชาชน
            </>
          )}
        </button>
      )}

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}
      {/* ไม่ใส่ capture — ปุ่มนี้สัญญาว่า "ถ่าย / เลือกรูป" ได้ทั้งสองทาง ถ้าใส่
          capture มือถือ/แอปแชทบางตัว (เช่น LINE in-app browser) จะบังคับเปิด
          กล้องอย่างเดียว เปิดคลังรูปไม่ได้เลย (CEO report 2026-09-23) */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}

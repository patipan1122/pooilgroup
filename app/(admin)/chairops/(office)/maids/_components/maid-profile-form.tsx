"use client";

// Maid profile / payroll-info form (CEO 2026-06-03).
// Edits เบอร์โทร + bank account + uploads สัญญาจ้าง (PDF/รูป) to R2 via the
// generic /api/r2/sign presign route. Stores only the resulting URL + filename
// through the updateMaidProfile server action — for future payroll setup.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload, X } from "lucide-react";

import { updateMaidProfile } from "../actions";

interface Props {
  maidId: string;
  phone: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  contractFileUrl: string | null;
  contractFileName: string | null;
}

export function MaidProfileForm({
  maidId,
  phone,
  bankName,
  bankAccountNo,
  bankAccountName,
  contractFileUrl,
  contractFileName,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Contract file lives in local state so it survives until the form is saved.
  const [fileUrl, setFileUrl] = useState<string | null>(contractFileUrl);
  const [fileName, setFileName] = useState<string | null>(contractFileName);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const presignRes = await fetch("/api/r2/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      if (!presignRes.ok) {
        const j = (await presignRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");
      }
      const { uploadUrl, publicUrl } = (await presignRes.json()) as {
        uploadUrl: string;
        publicUrl: string;
      };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("อัปโหลดไฟล์ไม่สำเร็จ");
      setFileUrl(publicUrl);
      setFileName(file.name);
      setDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    const fd = new FormData(e.currentTarget);
    fd.set("contractFileUrl", fileUrl ?? "");
    fd.set("contractFileName", fileName ?? "");
    startTransition(async () => {
      const res = await updateMaidProfile(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="maidId" value={maidId} />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600">
          เบอร์โทร
        </span>
        <input
          type="tel"
          name="phone"
          defaultValue={phone ?? ""}
          placeholder="08x-xxx-xxxx"
          className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            ธนาคาร
          </span>
          <input
            type="text"
            name="bankName"
            defaultValue={bankName ?? ""}
            placeholder="กสิกรไทย"
            className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            เลขบัญชี
          </span>
          <input
            type="text"
            name="bankAccountNo"
            defaultValue={bankAccountNo ?? ""}
            inputMode="numeric"
            placeholder="123-4-56789-0"
            className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm tabular-nums"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600">
          ชื่อบัญชี (ถ้าต่างจากชื่อแม่บ้าน)
        </span>
        <input
          type="text"
          name="bankAccountName"
          defaultValue={bankAccountName ?? ""}
          className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm"
        />
      </label>

      {/* Contract upload */}
      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-600">
          สัญญาจ้าง (PDF / รูป)
        </span>
        {fileUrl ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <FileText className="size-4 shrink-0" />
              <span className="truncate">{fileName ?? "ดูไฟล์สัญญา"}</span>
            </a>
            <button
              type="button"
              onClick={() => {
                setFileUrl(null);
                setFileName(null);
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-2.5 text-sm text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> กำลังอัปโหลด…
              </>
            ) : (
              <>
                <Upload className="size-4" /> เลือกไฟล์สัญญา
              </>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          onChange={onPickFile}
          className="hidden"
        />
      </div>

      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          บันทึกแล้ว ✓
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || uploading}
        className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
      </button>
    </form>
  );
}

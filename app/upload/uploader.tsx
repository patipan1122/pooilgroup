"use client";

import { useState } from "react";

type UploadedFile = { url: string; contentType: string; name: string };

export function Uploader() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);

    const contentType = file.type || "application/octet-stream";

    const signRes = await fetch("/api/r2/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType,
        size: file.size,
      }),
    });

    if (!signRes.ok) {
      const { error: msg } = await signRes
        .json()
        .catch(() => ({ error: signRes.statusText }));
      setError(msg ?? "Failed to sign upload");
      setProgress(null);
      return;
    }

    const { uploadUrl, publicUrl } = (await signRes.json()) as {
      uploadUrl: string;
      publicUrl: string;
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setProgress(null);
      return;
    }

    setFiles((prev) => [
      ...prev,
      { url: publicUrl, contentType, name: file.name },
    ]);
    setProgress(null);
  }

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="mb-2 block text-sm font-medium">
          เลือกไฟล์ (รูปหรือวิดีโอ, สูงสุด 500 MB)
        </span>
        <input
          type="file"
          accept="image/*,video/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={progress !== null}
          className="block w-full text-sm"
        />
      </label>

      {progress !== null && (
        <div className="text-sm">กำลังอัพโหลด: {progress}%</div>
      )}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <ul className="space-y-3">
        {files.map((f) => (
          <li key={f.url} className="rounded border p-3">
            <div className="mb-2 text-xs text-zinc-500">{f.name}</div>
            {f.contentType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={f.name} className="max-h-64" />
            ) : (
              <video src={f.url} controls className="max-h-64 w-full" />
            )}
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block break-all text-xs text-blue-600"
            >
              {f.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { FileText, Image as ImageIcon, Download } from "lucide-react";

interface FileEntry {
  key: string;
  name: string;
  size: number;
  mime: string;
}

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";

export function ApplicationFiles({ files }: { files: FileEntry[] }) {
  if (!files.length) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold text-zinc-900 mb-3 uppercase tracking-wider">
        📎 ไฟล์แนบ ({files.length})
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {files.map((f) => {
          const isImage = f.mime.startsWith("image/");
          const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${f.key}` : "";
          return (
            <a
              key={f.key}
              href={url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/30 transition-colors"
            >
              <div className="size-10 rounded-xl bg-zinc-100 flex items-center justify-center shrink-0">
                {isImage ? (
                  <ImageIcon className="size-5 text-zinc-600" />
                ) : (
                  <FileText className="size-5 text-zinc-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 truncate">
                  {f.name}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {formatSize(f.size)} · {f.mime.split("/")[1]?.toUpperCase()}
                </p>
              </div>
              <Download className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-700)] shrink-0" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUploadUrl } from "@/lib/r2/upload";

const MAX_SIZE = 500 * 1024 * 1024;

// Whitelist + blocklist (defense-in-depth) สำหรับ MIME types
// อนุญาตเฉพาะ types ที่ใช้จริงใน CashHub (รูป/วีดีโอ) + DocuFlow (PDF/Office)
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  // Videos (เฉพาะ format ที่ LIFF/browser ปกติส่งมา)
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // Documents (DocuFlow)
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

// Always-blocked (executable / script / dangerous)
const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi",
  ".sh", ".bash", ".zsh", ".ps1", ".vbs", ".js",
  ".jar", ".dmg", ".app", ".deb", ".rpm",
  ".php", ".asp", ".aspx", ".jsp",
];

function isAllowedMime(contentType: string): boolean {
  return ALLOWED_MIME_TYPES.has(contentType.toLowerCase());
}

function hasBlockedExtension(filename: string): boolean {
  // Check EVERY dot-segment, not just the final one. Was: `evil.exe.png`
  // passed because endsWith(".exe") was false — and if contentType lies
  // as `image/png` the MIME whitelist also lets it through. By splitting
  // on `.` we catch double-extension tricks like `report.bat.pdf`.
  const lower = filename.toLowerCase();
  const segments = lower.split(".").slice(1); // drop the base name
  return segments.some((seg) =>
    BLOCKED_EXTENSIONS.some((ext) => ext === "." + seg),
  );
}

export async function POST(req: NextRequest) {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET ||
    !process.env.R2_PUBLIC_URL
  ) {
    return NextResponse.json(
      { error: "R2 env vars are not configured" },
      { status: 500 },
    );
  }

  let body: { filename?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { filename, contentType, size } = body;
  if (
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof size !== "number"
  ) {
    return NextResponse.json(
      {
        error:
          "Required: filename (string), contentType (string), size (number)",
      },
      { status: 400 },
    );
  }

  if (hasBlockedExtension(filename)) {
    return NextResponse.json(
      { error: "ประเภทไฟล์ไม่อนุญาต (executable/script)" },
      { status: 415 },
    );
  }
  if (!isAllowedMime(contentType)) {
    return NextResponse.json(
      {
        error:
          "ประเภทไฟล์ไม่อนุญาต — รับเฉพาะ รูป/วีดีโอ/PDF/Word/Excel",
      },
      { status: 415 },
    );
  }

  if (size <= 0 || size > MAX_SIZE) {
    return NextResponse.json(
      { error: `Size must be between 1 and ${MAX_SIZE} bytes` },
      { status: 413 },
    );
  }

  // Auth gate: only authenticated users can request presigned upload URLs
  // (เคยมี anon prefix ที่อนุญาตให้ upload โดยไม่ login → ปิดช่องนี้)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "ต้อง login ก่อน upload" },
      { status: 401 },
    );
  }

  const safeName = filename.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `users/${user.id}/${crypto.randomUUID()}-${safeName}`;

  const { url, publicUrl } = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl: url, publicUrl, key });
}

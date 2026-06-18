import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { putObject } from "@/lib/r2/upload";

// Server-side upload — รับไฟล์แล้ว putObject เองที่เซิร์ฟเวอร์ (ไม่ใช้ browser→R2 PUT)
// ทำไม: browser presigned PUT ต้องผ่าน R2 CORS allowlist (มีแค่ *.vercel.app + localhost)
// → พังเงียบบน custom domain เช่น pooilgroup.com. ทางนี้ตัด dependency CORS ทิ้งถาวร
// (รูปแบบเดียวกับ clawhub refund / docuflow upload-proxy). ดู clawhub-reward-image-upload-cors.

// อ่านทั้ง body เข้า memory → cap ต่ำกว่า /api/r2/sign (ซึ่งใช้ presigned สำหรับวีดีโอใหญ่)
const MAX_SIZE = 12 * 1024 * 1024; // 12MB — ภาพหน้าจอ pinpoint จริง ~0.1-0.5MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi",
  ".sh", ".bash", ".zsh", ".ps1", ".vbs", ".js",
  ".jar", ".dmg", ".app", ".deb", ".rpm",
  ".php", ".asp", ".aspx", ".jsp",
];

function hasBlockedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  const segments = lower.split(".").slice(1);
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

  // Auth gate: ต้อง login ก่อน (เหมือน /api/r2/sign)
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form body (expected multipart/form-data)" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Required: file (Blob field)" },
      { status: 400 },
    );
  }

  const rawName =
    file instanceof File && file.name
      ? file.name
      : typeof form.get("filename") === "string"
        ? (form.get("filename") as string)
        : "upload.webp";
  const contentType = file.type || "image/webp";

  if (hasBlockedExtension(rawName)) {
    return NextResponse.json(
      { error: "ประเภทไฟล์ไม่อนุญาต (executable/script)" },
      { status: 415 },
    );
  }
  if (!ALLOWED_MIME_TYPES.has(contentType.toLowerCase())) {
    return NextResponse.json(
      { error: "ประเภทไฟล์ไม่อนุญาต — รับเฉพาะรูปภาพ" },
      { status: 415 },
    );
  }
  if (file.size <= 0 || file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `ไฟล์ต้องมีขนาด 1 ถึง ${MAX_SIZE} bytes` },
      { status: 413 },
    );
  }

  const safeName = rawName.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `users/${user.id}/${crypto.randomUUID()}-${safeName}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await putObject(key, buffer, contentType);
    return NextResponse.json({ key, publicUrl });
  } catch (err) {
    console.error("[r2/upload] putObject failed", err);
    return NextResponse.json(
      { error: "อัปโหลดไปคลังเก็บรูปไม่สำเร็จ" },
      { status: 502 },
    );
  }
}

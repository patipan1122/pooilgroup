import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUploadUrl } from "@/lib/r2/upload";

const MAX_SIZE = 500 * 1024 * 1024;
const ALLOWED_PREFIXES = ["image/", "video/"];

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

  if (!ALLOWED_PREFIXES.some((p) => contentType.startsWith(p))) {
    return NextResponse.json(
      { error: "Only image/* and video/* are allowed" },
      { status: 415 },
    );
  }

  if (size <= 0 || size > MAX_SIZE) {
    return NextResponse.json(
      { error: `Size must be between 1 and ${MAX_SIZE} bytes` },
      { status: 413 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const prefix = user ? `users/${user.id}` : "anon";

  const safeName = filename.replace(/[^\w.-]+/g, "_").slice(-80);
  const key = `${prefix}/${crypto.randomUUID()}-${safeName}`;

  const { url, publicUrl } = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl: url, publicUrl, key });
}

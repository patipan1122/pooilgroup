// Authed proxy in front of ChairOps's R2 photo bucket (ID cards, selfies,
// deposit/vendor-bill slips, damage photos). The bucket itself is still
// publicly readable — this route exists so the APP's own rendered HTML never
// embeds the bare public URL, only a link to here, which 401s without a
// ChairOps session. Interim fix for ultramobileux audit P0-1 (2026-10-07);
// full fix is migrating the bucket to private reads + presigned GETs.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/chairops/auth/session";
import { getObject } from "@/lib/r2/upload";
import { R2_PUBLIC_URL } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

// Only ever resolve a key from a URL that actually points at our own R2
// public bucket — same host+path check as lib/chairops/utils/url-guard.ts —
// so this can't be turned into an open proxy for arbitrary URLs.
function keyFromStoredUrl(stored: string): string | null {
  try {
    const u = new URL(stored);
    const base = new URL(R2_PUBLIC_URL);
    if (u.host !== base.host || !u.pathname.startsWith(base.pathname)) return null;
    const key = u.pathname.slice(base.pathname.length).replace(/^\/+/, "");
    return key || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const stored = req.nextUrl.searchParams.get("u");
  if (!stored) return new NextResponse(null, { status: 400 });

  const key = keyFromStoredUrl(stored);
  if (!key) return new NextResponse(null, { status: 400 });

  try {
    const bytes = await getObject(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentTypeForKey(key),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

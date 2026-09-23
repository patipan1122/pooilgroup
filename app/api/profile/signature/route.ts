// GET/POST/DELETE /api/profile/signature
// ────────────────────────────────────────────────────────────────────
// Personal "ลายเซ็นของฉัน" setting — any signed-in user can save ONE
// signature image on their own account, reused across DocuFlow signing
// events instead of drawing fresh every time.
//
// Security: every handler resolves the target user ONLY from the session
// (`session.user.id`) — a `userId` is never accepted from the request
// body or query string. Without this, one user could read, overwrite, or
// delete another user's saved signature.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  clearMySignature,
  getMySignatureUrl,
  saveMySignature,
} from "@/lib/docuflow/my-signature";

export const dynamic = "force-dynamic";

// Same PNG-data-URL shape/validation as the existing sign endpoint's
// BodySchema (app/api/docuflow/[id]/signatures/[placementId]/sign/route.ts).
const BodySchema = z.object({
  // PNG data URL: "data:image/png;base64,iVBOR..."
  imageDataUrl: z
    .string()
    .min(32)
    .max(8 * 1024 * 1024) // 8MB cap (data URL is ~33% larger than bytes)
    .refine((v) => v.startsWith("data:image/png;base64,"), {
      message: "Expected base64 PNG data URL",
    }),
});

function decodeDataUrl(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

export async function GET() {
  const session = await requireSession();
  const previewUrl = await getMySignatureUrl(session.user.id);
  return NextResponse.json({
    hasSignature: previewUrl !== null,
    previewUrl,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลลายเซ็นไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const buf = decodeDataUrl(parsed.data.imageDataUrl);
  if (buf.length < 64) {
    return NextResponse.json(
      { error: "ลายเซ็นว่างเปล่า กรุณาเซ็นอีกครั้ง" },
      { status: 400 },
    );
  }

  try {
    await saveMySignature({
      userId: session.user.id,
      orgId: session.user.org_id,
      pngBuffer: buf,
    });
  } catch (err) {
    console.error("[profile/signature POST] save failed", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "บันทึกลายเซ็นไม่สำเร็จ ลองใหม่",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const session = await requireSession();
  try {
    await clearMySignature(session.user.id);
  } catch (err) {
    console.error("[profile/signature DELETE] failed", err);
    return NextResponse.json(
      { error: "ลบลายเซ็นไม่สำเร็จ ลองใหม่" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

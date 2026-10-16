// POST /api/docuflow/[id]/signatures/[placementId]/sign
// ────────────────────────────────────────────────────────────────────
// Web signer endpoint — thin wrapper. Resolves the session + parses the
// request body, then delegates the actual signing (auth re-check, R2
// upload, DB write, audit log, embed-on-completion) to the SHARED
// `signPlacement()` in lib/docuflow/sign-placement.ts. That function is
// also called by POST /api/telegram/webapp/sign (the Telegram Mini App) —
// extracted 2026-10-16 so the two entry points can never implement
// signing differently. See that file's header for the full behavior.
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { userCanAdminModule } from "@/lib/auth/module-access";
import { signPlacement } from "@/lib/docuflow/sign-placement";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; placementId: string }>;
};

const IdSchema = zUUID();

// Existing shape (draw-and-submit), unchanged validation — plus one new
// optional field.
const DrawnSignatureSchema = z.object({
  // PNG data URL: "data:image/png;base64,iVBOR..."
  imageDataUrl: z
    .string()
    .min(32)
    .max(8 * 1024 * 1024) // 8MB cap (data URL is ~33% larger than bytes)
    .refine((v) => v.startsWith("data:image/png;base64,"), {
      message: "Expected base64 PNG data URL",
    }),
  // Default-checked in the UI when the signer has no saved signature yet.
  saveAsDefault: z.boolean().optional(),
});

// One-tap "use my saved signature" path.
const UseSavedSignatureSchema = z.object({
  useSavedSignature: z.literal(true),
});

const BodySchema = z.union([DrawnSignatureSchema, UseSavedSignatureSchema]);

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await requireSession();
  const { id: documentId, placementId } = await ctx.params;

  if (
    !IdSchema.safeParse(documentId).success ||
    !IdSchema.safeParse(placementId).success
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

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

  const orgId = session.user.org_id;

  const result = await signPlacement({
    documentId,
    placementId,
    orgId,
    userId: session.user.id,
    // Lazy — signPlacement() only calls this when the placement's
    // signerUserId is null, so the common "assigned signer" path never
    // pays for this DB round-trip. Same behavior as before extraction.
    isModuleAdmin: () => userCanAdminModule(session.user, "docuflow"),
    body: parsed.data,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    remaining: result.remaining,
    signedFileKey: result.signedFileKey,
  });
}

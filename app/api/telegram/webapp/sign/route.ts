// POST /api/telegram/webapp/sign — Telegram Mini App's "sign these"
// ────────────────────────────────────────────────────────────────────
// Validates the caller via `resolveTelegramWebAppUser()` (the only auth
// boundary — no cookie session here), then signs each requested
// placement using the SAME shared `signPlacement()` function
// (lib/docuflow/sign-placement.ts) that
// POST /api/docuflow/[id]/signatures/[placementId]/sign already calls —
// identical R2 upload / DB write / audit-log / embed-on-completion
// behavior, always via `useSavedSignature: true` (the Mini App never
// offers a draw-your-own-signature canvas — see Part 5 of the task
// spec: it requires a saved signature up front).
//
// Accepts a LIST of {documentId, placementId} so one call can sign many
// placements, but the client intentionally calls this once PER
// placement (small worker-pool concurrency, same pattern as
// components/docuflow/to-sign-list.tsx's `runPool`) rather than one
// giant batch call — that's what lets the UI show a truly live,
// one-checkmark-at-a-time checklist instead of all-or-nothing. Either
// calling pattern is supported: this endpoint has no hidden assumption
// about batch size (other than the sanity cap below).
//
// `isModuleAdmin` is hard-coded to `async () => false`: every placement
// this surface ever touches comes from `getToSignDocuments()`, which
// already filters to `signerUserId: <caller>` — the signerUserId-null
// admin-fallback path inside signPlacement() can never legitimately
// apply here, so there's nothing to resolve.
// ────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { resolveTelegramWebAppUser } from "@/lib/telegram/webapp-auth";
import { signPlacement } from "@/lib/docuflow/sign-placement";

export const dynamic = "force-dynamic";

const ItemSchema = z.object({
  documentId: zUUID(),
  placementId: zUUID(),
});

// Sanity cap — mirrors the kind of bound the web bulk-sign flow is
// naturally limited to by "documents a human can see on one screen."
// Not a hard business rule, just abuse/foot-gun protection.
const BodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(50),
});

export async function POST(req: Request) {
  const resolved = await resolveTelegramWebAppUser(req);
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error:
          resolved.reason === "not_connected"
            ? "ยังไม่ได้เชื่อมบัญชี Telegram"
            : "Unauthorized",
        reason: resolved.reason,
      },
      { status: resolved.reason === "not_connected" ? 403 : 401 },
    );
  }
  const { user } = resolved;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const results: Array<{
    placementId: string;
    success: boolean;
    error?: string;
  }> = [];

  // Sequential — simplest safe option for a server-side batch. embedSignatures()
  // already has its own race guard (fast-path check for an existing
  // signedFileKey) so concurrent requests from the per-item client loop
  // (separate HTTP calls) are safe too; this just keeps a single request
  // carrying multiple items from hammering R2/DB in parallel for no benefit.
  for (const item of parsed.data.items) {
    const result = await signPlacement({
      documentId: item.documentId,
      placementId: item.placementId,
      orgId: user.orgId,
      userId: user.id,
      isModuleAdmin: async () => false,
      body: { useSavedSignature: true },
    });
    if (result.ok) {
      results.push({ placementId: item.placementId, success: true });
    } else {
      results.push({
        placementId: item.placementId,
        success: false,
        error: result.error,
      });
    }
  }

  return NextResponse.json({ results });
}

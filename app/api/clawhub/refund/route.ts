// POST /api/clawhub/refund
// The money screen's submit. Verify id_token (W-014: never trust a client member id),
// require PDPA consent, store the screenshot to R2, hash it for dedup, run AI vision on
// the LCD, then hand off to submitRefund (the only place that writes a refund + credits
// points). Returns the outcome + the customer's fresh balance.
//
// Architecture notes (RULE I):
//  - Idempotency / dedup: submitRefund dedups on (memberId, screenshotSha256) AND the
//    DB has a unique index on that pair → double-submit of the SAME photo = DUPLICATE,
//    never double-credit. We compute the sha256 here from the decoded bytes.
//  - Data consistency: the request row + point credit + counter bumps are ONE prisma
//    $transaction inside submitRefund. The only thing outside it is the R2 upload; if
//    the transaction then fails the object is an orphan (harmless, retention cleans it).
//  - We do NOT push a LINE message here (the webhook agent owns push) to avoid coupling.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { resolveMemberFromIdToken } from "@/lib/clawhub/verify-member";
import { resolveMachine } from "@/lib/clawhub/customer-data";
import { availableBalance } from "@/lib/clawhub/points";
import { refundScreenshotKey, putObject } from "@/lib/clawhub/r2";
import { readMachineScreen } from "@/lib/clawhub/vision";
import { submitRefund } from "@/lib/clawhub/refund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  idToken: z.string().min(20).max(4096),
  // Customer types the baht they inserted. Positive integer only.
  claimedBaht: z.number().int().positive().max(100000),
  // Compressed JPEG from the client, base64 (no data: prefix; we strip it defensively).
  imageBase64: z.string().min(50),
  mimeType: z.string().max(60).optional(),
  // Optional machine code or qrToken (from ?machine= / QR scan).
  machineCode: z.string().max(120).optional(),
  // Profile hints to enrich a brand-new member.
  displayName: z.string().max(120).optional(),
  pictureUrl: z.string().max(1024).optional(),
});

/** Strip a leading `data:<mime>;base64,` prefix if the client left it on.
 *  ([\s\S] instead of the /s dotAll flag — tsconfig targets ES2017.) */
function stripDataUrl(b64: string): { data: string; mime?: string } {
  const m = b64.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
  if (m) return { data: m[2], mime: m[1] };
  return { data: b64 };
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ครบ — ต้องมีรูปและจำนวนเงิน" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // 1) Trusted identity.
  const resolved = await resolveMemberFromIdToken(input.idToken, {
    displayName: input.displayName,
    pictureUrl: input.pictureUrl,
  });
  if (!resolved) {
    return NextResponse.json({ error: "LINE token ไม่ถูกต้อง" }, { status: 401 });
  }
  const { orgId, member } = resolved;

  // 2) Consent gate — PDPA must be accepted before the first refund.
  if (!member.consentAt) {
    return NextResponse.json(
      { error: "ต้องยอมรับเงื่อนไขก่อน", needsConsent: true },
      { status: 403 },
    );
  }

  // 3) Decode the image → bytes.
  const { data: b64, mime: dataMime } = stripDataUrl(input.imageBase64);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return NextResponse.json({ error: "รูปไม่ถูกต้อง" }, { status: 400 });
  }
  if (bytes.length < 100) {
    return NextResponse.json({ error: "รูปไม่ถูกต้อง" }, { status: 400 });
  }
  const mimeType = input.mimeType || dataMime || "image/jpeg";

  // 4) Hash for dedup (sha256 of the raw bytes), then upload to R2.
  const screenshotSha256 = createHash("sha256").update(bytes).digest("hex");
  const screenshotR2Key = refundScreenshotKey(orgId, member.id);
  try {
    await putObject(screenshotR2Key, bytes, mimeType);
  } catch (e) {
    console.error("[clawhub.refund] R2 upload failed", e);
    return NextResponse.json(
      { error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" },
      { status: 502 },
    );
  }

  // 5) Resolve the machine snapshot (soft — refund proceeds without it).
  let machine: Awaited<ReturnType<typeof resolveMachine>> | null = null;
  if (input.machineCode) {
    machine = await resolveMachine(orgId, input.machineCode);
  }

  // 6) AI reads the LCD. (vision.ts has its own budget guard + graceful FAIL.)
  const vision = await readMachineScreen(
    { base64: b64, mimeType },
    { orgId, userId: null },
  );

  // 7) Decide + persist + (auto) credit — all the DB writes live in submitRefund.
  const result = await submitRefund({
    orgId,
    member,
    claimedBaht: input.claimedBaht,
    screenshotR2Key,
    screenshotSha256,
    vision,
    machine: machine
      ? {
          machineId: machine.machineId,
          machineCode: machine.machineCode,
          machineQrToken: machine.machineQrToken,
          branchId: machine.branchId,
        }
      : undefined,
  });

  // Fresh balance so the screen can show the new total immediately.
  const balance = await availableBalance(member.id);

  return NextResponse.json({
    status: result.status,
    pointsAwarded: result.pointsAwarded,
    reason: result.reason,
    requestId: result.requestId ?? null,
    balance,
  });
}

// LedgerLine — Generic Revenue Webhook
// POST /api/ledger/webhooks/revenue
//
// Accepts revenue entries pushed by external systems (TRCloud configured outbound,
// POS systems, ChairOps, ClawFleet via internal call). Validates with
// LEDGER_WEBHOOK_SECRET (HMAC-SHA256 signature in X-Webhook-Signature header).
//
// Payload shape (JSON):
//   { orgId, companyId, sourceType, sourceRef, entryDate (YYYY-MM-DD),
//     amountSatang, description?, customerName?, paymentChannel?, rawJson? }
//
// Returns: { ok: true, id } on success, { ok: false, error } on failure.

import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestWebhookRevenue } from "@/lib/ledger/trcloud-revenue";

const WEBHOOK_SECRET = process.env.LEDGER_WEBHOOK_SECRET ?? "";

const ALLOWED_SOURCE_TYPES = ["TRCLOUD_IV","CHAIROPS","CLAWFLEET","FUELOS","WEBHOOK","MANUAL"] as const;
type SourceType = typeof ALLOWED_SOURCE_TYPES[number];

function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false; // secret not configured → reject all
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  // constant-time compare (prevents timing attack)
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  // Read raw body for HMAC verification
  const bodyText = await req.text();
  const signature = req.headers.get("x-webhook-signature") ?? "";

  if (!verifySignature(bodyText, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const {
    orgId, companyId, sourceType, sourceRef,
    entryDate, amountSatang, description, customerName, paymentChannel, rawJson,
  } = payload as Record<string, unknown>;

  // Basic validation
  if (typeof orgId !== "string" || !orgId) {
    return NextResponse.json({ ok: false, error: "orgId required" }, { status: 400 });
  }
  if (typeof companyId !== "string" || !companyId) {
    return NextResponse.json({ ok: false, error: "companyId required" }, { status: 400 });
  }
  if (!ALLOWED_SOURCE_TYPES.includes(sourceType as SourceType)) {
    return NextResponse.json({ ok: false, error: `sourceType must be one of ${ALLOWED_SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  if (typeof entryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return NextResponse.json({ ok: false, error: "entryDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const satang = typeof amountSatang === "number" ? amountSatang : parseInt(String(amountSatang), 10);
  if (isNaN(satang) || satang <= 0) {
    return NextResponse.json({ ok: false, error: "amountSatang must be a positive integer" }, { status: 400 });
  }

  const result = await ingestWebhookRevenue({
    orgId,
    companyId,
    sourceType: sourceType as SourceType,
    sourceRef: typeof sourceRef === "string" ? sourceRef : null,
    entryDate,
    amountSatang: satang,
    description: typeof description === "string" ? description : undefined,
    customerName: typeof customerName === "string" ? customerName : undefined,
    paymentChannel: typeof paymentChannel === "string" ? paymentChannel : undefined,
    rawJson: rawJson && typeof rawJson === "object" ? rawJson as Record<string, unknown> : undefined,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}

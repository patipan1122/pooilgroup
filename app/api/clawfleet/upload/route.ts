// ClawFleet — photo upload endpoint
// Accepts multipart with: photo (Blob WebP/JPEG/PNG), orgId, machineCode, eventScopeId, phase
// Returns: { url, key, bytes }

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadEventPhoto, validateImageBuffer } from "@/lib/clawfleet/photo";

export const runtime = "nodejs";

const PHASES = ["meter_before", "cash", "meter_after", "stock"] as const;
type Phase = (typeof PHASES)[number];

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form data" }, { status: 400 });
  }

  const file = fd.get("photo");
  const orgId = String(fd.get("orgId") ?? "");
  const machineCode = String(fd.get("machineCode") ?? "");
  const eventScopeId = String(fd.get("eventScopeId") ?? "");
  const phase = String(fd.get("phase") ?? "") as Phase;

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing photo" }, { status: 400 });
  }
  if (orgId !== session.user.org_id) {
    return NextResponse.json({ error: "org mismatch" }, { status: 403 });
  }
  if (!machineCode || !eventScopeId || !PHASES.includes(phase)) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const validate = validateImageBuffer(buf);
  if (!validate.ok) {
    return NextResponse.json({ error: validate.reason }, { status: 400 });
  }

  try {
    const url = await uploadEventPhoto({
      orgId,
      machineCode,
      eventId: eventScopeId,
      phase,
      body: buf,
    });
    return NextResponse.json({ url, bytes: buf.byteLength });
  } catch (e) {
    return NextResponse.json(
      { error: `upload failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

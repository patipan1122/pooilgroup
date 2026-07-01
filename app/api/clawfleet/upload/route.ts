// ClawFleet — photo upload endpoint
// Accepts multipart with: photo (Blob WebP/JPEG/PNG), orgId, machineCode, eventScopeId, phase
// Returns: { url, key, bytes }

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadEventPhoto, validateImageBuffer } from "@/lib/clawfleet/photo";
import { userBranchIds } from "@/lib/clawfleet/role-guard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PHASES = [
  "meter_before",
  "cash",
  "meter_after",
  "stock",
  "prize_meter",
  "stock_after",
] as const;
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

  // 🛡️ Branch + lock authorization (anti-cheat evidence integrity)
  // client ส่ง eventScopeId = "{sessionId}-{machineId}" (ดู staff-app-client.tsx).
  // ดึง sessionId (uuid นำหน้า) ออกมาเพื่อยืนยันสิทธิ์สาขา + สถานะรอบก่อนรับรูป.
  // โหมดตัวอย่าง (demo) ไม่มี session จริง → ปล่อยผ่าน (ไม่ใช่หลักฐานจริง อยู่ในเครื่องลูกค้าเท่านั้น).
  const sessionId = eventScopeId.slice(0, 36); // uuid = 36 ตัวอักษร
  const isDemoScope = eventScopeId.startsWith("demo-");
  if (!isDemoScope) {
    const cfSession = await prisma.cfCollectionSession.findFirst({
      where: { id: sessionId, orgId: session.user.org_id },
      // แก้สาขาจาก branchId ตรง ๆ (staff collect flow) หรือ group.branchId (legacy)
      // ถ้าทั้งคู่ว่าง = ยืนยันเจ้าของไม่ได้ → ปฏิเสธ (ห้ามปล่อย session ที่ไร้สาขา)
      select: { status: true, branchId: true, group: { select: { branchId: true } } },
    });
    if (!cfSession) {
      return NextResponse.json(
        { error: "ไม่พบรอบเก็บเงินนี้ในระบบ" },
        { status: 403 },
      );
    }
    // (b) หลักฐานถูกแช่แข็งเมื่อรอบถูกล็อก → ห้ามอัปทับ/เพิ่มรูปหลังล็อก
    if (cfSession.status === "LOCKED") {
      return NextResponse.json(
        { error: "รอบนี้ถูกล็อกแล้ว · แก้ไข/แนบรูปหลักฐานเพิ่มไม่ได้" },
        { status: 403 },
      );
    }
    // (a) ต้องมีสิทธิ์เข้าถึงสาขาของรอบนี้ (แอดมิน/viewer = ALL, อื่น ๆ = สาขาที่สังกัด)
    const branchId = cfSession.branchId ?? cfSession.group?.branchId;
    if (!branchId) {
      return NextResponse.json(
        { error: "ไม่สามารถระบุสาขาของรอบนี้ได้" },
        { status: 403 },
      );
    }
    const allowed = await userBranchIds(session);
    if (allowed !== "ALL" && !allowed.includes(branchId)) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์แนบรูปให้สาขานี้" },
        { status: 403 },
      );
    }
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

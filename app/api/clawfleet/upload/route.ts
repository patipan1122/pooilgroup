// ClawFleet — photo upload endpoint
// Accepts multipart with: photo (Blob WebP/JPEG/PNG), orgId, machineCode, eventScopeId, phase
// Returns: { url, key, bytes }

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isSafeKeySegment, uploadEventPhoto, validateImageBuffer } from "@/lib/clawfleet/photo";
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
  // N1 baseline / N4 machine photo / N6 goods-receipt / N3 stock-count (bigfeature 2026-07-08)
  "machine",
  "money_meter_top",
  "money_meter_bottom",
  "doll_meter_top",
  "doll_meter_bottom",
  "baseline_stock",
  "goods_receipt",
  "stock_count",
  // เวิร์กช็อป 2026-08-29 · แนบสลิปฝากเงินจากหน้าประวัติเก็บเงิน (แทน hack เดิมที่ใช้ phase "cash")
  "deposit_slip",
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
  // 🛡️ path-safety: eventScopeId ถูกฝังลง object key + ใช้ resolve session/สิทธิ์ด้านล่าง →
  // ปฏิเสธค่าที่มี "/" หรือ ".." (path traversal) ตรงๆ. orgId ตรวจแล้วว่า == session.user.org_id.
  // machineCode ไม่ reject ตรงนี้ (2026-08-15 · เจอ 17/239 ตู้ใช้ชื่อภาษาไทย/มีวรรคเป็น code
  // เช่น "711 ลำทะเมนชัย" → เดิมโดนบล็อกอัปรูปถาวรทุกครั้ง) — ใช้แค่จัดโฟลเดอร์ R2 ให้อ่านง่าย
  // ไม่ผูกกับ auth/lookup ใดๆ → sanitizeKeySegment ใน photoKey() จัดการให้ปลอดภัยแทน
  if (!isSafeKeySegment(eventScopeId)) {
    return NextResponse.json({ error: "invalid field format" }, { status: 400 });
  }

  // 🛡️ Branch + lock authorization (anti-cheat evidence integrity)
  // client ส่ง eventScopeId = "{sessionId}-{machineId}" (ดู staff-app-client.tsx).
  // ⚠️ ห้ามเชื่อ prefix "demo-" จาก client เพื่อข้ามการตรวจ (client แก้ค่าได้ = bypass สิทธิ์).
  // ตัดสินจาก "server state" แทน: ถ้า sessionId ที่ดึงมาเป็น uuid จริงและ resolve เป็นรอบจริง
  // → บังคับสิทธิ์สาขา + สถานะล็อก. ถ้าไม่ใช่ uuid (โหมดตัวอย่าง/ค่าที่ปลอมมา) → ปล่อยผ่านได้
  // เพราะคีย์รูปสุ่ม+เส้นทางแยก (photo.ts) ทับหลักฐานของจริงไม่ได้ และไม่ผูกกับ event จริง = ไม่มีผล.
  const sessionId = eventScopeId.slice(0, 36); // uuid = 36 ตัวอักษร
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
  if (isUuid) {
    const cfSession = await prisma.cfCollectionSession.findFirst({
      where: { id: sessionId, orgId: session.user.org_id },
      select: { status: true, branchId: true, group: { select: { branchId: true } } },
    });
    // resolve เป็นรอบจริง → บังคับสิทธิ์ (ไม่ resolve = uuid ที่ไม่มีจริง → ไม่มีผล ปล่อยได้)
    if (cfSession) {
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
  } else if (eventScopeId.startsWith("attach-")) {
    // แนบรูปเพิ่มทีหลัง (attachEventPhotos flow) — eventScopeId = "attach-{eventId}".
    // (fix 2026-07-20: เดิม slice(0,36) ของ "attach-…" ไม่ใช่ uuid → isUuid=false → ข้ามด่าน
    //  LOCKED/สิทธิ์ทั้งบล็อก → อัปรูปเข้ารอบที่ล็อกแล้วได้). resolve event → session แล้ว
    //  บังคับล็อก+สิทธิ์สาขาเหมือน path ปกติ.
    const eventId = eventScopeId.slice("attach-".length);
    const isEventUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
    if (isEventUuid) {
      const ev = await prisma.cfCollectionEvent.findFirst({
        where: { id: eventId, orgId: session.user.org_id },
        select: {
          session: { select: { status: true } },
          machine: { select: { branchId: true } },
        },
      });
      if (ev) {
        if (ev.session?.status === "LOCKED") {
          return NextResponse.json(
            { error: "รอบนี้ถูกล็อกแล้ว · แนบรูปหลักฐานเพิ่มไม่ได้" },
            { status: 403 },
          );
        }
        const allowed = await userBranchIds(session);
        if (allowed !== "ALL" && !allowed.includes(ev.machine.branchId)) {
          return NextResponse.json(
            { error: "ไม่มีสิทธิ์แนบรูปให้สาขานี้" },
            { status: 403 },
          );
        }
      }
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

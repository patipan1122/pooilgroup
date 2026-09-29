// Public face register API (called from mobile web · no auth)
// Creates a Member (type=GUEST) + face_id · attaches to booking if provided

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newMemberCode } from "@/lib/playland/codes";
import { getAdapter } from "@/lib/playland/acs/mock-adapter";
import { decodePhotoDataUrl, isValidThaiPhone } from "@/lib/playland/guards";
import { checkRate, getClientIp } from "@/lib/playland/rate-limit";
import { putObject } from "@/lib/r2/upload";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  branchId: string;
  bookingId?: string;
  name: string;
  phone: string;
  photoDataUrl: string;
  consent: boolean;
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 face-registers per IP per 10 minutes
  const ip = getClientIp(req);
  const rl = checkRate(`pl:public:face:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `เกิน rate limit · ลองใหม่ใน ${Math.ceil(rl.retryAfterMs / 1000)} วินาที` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!b.consent) return NextResponse.json({ ok: false, error: "must consent" }, { status: 400 });
  if (!b.name || !b.phone || !b.photoDataUrl) return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  if (!isValidThaiPhone(b.phone)) return NextResponse.json({ ok: false, error: "bad phone" }, { status: 400 });
  if (b.name.length > 100) return NextResponse.json({ ok: false, error: "name too long" }, { status: 400 });

  // Verify photo size (≤ 2MB decoded)
  let photoBuf: Buffer;
  try { photoBuf = decodePhotoDataUrl(b.photoDataUrl, 2_000_000); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "bad photo" }, { status: 400 }); }

  const branch = await prisma.playlandBranch.findFirst({ where: { id: b.branchId, active: true } });
  if (!branch) return NextResponse.json({ ok: false, error: "branch" }, { status: 404 });

  // Verify booking belongs to this branch (prevent cross-branch attachment)
  if (b.bookingId) {
    const existsInBranch = await prisma.playlandBooking.findFirst({ where: { id: b.bookingId, branchId: branch.id }, select: { id: true } });
    if (!existsInBranch) return NextResponse.json({ ok: false, error: "booking not in branch" }, { status: 400 });
  }

  // Look up existing member by phone (avoid duplicates)
  let member = await prisma.playlandMember.findFirst({
    where: { orgId: branch.orgId, branchId: branch.id, phone: b.phone, deletedAt: null },
  });
  if (!member) {
    member = await prisma.playlandMember.create({
      data: {
        orgId: branch.orgId,
        branchId: branch.id,
        memberCode: newMemberCode(),
        type: "GUEST",
        name: b.name,
        phone: b.phone,
        consentAt: new Date(),
        retentionUntil: new Date(Date.now() + 365 * 24 * 60 * 60_000),
      },
    });
  }

  // Persist the photo to R2 first — real (acs-auto) devices are LAN-only and
  // get synced asynchronously by the shop-floor agent, so this HTTP request's
  // buffer won't exist anymore by the time that happens. See
  // app/api/playland/acs/agent/face-sync/route.ts for the pickup side.
  const photoKey = `playland/faces/${branch.orgId}/${member.id}/${crypto.randomUUID()}.jpg`;
  await putObject(photoKey, photoBuf, "image/jpeg");
  await prisma.playlandMember.update({ where: { id: member.id }, data: { photoR2Path: photoKey } });

  const devices = await prisma.playlandDevice.findMany({ where: { branchId: branch.id, status: { not: "DISABLED" } } });
  // Real hardware's memberId-as-faceId convention always wins over a mock
  // device's fabricated id — a branch with both (e.g. leftover demo device
  // sitting alongside real ones) must not let the mock id shadow the real sync.
  const hasRealDevice = devices.some((d) => d.vendor !== "mock");
  let faceId: string | null = null;
  for (const device of devices) {
    if (device.vendor === "mock") {
      if (hasRealDevice) continue;
      // Mock devices answer synchronously in-process — no LAN/agent involved.
      try {
        const adapter = getAdapter(device.vendor);
        const res = await adapter.registerFace(
          { memberId: member.id, photo: photoBuf },
          {
            id: device.id,
            deviceId: device.deviceId,
            baseUrl: device.baseUrl,
            protocol: device.protocol as "http" | "tcp",
            modelVersion: device.modelVersion as "B" | "C",
            webhookSecret: device.webhookSecret ?? "",
          },
        );
        faceId = res.faceId;
      } catch (e) {
        console.warn("[playland/public/register-face] mock adapter error", e);
      }
      continue;
    }
    // Real hardware (acs-auto): Vercel can't reach the device's private LAN
    // IP directly (NAT). Queue it — the shop-floor agent polls PlaylandFaceSync
    // and pushes the face over the device's local HTTP API.
    await prisma.playlandFaceSync.upsert({
      where: { deviceId_memberId: { deviceId: device.id, memberId: member.id } },
      create: { orgId: branch.orgId, deviceId: device.id, memberId: member.id, status: "PENDING" },
      update: { status: "PENDING", attempts: 0, errorMessage: null },
    });
    // acs-auto convention: memberId IS the face_id (device never returns one) ·
    // no need to wait for the agent round-trip to know it.
    faceId = member.id;
  }
  if (!faceId) {
    // No devices configured for this branch yet — mock-mode fallback so the flow still works
    faceId = `MOCK-${member.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  }
  await prisma.playlandMember.update({ where: { id: member.id }, data: { faceId } });

  // Link to booking if provided
  if (b.bookingId) {
    await prisma.playlandBooking.update({ where: { id: b.bookingId }, data: { memberId: member.id } });
  }

  return NextResponse.json({ ok: true, memberId: member.id, faceId });
}

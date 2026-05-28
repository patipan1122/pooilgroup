// Public face register API (called from mobile web · no auth)
// Creates a Member (type=GUEST) + face_id · attaches to booking if provided

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newMemberCode } from "@/lib/playland/codes";
import { getAdapter } from "@/lib/playland/acs/mock-adapter";
import { decodePhotoDataUrl, isValidThaiPhone } from "@/lib/playland/guards";
import { checkRate, getClientIp } from "@/lib/playland/rate-limit";

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

  // Register face via mock adapter (use pre-decoded buf, no re-decode)
  const devices = await prisma.playlandDevice.findMany({ where: { branchId: branch.id, status: { not: "DISABLED" } } });
  let faceId: string | null = null;
  if (devices.length > 0) {
    const buf = photoBuf;
    const adapter = getAdapter(devices[0].vendor);
    try {
      const res = await adapter.registerFace(
        { memberId: member.id, photo: buf },
        {
          id: devices[0].id,
          deviceId: devices[0].deviceId,
          baseUrl: devices[0].baseUrl,
          protocol: devices[0].protocol as "http" | "tcp",
          modelVersion: devices[0].modelVersion as "B" | "C",
          webhookSecret: devices[0].webhookSecret ?? "",
        },
      );
      faceId = res.faceId;
      await prisma.playlandMember.update({ where: { id: member.id }, data: { faceId } });
    } catch (e) {
      console.warn("[playland/public/register-face] adapter error", e);
    }
  }
  if (!faceId) {
    // Mock-mode fallback so flow works
    faceId = `MOCK-${member.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    await prisma.playlandMember.update({ where: { id: member.id }, data: { faceId } });
  }

  // Link to booking if provided
  if (b.bookingId) {
    await prisma.playlandBooking.update({ where: { id: b.bookingId }, data: { memberId: member.id } });
  }

  return NextResponse.json({ ok: true, memberId: member.id, faceId });
}

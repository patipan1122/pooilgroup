// Playland · shop-floor agent poll — "what faces do I need to push to this device?"
//
// Why this exists: ACS-F606 devices sit on a private shop LAN. Vercel can't
// reach them directly (NAT), so `lib/playland/acs/acs-auto-adapter.ts`'s
// registerFace/deleteFace can't be called straight from a server action for
// real hardware. Instead, app/api/playland/public/register-face/route.ts
// (and future delete flows) write a row into the existing PlaylandFaceSync
// queue, and a small Node agent running on the shop PC — same LAN as the
// device — polls this endpoint, then pushes the face over the device's local
// HTTP API (port 8091) and reports back via ./result.
//
// Auth: shared secret in the URL query, same pattern as the device webhook
// (/api/playland/acs/event) — the agent is a simple LAN script, no HMAC.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/r2/upload";
import { wristbandGateNumber } from "@/lib/playland/wristband-code";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_JOBS_PER_POLL = 5;
const RETRY_LEASE_MS = 30_000; // don't redeliver a job attempted more recently than this

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const deviceCode = url.searchParams.get("device");
  const providedSecret = url.searchParams.get("secret") ?? "";

  if (!deviceCode) {
    return NextResponse.json({ ok: false, error: "missing device" }, { status: 400 });
  }

  const device = await prisma.playlandDevice.findFirst({ where: { deviceId: deviceCode } });
  if (!device) {
    return NextResponse.json({ ok: false, error: "device not registered" }, { status: 404 });
  }
  if (device.webhookSecret && providedSecret !== device.webhookSecret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const leaseCutoff = new Date(Date.now() - RETRY_LEASE_MS);
  const jobs = await prisma.playlandFaceSync.findMany({
    where: {
      deviceId: device.id,
      status: { in: ["PENDING", "DELETE_PENDING"] },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: leaseCutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_JOBS_PER_POLL,
    include: { member: { select: { id: true, name: true, photoR2Path: true } } },
  });

  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, jobs: [] });
  }

  // Mark as attempted so a rapid re-poll doesn't redeliver the same job while
  // this one is still in flight (single agent per branch in practice, so a
  // full claim-transaction isn't worth it here — a 30s lease is enough).
  await prisma.playlandFaceSync.updateMany({
    where: { id: { in: jobs.map((j) => j.id) } },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });

  const payload = await Promise.all(
    jobs.map(async (job) => {
      const isDelete = job.status === "DELETE_PENDING";

      // สมาชิกที่ถือสายรัดเลข 10 หลัก (เซสชันยังไม่จบ) → ลงรายชื่อแบบ "เลขบัตร" ไม่ต้องใช้รูปหน้า
      // (ถ้าไม่มีสายรัดแบบนี้ = สมาชิกเลือกสแกนหน้า → เดินทางเดิมด้วยรูปหน้า)
      let icno: string | null = null;
      if (!isDelete) {
        const wb = await prisma.playlandWristband.findFirst({
          where: {
            memberId: job.member.id,
            status: { in: ["ISSUED", "ACTIVE"] },
            code: { startsWith: "PW-" },
            session: { status: { in: ["PENDING_ENTRY", "ACTIVE", "PAUSED"] } },
          },
          orderBy: { createdAt: "desc" },
          select: { code: true },
        });
        icno = wb ? wristbandGateNumber(wb.code) : null;
      }

      let photoBase64: string | null = null;
      if (!isDelete && !icno && job.member.photoR2Path) {
        try {
          photoBase64 = (await getObject(job.member.photoR2Path)).toString("base64");
        } catch (e) {
          console.error("[agent/face-sync] R2 read failed", job.member.photoR2Path, e);
        }
      }
      return {
        jobId: job.id,
        type: isDelete ? "DELETE" : "REGISTER",
        memberId: job.member.id,
        name: job.member.name,
        photoBase64,
        icno,
      };
    }),
  );

  return NextResponse.json({ ok: true, jobs: payload });
}

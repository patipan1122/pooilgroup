// Playland · shop-floor agent reports back the outcome of a face-sync job
// (see ../route.ts for why this exists).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  device: string;
  secret?: string;
  jobId: string;
  type: "REGISTER" | "DELETE";
  ok: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  let b: Body;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!b.device || !b.jobId || !b.type) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const device = await prisma.playlandDevice.findFirst({ where: { deviceId: b.device } });
  if (!device) {
    return NextResponse.json({ ok: false, error: "device not registered" }, { status: 404 });
  }
  if (device.webhookSecret && b.secret !== device.webhookSecret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  const job = await prisma.playlandFaceSync.findFirst({ where: { id: b.jobId, deviceId: device.id } });
  if (!job) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }

  await prisma.playlandFaceSync.update({
    where: { id: job.id },
    data: b.ok
      ? { status: b.type === "DELETE" ? "DELETED" : "SYNCED", syncedAt: new Date(), errorMessage: null }
      : { status: "FAILED", errorMessage: b.error?.slice(0, 500) ?? "unknown error" },
  });

  // Keep PlaylandDevice.lastSeenAt fresh — the agent talking to us proves the
  // bridge (and by extension the device it's fronting) is alive.
  await prisma.playlandDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

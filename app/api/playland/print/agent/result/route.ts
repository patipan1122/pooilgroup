// Playland · agent รายงานผลพิมพ์ {jobId, ok, error?} · อัปเดตได้เฉพาะงานของเครื่องตัวเองที่อยู่ระหว่าง PRINTING

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticatePrinter } from "@/lib/playland/printer-agent-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authenticatePrinter(req);
  if ("error" in auth) return auth.error;
  const { printer } = auth;

  let body: { jobId?: unknown; ok?: unknown; error?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (typeof body.jobId !== "string" || typeof body.ok !== "boolean") {
    return NextResponse.json({ ok: false, error: "jobId/ok required" }, { status: 400 });
  }

  const now = new Date();
  const res = await prisma.playlandPrintJob.updateMany({
    where: { id: body.jobId, printerId: printer.id, status: "PRINTING" },
    data: body.ok
      ? { status: "DONE", printedAt: now, errorMessage: null }
      : { status: "FAILED", errorMessage: String(body.error ?? "unknown error").slice(0, 500) },
  });
  return NextResponse.json({ ok: true, updated: res.count });
}

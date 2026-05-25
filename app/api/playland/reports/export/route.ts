import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const url = new URL(req.url);
  const branchId = url.searchParams.get("branch") || undefined;
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();

  const sessions = await prisma.playlandSession.findMany({
    where: { orgId, branchId, checkInAt: { gte: from, lte: to } },
    include: { member: true, package: true, branch: true },
    orderBy: { checkInAt: "desc" },
  });

  const rows: string[] = ["ประเภท,วันที่,เวลา,สาขา,ลูกค้า,Member Code,Type,Package,ราคา,สถานะ"];
  for (const s of sessions) {
    rows.push(
      [
        "session",
        s.checkInAt.toISOString().slice(0, 10),
        s.checkInAt.toISOString().slice(11, 19),
        s.branch.name,
        s.member.name,
        s.member.memberCode ?? "",
        s.member.type,
        s.package?.name ?? "",
        (s.packagePriceCents / 100).toFixed(2),
        s.status,
      ].map(csvCell).join(","),
    );
  }

  const sales = await prisma.playlandSale.findMany({
    where: { orgId, branchId, soldAt: { gte: from, lte: to }, voidedAt: null },
    include: { branch: true, lines: true },
    orderBy: { soldAt: "desc" },
  });

  for (const s of sales) {
    rows.push(
      [
        "sale",
        s.soldAt.toISOString().slice(0, 10),
        s.soldAt.toISOString().slice(11, 19),
        s.branch.name,
        s.saleCode,
        "",
        "",
        s.lines.map((l) => `${l.productName} x${l.quantity}`).join("; "),
        (s.totalCents / 100).toFixed(2),
        s.paymentMethod,
      ].map(csvCell).join(","),
    );
  }

  // Prepend BOM for Excel UTF-8
  const body = "﻿" + rows.join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="playland-report-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}

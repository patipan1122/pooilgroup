// Bulk-add chairs to a branch. CEO 2026-05-30: branch-collect picker
// showed 29/30 branches with 0 chairs and there was no admin UI to fix that.
// Tiny standalone page — paste codes (one per line OR comma-separated),
// submit, see how many were inserted vs skipped.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { AddChairsForm } from "./form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ branchId: string }>;
}

export default async function AddChairsPage({ params }: Props) {
  const session = await requireRole("OFFICE");
  const { branchId } = await params;

  const branch = await prisma.chairopsBranch.findFirst({
    where: { id: branchId, orgId: session.user.orgId },
    select: {
      id: true,
      name: true,
      city: true,
      _count: { select: { chairs: { where: { isActive: true } } } },
    },
  });
  if (!branch) notFound();

  const existing = await prisma.chairopsChair.findMany({
    where: { branchId: branch.id, isActive: true },
    orderBy: { chairCode: "asc" },
    select: { chairCode: true },
    take: 200,
  });

  return (
    <div className="chairops-scope max-w-2xl space-y-4 p-4">
      <Link
        href="/chairops/branch-collect"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับเลือกสาขา
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">
          จัดการสาขา · เพิ่มเก้าอี้
        </p>
        <h1 className="text-xl font-bold text-zinc-900">
          เพิ่มเก้าอี้ที่ {branch.name}
        </h1>
        <p className="text-sm text-zinc-500">
          {branch.city ?? "—"} · มีอยู่ {branch._count.chairs} ตัว
        </p>
      </header>

      {existing.length > 0 && (
        <Card>
          <CardBody className="space-y-2 p-4">
            <div className="text-xs text-zinc-500">เก้าอี้ที่มีอยู่</div>
            <div className="flex flex-wrap gap-1.5">
              {existing.map((c) => (
                <span
                  key={c.chairCode}
                  className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700"
                >
                  {c.chairCode}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <AddChairsForm branchId={branch.id} />
    </div>
  );
}

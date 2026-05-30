// Maid collection detail · /chairops/m/collect/[id]
// Shows: lock state · counted/deposited/diff · photo (click to lightbox) ·
// unlock button (only if OFFICE+ — usually no for maid, but layout supports it)
//
// W6 spec: photo lightbox is inline (no Drawer dep) · single-tap to enlarge.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireExactRole } from "@/lib/chairops/auth/session";
import {
  canSeeBranch,
  canUnlockCollection,
} from "@/lib/chairops/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { baht, thaiDateTime } from "@/lib/chairops/utils/format";
import { ChevronLeft, Landmark, Lock, Unlock } from "lucide-react";
import { UnlockButton } from "@/app/(admin)/chairops/collect/[id]/unlock-button";
import { PhotoLightbox } from "./photo-lightbox";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MaidCollectDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requireExactRole("MAID");

  const row = await prisma.chairopsCashCollection.findUnique({
    where: { id },
    include: {
      branch: { select: { name: true } },
      maid: { select: { displayName: true } },
      deposit: {
        select: {
          id: true,
          depositedAt: true,
          depositedAmount: true,
          bankFee: true,
          slipPhotoUrl: true,
        },
      },
    },
  });
  if (!row) notFound();

  if (!canSeeBranch(session.user, row.branchId)) {
    redirect("/chairops/m?error=forbidden");
  }

  const lockUntil = new Date(row.createdAt.getTime() + 30 * 60_000);
  const now = new Date();
  const isLocked = !row.unlockedAt && now < lockUntil;
  const minutesLeft = Math.max(
    0,
    Math.ceil((lockUntil.getTime() - now.getTime()) / 60_000),
  );
  const isPendingDeposit = row.depositId === null;
  const canUnlock = canUnlockCollection(session.user);

  // chair_breakdown JSON shape — defensive parsing because legacy rows may
  // have null or arbitrary shapes.
  type ChairLine = {
    chairCode: string;
    status: "collected" | "broken" | "empty" | "skipped";
    amount: number;
    reason?: string | null;
    photoUrl?: string | null;
  };
  const lines: ChairLine[] = Array.isArray(
    (row.chairBreakdown as { lines?: unknown } | null)?.lines,
  )
    ? ((row.chairBreakdown as { lines: ChairLine[] }).lines ?? [])
    : [];

  return (
    <div className="space-y-4">
      <Link
        href="/chairops/m"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden /> กลับหน้าหลัก
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">รายการเก็บเงิน</h1>
        <p className="text-sm text-zinc-500">{thaiDateTime(row.collectedAt)}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {isPendingDeposit ? (
          <Badge tone="warning" className="gap-1">
            <Landmark className="h-3 w-3" aria-hidden /> ยังไม่ฝาก
          </Badge>
        ) : (
          <Badge tone="success" className="gap-1">
            <Landmark className="h-3 w-3" aria-hidden /> ฝากแล้ว
          </Badge>
        )}
        {isLocked ? (
          <Badge tone="neutral" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden /> ล็อค · แก้ไขไม่ได้
          </Badge>
        ) : row.unlockedAt ? (
          <Badge tone="warning" className="gap-1">
            <Unlock className="h-3 w-3" aria-hidden /> ออฟฟิศปลดล็อกแล้ว
          </Badge>
        ) : (
          <Badge tone="success">
            ยังแก้ไขได้ · เหลือ {minutesLeft} นาที
          </Badge>
        )}
      </div>

      {isPendingDeposit && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardBody className="space-y-3 p-4">
            <div className="text-sm font-semibold text-emerald-800">
              ยอดนับ {baht(row.countedAmount)} · ยังไม่ฝาก
            </div>
            <p className="text-xs text-emerald-700">
              ฝากเงินก้อนรวมหลายรอบได้ที่หน้า &ldquo;เลือกรอบฝาก&rdquo; (ประหยัดค่าธรรมเนียม)
            </p>
            <Link href="/chairops/m/deposit" className="block">
              <Button className="h-14 w-full text-base font-semibold">
                <Landmark className="mr-2 h-5 w-5" /> ไปฝากเงินก้อน
              </Button>
            </Link>
          </CardBody>
        </Card>
      )}

      {!isPendingDeposit && row.deposit && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardBody className="space-y-1 p-4 text-sm text-emerald-800">
            <div className="font-semibold">
              ฝากแล้ว · {baht(row.deposit.depositedAmount)}
            </div>
            <div className="text-xs text-emerald-700">
              {thaiDateTime(row.deposit.depositedAt)}
              {row.deposit.bankFee > 0
                ? ` · ค่าธรรมเนียม ${baht(row.deposit.bankFee)}`
                : ""}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-3 p-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-zinc-500">ยอดที่นับรวม</div>
              <div className="text-lg font-semibold tabular-nums text-zinc-900">
                {baht(row.countedAmount)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">จำนวนเก้าอี้</div>
              <div className="text-lg font-semibold tabular-nums text-zinc-900">
                {lines.length === 0 ? "—" : `${lines.length} ตัว`}
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-500">
            <div>
              สาขา:{" "}
              <span className="font-medium text-zinc-800">{row.branch.name}</span>
            </div>
            <div>
              แม่บ้าน:{" "}
              <span className="font-medium text-zinc-800">
                {row.maid.displayName}
              </span>
            </div>
            <div>
              บันทึกเมื่อ:{" "}
              <span className="font-medium text-zinc-800">
                {thaiDateTime(row.createdAt)}
              </span>
            </div>
          </div>
          {row.notes && (
            <div className="border-t border-zinc-200 pt-3">
              <div className="text-xs text-zinc-500">หมายเหตุ</div>
              <p className="whitespace-pre-wrap text-zinc-800">{row.notes}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Per-chair breakdown — populated for rows written with the new
          chair-checklist form. Legacy rows fall through with lines.length=0
          and we just hide this card. */}
      {lines.length > 0 && (
        <Card>
          <CardBody className="space-y-3 p-4">
            <div className="text-sm font-semibold text-zinc-800">
              รายเก้าอี้ ({lines.length} ตัว)
            </div>
            <ul className="space-y-2">
              {lines.map((line) => {
                const isProblem = line.status !== "collected";
                return (
                  <li
                    key={line.chairCode}
                    className={
                      "rounded-lg border p-3 " +
                      (isProblem
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-zinc-200")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 min-w-[56px] place-items-center rounded-md bg-zinc-100 px-2 font-mono text-xs font-semibold text-zinc-900">
                        {line.chairCode}
                      </span>
                      <div className="min-w-0 grow">
                        {isProblem ? (
                          <div className="text-sm font-medium text-amber-700">
                            ⚠ {line.reason ?? line.status}
                          </div>
                        ) : (
                          <div className="text-base font-semibold tabular-nums text-zinc-900">
                            {baht(line.amount)}
                          </div>
                        )}
                      </div>
                    </div>
                    {isProblem && line.photoUrl && (
                      <div className="mt-2">
                        <PhotoLightbox
                          url={line.photoUrl}
                          alt={`รูปเก้าอี้ ${line.chairCode}`}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Legacy rollup photo — only shown when present (new flow may submit
          without). Slip photo lives on ChairopsCashDeposit now, but legacy
          rows kept their slip on the collection itself. */}
      {(row.evidencePhotoUrl || row.slipPhotoUrl) && (
        <Card>
          <CardBody className="space-y-2 p-4">
            {row.evidencePhotoUrl && (
              <>
                <div className="text-sm font-semibold text-zinc-800">
                  รูปหลักฐาน
                </div>
                <PhotoLightbox
                  url={row.evidencePhotoUrl}
                  alt="หลักฐานเงินสด"
                />
              </>
            )}
            {row.slipPhotoUrl && (
              <>
                <div className="pt-2 text-sm font-semibold text-zinc-800">
                  สลิปธนาคาร (legacy)
                </div>
                <PhotoLightbox url={row.slipPhotoUrl} alt="สลิปธนาคาร" />
              </>
            )}
          </CardBody>
        </Card>
      )}

      {isLocked && (
        <Card className="border-zinc-200">
          <CardBody className="space-y-3 p-4 text-sm text-zinc-600">
            <p>
              รายการนี้อยู่ในช่วง 30 นาทีหลังบันทึก ·
              ระบบล็อคไม่ให้แก้ไขเพื่อความปลอดภัย (เหลือ {minutesLeft} นาที)
            </p>
            {canUnlock ? (
              <UnlockButton id={row.id} />
            ) : (
              <p className="text-xs">
                ถ้าต้องแก้ไข · ให้ออฟฟิศหรือผู้จัดการเป็นคนปลดล็อก
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {row.unlockedAt && (
        <Card className="border-amber-200 bg-amber-50">
          <CardBody className="p-3 text-xs text-amber-800">
            ออฟฟิศปลดล็อกเมื่อ {thaiDateTime(row.unlockedAt)} ·
            บันทึกการแก้ไขถูกเก็บใน audit log
          </CardBody>
        </Card>
      )}

      <Link href="/chairops/m" className="block">
        <Button variant="outline" className="h-12 w-full">
          กลับหน้าหลัก
        </Button>
      </Link>
    </div>
  );
}

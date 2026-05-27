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
import { ChevronLeft, Lock, Unlock } from "lucide-react";
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
  const diff = row.countedAmount - row.depositedAmount;
  const canUnlock = canUnlockCollection(session.user);

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

      <div className="flex items-center gap-2">
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

      <Card>
        <CardBody className="space-y-3 p-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-zinc-500">ยอดที่นับ</div>
              <div className="text-lg font-semibold tabular-nums text-zinc-900">
                {baht(row.countedAmount)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">ยอดฝาก</div>
              <div className="text-lg font-semibold tabular-nums text-zinc-900">
                {baht(row.depositedAmount)}
              </div>
            </div>
            <div className="col-span-2 border-t border-zinc-200 pt-3">
              <div className="text-xs text-zinc-500">ผลต่าง</div>
              <div
                className={
                  "text-xl font-bold tabular-nums " +
                  (diff > 0
                    ? "text-amber-700"
                    : diff < 0
                      ? "text-emerald-700"
                      : "text-zinc-900")
                }
              >
                {baht(diff, true)}
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

      <Card>
        <CardBody className="space-y-2 p-4">
          <div className="text-sm font-semibold text-zinc-800">รูปหลักฐาน</div>
          <PhotoLightbox
            url={row.evidencePhotoUrl}
            alt="หลักฐานเงินสด/สลิป"
          />
          {row.slipPhotoUrl && (
            <>
              <div className="pt-2 text-sm font-semibold text-zinc-800">
                สลิปธนาคาร
              </div>
              <PhotoLightbox url={row.slipPhotoUrl} alt="สลิปธนาคาร" />
            </>
          )}
        </CardBody>
      </Card>

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

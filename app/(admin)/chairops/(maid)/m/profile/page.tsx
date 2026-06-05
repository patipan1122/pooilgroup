import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { MapPin, Phone, User, Users } from "lucide-react";
import { MaidLogoutButton } from "./logout-button";
import { ProfileEditWrapper } from "./profile-edit-wrapper";

export const dynamic = "force-dynamic";

export default async function MaidProfilePage() {
  const session = await requireExactRole("MAID");

  const user = await prisma.chairopsUser.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      displayName: true,
      mobilePhone: true,
      emergencyContact: true,
      emergencyPhone: true,
      currentMainEmployer: true,
      primaryBranchId: true,
      secondaryBranchId: true,
    },
  });

  const [primaryBranch, secondaryBranch] = await Promise.all([
    user.primaryBranchId
      ? prisma.chairopsBranch.findUnique({
          where: { id: user.primaryBranchId },
          select: { name: true },
        })
      : null,
    user.secondaryBranchId
      ? prisma.chairopsBranch.findUnique({
          where: { id: user.secondaryBranchId },
          select: { name: true },
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">บัญชีของฉัน</h1>
        <p className="text-sm text-zinc-500">ข้อมูลส่วนตัวและการออกจากระบบ</p>
      </header>

      <ProfileEditWrapper
        defaultValues={{
          displayName: user.displayName,
          mobilePhone: user.mobilePhone,
          emergencyContact: user.emergencyContact,
          emergencyPhone: user.emergencyPhone,
          currentMainEmployer: user.currentMainEmployer,
        }}
      >
        <Card>
          <CardBody className="space-y-3 p-4 text-sm">
            <Row icon={<User className="h-5 w-5 text-zinc-400" />} label="ชื่อ-นามสกุล" value={user.displayName} />
            <Row icon={<Phone className="h-5 w-5 text-zinc-400" />} label="เบอร์มือถือ" value={user.mobilePhone ?? "—"} />
            {user.emergencyContact && (
              <Row
                icon={<Phone className="h-5 w-5 text-zinc-400" />}
                label="ผู้ติดต่อฉุกเฉิน"
                value={`${user.emergencyContact}${user.emergencyPhone ? ` · ${user.emergencyPhone}` : ""}`}
              />
            )}
            {user.currentMainEmployer && (
              <Row icon={<Users className="h-5 w-5 text-zinc-400" />} label="งานประจำ" value={user.currentMainEmployer} />
            )}
            <div className="border-t border-zinc-100 pt-3 space-y-2">
              <Row
                icon={<MapPin className="h-5 w-5 text-zinc-400" />}
                label="สาขาหลัก"
                value={primaryBranch?.name ?? "ยังไม่ผูกสาขา"}
              />
              {secondaryBranch && (
                <Row
                  icon={<MapPin className="h-5 w-5 text-amber-400" />}
                  label="สาขาสำรอง (Cover)"
                  value={secondaryBranch.name}
                />
              )}
            </div>
          </CardBody>
        </Card>
      </ProfileEditWrapper>

      <MaidLogoutButton />

      <p className="text-center text-xs text-zinc-400">
        ChairOps · เวอร์ชันแม่บ้าน
      </p>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="font-medium text-zinc-900">{value}</div>
      </div>
    </div>
  );
}

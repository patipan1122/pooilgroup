import { requireExactRole } from "@/lib/chairops/auth/session";
import { getMaidActiveBranches } from "@/lib/chairops/auth/branch-scope";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { MapPin, Phone, Star, User, Users } from "lucide-react";
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
      // NOTE: this is the TRUE home (direct DB read, not the session-overloaded
      // active branch) — used to mark ⭐ สาขาหลัก in the branch list below.
      primaryBranchId: true,
    },
  });

  // multi-branch (CEO 2026-07-08): show every branch she manages.
  const branches = await getMaidActiveBranches(session.user.id);

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
            <div className="border-t border-zinc-100 space-y-2 pt-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <MapPin className="h-5 w-5 text-zinc-400" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-zinc-500">
                    สาขาที่ดูแล ({branches.length})
                  </div>
                  {branches.length === 0 ? (
                    <div className="font-medium text-zinc-900">ยังไม่ผูกสาขา</div>
                  ) : (
                    <ul className="mt-0.5 space-y-1">
                      {branches.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center gap-1.5 font-medium text-zinc-900"
                        >
                          {b.name}
                          {b.id === user.primaryBranchId && (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-700">
                              <Star className="size-2.5 fill-amber-400 text-amber-500" />
                              หลัก
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
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

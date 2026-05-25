// Maid profile · single safe place to logout (was bottom-nav 4th slot in
// legacy MaidShell · moved here per UX §4.4 mis-tap fix).
//
// TODO[claude-design]: add "change PIN" + "view assigned branch" rows
// when MAID-profile schema lands (Wave 2).

import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/chairops/ui/card";
import { Button } from "@/components/chairops/ui/button";
import { LogOut, MapPin, User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MaidProfilePage() {
  const session = await requireExactRole("MAID");
  const branch = session.user.primaryBranchId
    ? await prisma.chairopsBranch.findUnique({
        where: { id: session.user.primaryBranchId },
        select: { name: true },
      })
    : null;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">บัญชีของฉัน</h1>
        <p className="text-sm text-zinc-500">ข้อมูลและการออกจากระบบ</p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="flex items-start gap-3">
            <User
              className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400"
              aria-hidden
            />
            <div>
              <div className="text-xs text-zinc-500">ชื่อแม่บ้าน</div>
              <div className="font-medium text-zinc-900">
                {session.user.displayName}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 border-t border-zinc-200 pt-3">
            <MapPin
              className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400"
              aria-hidden
            />
            <div>
              <div className="text-xs text-zinc-500">สาขาที่ทำงาน</div>
              <div className="font-medium text-zinc-900">
                {branch?.name ?? "ยังไม่ผูกสาขา"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <form action="/logout" method="POST">
        <Button
          type="submit"
          variant="outline"
          className="h-14 w-full text-base font-semibold text-rose-700 ring-rose-200 hover:bg-rose-50"
        >
          <LogOut className="mr-2 h-5 w-5" aria-hidden />
          ออกจากระบบ
        </Button>
      </form>

      <p className="text-center text-xs text-zinc-400">
        ChairOps · เวอร์ชันแม่บ้าน
      </p>
    </div>
  );
}

// Create new user — ADMIN only · server creates Supabase auth + Prisma profile
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { NewUserForm } from "./new-user-form";
import { canAssignRole } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

const ALL_ROLES: ChairopsUserRole[] = ["TECHNICIAN", "MAID", "OFFICE", "MANAGER", "CEO", "ADMIN"];

export default async function NewUserPage() {
  const session = await requireRole("ADMIN");

  // Only show roles the actor can actually assign (prevent UI confusion)
  const assignableRoles = ALL_ROLES.filter((r) => canAssignRole(session.user, r));

  const branches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/chairops/users" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการผู้ใช้
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">เพิ่มผู้ใช้ใหม่</h1>
        <p className="text-sm text-muted-foreground">
          ระบบจะสร้างบัญชี Supabase auth + profile · ระบบจะตั้งรหัสผ่านชั่วคราว · ผู้ใช้ต้อง reset ผ่าน /reset-password
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลผู้ใช้</CardTitle>
        </CardHeader>
        <CardContent>
          <NewUserForm assignableRoles={assignableRoles} branches={branches} />
        </CardContent>
      </Card>
    </div>
  );
}

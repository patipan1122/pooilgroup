// User list — ADMIN only (per security model)
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { thaiDate } from "@/lib/chairops/utils/format";
import { type Prisma } from "@/lib/generated/prisma/client";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

const ROLE_VARIANT: Record<ChairopsUserRole, "default" | "secondary" | "success" | "warning" | "danger"> = {
  ADMIN: "danger",
  CEO: "danger",
  MANAGER: "warning",
  OFFICE: "default",
  MAID: "secondary",
  TECHNICIAN: "secondary",
};

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; active?: string; q?: string }>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;

  const w: Prisma.ChairopsUserWhereInput = {};
  if (sp.role) w.role = sp.role as ChairopsUserRole;
  if (sp.active === "1") w.isActive = true;
  else if (sp.active === "0") w.isActive = false;
  if (sp.q) {
    w.OR = [
      { email: { contains: sp.q, mode: "insensitive" } },
      { displayName: { contains: sp.q, mode: "insensitive" } },
    ];
  }

  const users = await prisma.chairopsUser.findMany({
    where: w,
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { displayName: "asc" }],
    take: 500,
  });

  const branchIds = Array.from(
    new Set(users.map((u) => u.primaryBranchId).filter((id): id is string => !!id))
  );
  const branches = await prisma.chairopsBranch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  });
  const branchById = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ผู้ใช้งาน</h1>
          <p className="text-sm text-muted-foreground">ทั้งหมด {users.length} คน</p>
        </div>
        <Link href="/chairops/users/new">
          <Button>+ เพิ่มผู้ใช้</Button>
        </Link>
      </div>

      <Card>
        <div className="p-4">
          <form className="flex flex-wrap items-end gap-3 text-sm" method="GET">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground">ค้นหา</label>
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="อีเมล / ชื่อ"
                className="h-9 w-full rounded-md border border-border bg-background px-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">สิทธิ์</label>
              <select
                name="role"
                defaultValue={sp.role ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                <option value="">ทั้งหมด</option>
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">สถานะ</label>
              <select
                name="active"
                defaultValue={sp.active ?? ""}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                <option value="">ทั้งหมด</option>
                <option value="1">ใช้งาน</option>
                <option value="0">ปิด</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              ค้นหา
            </button>
            <Link
              href="/chairops/users"
              className="h-9 rounded-md border border-border px-4 text-sm font-medium leading-9 hover:bg-muted"
            >
              ล้าง
            </Link>
          </form>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-14 z-10 bg-muted/50 sm:top-16">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">ชื่อ</th>
                <th className="px-3 py-2 font-medium">อีเมล</th>
                <th className="px-3 py-2 font-medium">สิทธิ์</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2 font-medium">สร้างเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                    ไม่มีผู้ใช้
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className={
                      "border-t border-border hover:bg-muted/50 " +
                      (u.isActive ? "" : "opacity-50")
                    }
                  >
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/chairops/users/${u.id}`} className="text-primary hover:underline">
                        {u.displayName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {u.email ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={ROLE_VARIANT[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {u.primaryBranchId ? branchById.get(u.primaryBranchId) ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {u.isActive ? (
                        <Badge variant="success">ใช้งาน</Badge>
                      ) : (
                        <Badge variant="secondary">ปิด</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {thaiDate(u.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

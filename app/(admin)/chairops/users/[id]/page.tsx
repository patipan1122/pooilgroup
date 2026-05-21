// User detail · edit display name · change role (GUARDED) · assign branch · deactivate
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { Badge } from "@/components/chairops/ui/badge";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import { canAssignRole, canManageUser } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { UserDetailForm } from "./user-detail-form";

const ROLE_LABEL: Record<ChairopsUserRole, string> = {
  ADMIN: "แอดมิน",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  OFFICE: "ออฟฟิศ",
  MAID: "แม่บ้าน",
  TECHNICIAN: "ช่าง",
};

const ALL_ROLES: ChairopsUserRole[] = ["TECHNICIAN", "MAID", "OFFICE", "MANAGER", "CEO", "ADMIN"];

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("ADMIN");
  const { id } = await params;

  const target = await prisma.chairopsUser.findUnique({ where: { id } });
  if (!target) notFound();

  const [branches, recentAudit] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsAuditLog.findMany({
      where: { entity: "User", entityId: target.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  // GUARDED: assignable roles = roles actor can grant AND target is manageable
  const canManage = canManageUser(session.user, target);
  const assignableRoles = ALL_ROLES.filter((r) => canAssignRole(session.user, r));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/chairops/users" className="text-sm text-muted-foreground hover:underline">
            ← กลับรายการผู้ใช้
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{target.displayName}</h1>
          <p className="text-sm text-muted-foreground">{target.email ?? "—"}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={target.isActive ? "success" : "secondary"}>
            {target.isActive ? "ใช้งาน" : "ปิด"}
          </Badge>
          <Badge variant="outline">{ROLE_LABEL[target.role]}</Badge>
        </div>
      </div>

      {!canManage && (
        <Card>
          <CardContent className="p-4 text-sm text-warning">
            ⚠ คุณ ({session.user.role}) ไม่มีสิทธิ์แก้ไขผู้ใช้สิทธิ์ {ROLE_LABEL[target.role]} ·
            ดูได้อย่างเดียว
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <UserDetailForm
          target={{
            id: target.id,
            email: target.email,
            displayName: target.displayName,
            role: target.role,
            primaryBranchId: target.primaryBranchId,
            isActive: target.isActive,
          }}
          canManage={canManage}
          assignableRoles={assignableRoles}
          branches={branches}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลระบบ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="ID">
              <span className="font-mono text-xs">{target.id}</span>
            </Row>
            <Row label="Auth User ID">
              <span className="font-mono text-xs">{target.authUserId ?? "—"}</span>
            </Row>
            <Row label="LINE User ID">
              <span className="font-mono text-xs">{target.lineUserId ?? "—"}</span>
            </Row>
            <Row label="Phone">{target.phone ?? "—"}</Row>
            <Row label="สร้างเมื่อ">{thaiDateTime(target.createdAt)}</Row>
            <Row label="แก้ไขล่าสุด">{thaiDateTime(target.updatedAt)}</Row>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติการเปลี่ยนแปลง</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">เมื่อ</th>
                  <th className="py-2 font-medium">การกระทำ</th>
                  <th className="py-2 font-medium">โดย</th>
                  <th className="py-2 font-medium">เปลี่ยนแปลง</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 text-xs text-muted-foreground">
                      {thaiDateTime(a.createdAt)}
                    </td>
                    <td className="py-2 font-mono text-xs">{a.action}</td>
                    <td className="py-2 text-xs">{a.user?.displayName ?? "—"}</td>
                    <td className="py-2 text-xs">
                      <DiffSpan oldValue={a.oldValue} newValue={a.newValue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function DiffSpan({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const oldKeys = oldValue && typeof oldValue === "object" ? Object.keys(oldValue) : [];
  const newKeys = newValue && typeof newValue === "object" ? Object.keys(newValue) : [];
  const keys = Array.from(new Set([...oldKeys, ...newKeys]));
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-mono text-xs">
      {keys.map((k) => {
        const o = (oldValue as Record<string, unknown> | null)?.[k];
        const n = (newValue as Record<string, unknown> | null)?.[k];
        return (
          <span key={k} className="mr-2">
            {k}: <span className="text-danger">{String(o ?? "∅")}</span> →{" "}
            <span className="text-success">{String(n ?? "∅")}</span>
          </span>
        );
      })}
    </span>
  );
}

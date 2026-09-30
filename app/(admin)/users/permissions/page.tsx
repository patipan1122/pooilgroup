import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { prisma } from "@/lib/prisma";
import { MODULES } from "@/lib/modules";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// โปรแกรมที่มีหน้าตั้งค่าสิทธิ์/จัดการทีมของตัวเองอยู่แล้ว — ลิงก์ตรงไปที่นั่น
// แทนหน้ารวมนี้ตอบแค่ "ใครมีสิทธิ์อะไรบ้างตอนนี้" ไม่ใช่หน้าแก้ไข
const DETAIL_LINKS: Partial<Record<string, { href: string; label: string }>> = {
  recruit: { href: "/recruit/settings/permissions", label: "ตั้งค่าสิทธิ์ละเอียด" },
  ledger: { href: "/ledger/settings/members?tab=permissions", label: "ตั้งค่าสิทธิ์ละเอียด" },
  clawfleet: { href: "/clawfleet/os/staff", label: "จัดการทีม" },
  playland: { href: "/playland/settings/team", label: "จัดการทีม" },
  dc: { href: "/dc/office/permissions", label: "จัดการสิทธิ์คลัง" },
  chairops: { href: "/chairops/users", label: "จัดการทีมเก้าอี้นวด" },
};

export default async function PermissionsOverviewPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const orgId = session.user.org_id;
  const admin = adminClient();

  const [{ data: grants }, { count: adminTierCount }, chairopsCounts, ledgerCounts] =
    await Promise.all([
      admin
        .from("user_modules")
        .select("user_id, module_name, role, users(name, role, is_active)")
        .eq("org_id", orgId)
        .eq("is_active", true),
      admin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_active", true)
        .in("role", ["super_admin", "org_admin", "admin"]),
      prisma.chairopsUser.groupBy({
        by: ["role"],
        where: { orgId, isActive: true },
        _count: { id: true },
      }),
      prisma.ledgerLineMember.groupBy({
        by: ["role"],
        where: { orgId, active: true },
        _count: { id: true },
      }),
    ]);

  // นับสิทธิ์ต่อโปรแกรม จากตาราง user_modules — แยกว่าเป็น "แอดมินโปรแกรม"
  // (role="admin" ของโมดูล) หรือ "สมาชิก" (role="member") พร้อมเก็บชื่อจริงไว้
  // โชว์ในการ์ด (join ตรงในคิวรีเดียว ไม่ต้องยิงซ้ำ)
  type GrantRow = {
    user_id: string;
    module_name: string;
    role: string;
    users: { name: string; role: string; is_active: boolean } | null;
  };
  const byModule = new Map<
    string,
    { admin: string[]; member: string[]; adminCount: number; memberCount: number }
  >();
  for (const g of (grants ?? []) as unknown as GrantRow[]) {
    if (!g.users?.is_active) continue; // deactivated user — don't show as if they still have access
    const cur = byModule.get(g.module_name) ?? {
      admin: [],
      member: [],
      adminCount: 0,
      memberCount: 0,
    };
    if (g.role === "admin") {
      cur.adminCount++;
      cur.admin.push(g.users.name);
    } else {
      cur.memberCount++;
      cur.member.push(g.users.name);
    }
    byModule.set(g.module_name, cur);
  }

  // ChairOps + LedgerLine มีระบบผู้ใช้แยกต่างหาก ไม่ได้อยู่ใน user_modules —
  // ดึงมาโชว์แยก (ตามที่ CEO ตัดสินใจ 2026-09-30: ยังไม่รวมระบบ แค่ดึงมาโชว์)
  const chairopsTotal = chairopsCounts.reduce((s, r) => s + r._count.id, 0);
  const ledgerTotal = ledgerCounts.reduce((s, r) => s + r._count.id, 0);

  const programs = Object.values(MODULES).filter((m) => m.slug !== "costctrl");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-3">
        <BackButton label="กลับ" fallbackHref="/users" />
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs font-semibold text-[var(--color-brand-600)]">
          ภาพรวมสิทธิ์
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          สิทธิ์แต่ละโปรแกรม
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          ใครมีสิทธิ์อะไรบ้าง ในแต่ละโปรแกรม ณ ตอนนี้ — กดเข้าไปดู/จัดการรายชื่อ
          หรือตั้งค่าสิทธิ์ละเอียดของโปรแกรมนั้น (ถ้ามี)
        </p>
      </header>

      <Card className="mb-4 animate-fade-up delay-100">
        <CardBody className="!py-3">
          <p className="text-sm">
            👑 <strong>แอดมินองค์กร {adminTierCount ?? 0} คน</strong> — เห็นและ
            จัดการได้ทุกโปรแกรมเสมอ (Super Admin / Admin) ไม่ต้องมีสิทธิ์แยก
            รายโปรแกรม จึงไม่นับรวมในตัวเลขด้านล่าง
          </p>
        </CardBody>
      </Card>

      <div className="space-y-3">
        {programs.map((p) => {
          const counts = byModule.get(p.slug) ?? {
            admin: [],
            member: [],
            adminCount: 0,
            memberCount: 0,
          };
          const detail = DETAIL_LINKS[p.slug];
          const extra =
            p.slug === "chairops" ? chairopsTotal : p.slug === "ledger" ? ledgerTotal : 0;
          const hasAny = counts.adminCount + counts.memberCount + extra > 0;
          const namePreview = (names: string[]) =>
            names.length <= 4
              ? names.join(", ")
              : `${names.slice(0, 4).join(", ")} +${names.length - 4} คน`;
          return (
            <Card key={p.slug} className="animate-fade-up delay-150">
              <CardBody className="!py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{p.emoji}</span>
                    <div>
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className="text-xs text-zinc-500">{p.tagline}</div>
                    </div>
                  </div>
                  {p.status === "beta" && <Badge tone="warning">Beta</Badge>}
                </div>

                {hasAny ? (
                  <div className="mt-3 space-y-1.5 text-xs">
                    {counts.adminCount > 0 && (
                      <div className="flex items-start gap-2">
                        <Badge tone="brand" className="shrink-0">
                          {counts.adminCount} แอดมินโปรแกรม
                        </Badge>
                        <span className="text-zinc-600 pt-0.5">
                          {namePreview(counts.admin)}
                        </span>
                      </div>
                    )}
                    {counts.memberCount > 0 && (
                      <div className="flex items-start gap-2">
                        <Badge tone="neutral" className="shrink-0">
                          {counts.memberCount} สมาชิก
                        </Badge>
                        <span className="text-zinc-600 pt-0.5">
                          {namePreview(counts.member)}
                        </span>
                      </div>
                    )}
                    {extra > 0 && (
                      <div className="flex items-start gap-2">
                        <Badge tone="info" className="shrink-0">
                          + {extra} คน
                        </Badge>
                        <span className="text-zinc-600 pt-0.5">
                          ระบบผู้ใช้แยกของตัวเอง — ดูรายชื่อจริงที่{" "}
                          {detail ? detail.label.toLowerCase() : "หน้าโปรแกรม"} ด้านล่าง
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-zinc-400">
                    ยังไม่มีใครได้รับสิทธิ์แยก (นอกจากแอดมินองค์กรที่เห็นทุกโปรแกรมอยู่แล้ว)
                  </p>
                )}

                {detail && (
                  <div className="mt-3">
                    <Link
                      href={detail.href}
                      className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline"
                    >
                      {detail.label} →
                    </Link>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-zinc-400 text-center">
        อยากเพิ่ม/ลดสิทธิ์โปรแกรมของใคร → ไปที่{" "}
        <Link href="/users" className="underline">
          หน้าผู้ใช้ทั้งหมด
        </Link>{" "}
        แล้วกดแก้ไขที่ตัวคนนั้น
      </p>
    </div>
  );
}

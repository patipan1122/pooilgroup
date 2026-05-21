// /recruit/blacklist — manage blacklist entries

import { requireSession } from "@/lib/auth/session";
import {
  requireRecruitAccess,
  canRecruitAdmin,
  canRecruitWrite,
} from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { BlacklistManager } from "@/components/recruit/blacklist-manager";

export const dynamic = "force-dynamic";

export default async function BlacklistPage() {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);

  const now = new Date();
  const entries = await prisma.recruitBlacklist.findMany({
    where: {
      orgId: session.user.org_id,
    },
    orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { addedAt: "desc" }],
    include: {
      addedBy: { select: { name: true } },
    },
  });

  const active = entries.filter((e) => !e.removedAt && e.expiresAt > now);
  const expired = entries.filter((e) => !e.removedAt && e.expiresAt <= now);
  const removed = entries.filter((e) => e.removedAt);

  return (
    <div className="p-5 sm:p-8 max-w-4xl mx-auto">
      <Section
        number="04"
        label="BLACKLIST"
        title="Blacklist ผู้สมัคร"
        description="คนเก่าที่มีปัญหา · ระบบจะใช้ตรวจสอบใบสมัครใหม่ทันที"
      >
        <BlacklistManager
          active={active.map((e) => ({
            id: e.id,
            fullName: e.fullName,
            phone: e.phone,
            reason: e.reason,
            scope: e.companyScope,
            addedAt: e.addedAt.toISOString(),
            addedBy: e.addedBy.name,
            expiresAt: e.expiresAt.toISOString(),
          }))}
          expired={expired.map((e) => ({
            id: e.id,
            fullName: e.fullName,
            phone: e.phone,
            reason: e.reason,
            scope: e.companyScope,
            addedAt: e.addedAt.toISOString(),
            addedBy: e.addedBy.name,
            expiresAt: e.expiresAt.toISOString(),
          }))}
          removed={removed.map((e) => ({
            id: e.id,
            fullName: e.fullName,
            phone: e.phone,
            reason: e.reason,
            scope: e.companyScope,
            addedAt: e.addedAt.toISOString(),
            addedBy: e.addedBy.name,
            expiresAt: e.expiresAt.toISOString(),
          }))}
          canWrite={canRecruitWrite(session.user.role)}
          canRemove={canRecruitAdmin(session.user.role)}
        />
      </Section>
    </div>
  );
}

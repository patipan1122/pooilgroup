// /recruit/auto-rules — manage screening rules
// Per Recruit Redesign canvas section 11B (AutoScreenRules)

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { RuleEditor } from "@/components/recruit/rule-editor";
import { RuleList } from "@/components/recruit/rule-list";
import { Bolt } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutoRulesPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);

  const rules = await prisma.recruitScreeningRule.findMany({
    where: { orgId: session.user.org_id },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="11"
        label="Auto-screen"
        title="กฎคัดอัตโนมัติ"
        description="ตั้งเงื่อนไข → ระบบทำให้ (เช่น AI score ≥ 85 → คัดผ่าน) · HR กดเรียกใช้รายคน · ไม่ auto"
      >
        <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white border border-amber-200 p-4 mb-6 flex items-center gap-3">
          <Bolt className="size-5 text-amber-700 shrink-0" />
          <div className="flex-1 text-xs text-zinc-700 leading-relaxed">
            <b className="text-amber-900">การทำงาน:</b> เปิดใบสมัคร → กดปุ่ม &ldquo;ใช้กฎทั้งหมด&rdquo; →
            ระบบเช็คกฎทุกข้อ · ที่ตรงเงื่อนไขจะทำ action (เปลี่ยน status / ติด tag / ใส่ note)
            ตามที่ตั้งไว้
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
          <RuleList
            rules={rules.map((r) => ({
              id: r.id,
              name: r.name,
              enabled: r.enabled,
              condition: r.condition as unknown as {
                field: string;
                op: string;
                value: string | number | boolean;
              },
              action: r.action as unknown as {
                setStatus?: string;
                addTag?: string;
                comment?: string;
              },
              firesCount: r.firesCount,
              lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
              createdByName: r.createdBy.name,
            }))}
          />
          <RuleEditor />
        </div>
      </Section>
    </div>
  );
}

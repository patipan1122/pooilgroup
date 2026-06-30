// /inbox/settings/groups — CEO 2026-06-30 · bind maid LINE groups → branches.
// A group appears here once the bot is in it AND someone has sent a message
// (LINE only delivers group events after the bot joins). Also surfaces the
// monthly push usage so the office can watch the free-quota ceiling.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { inboxPushUsage } from "@/lib/inbox/queries";
import { Section } from "@/components/ui/section";
import { Users, Send } from "lucide-react";
import { bindGroupBranch } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxGroupsSettingsPage() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/403");
  const orgId = session.user.org_id;

  const [groups, branches, push] = await Promise.all([
    prisma.inboxConversation.findMany({
      where: { orgId, groupId: { not: null } },
      select: {
        id: true,
        displayName: true,
        groupName: true,
        branchRefId: true,
        branchLabel: true,
        lastMessageAt: true,
        channel: { select: { displayName: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    }),
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    inboxPushUsage(orgId),
  ]);

  return (
    <div className="inbox-has-mobilenav mx-auto max-w-[1200px] p-3 sm:p-8">
      <Section
        number="IB.2"
        label="MAID GROUP BINDING"
        title="ผูกกลุ่มแชตแม่บ้าน → สาขา"
        description="กลุ่ม LINE ที่บอทเข้าแล้ว + มีคนพิมพ์อย่างน้อย 1 ข้อความ จะโผล่ที่นี่ · เลือกว่ากลุ่มไหน = สาขาไหน เพื่อให้ /inbox ติดป้ายสาขาให้"
      >
        {/* push usage */}
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <Send className="size-5 shrink-0 text-zinc-600" />
          <div className="text-sm text-zinc-700">
            เดือน {push.monthLabel} ส่งออก (push) ไปแล้ว{" "}
            <b className={push.pushCount > 300 ? "text-red-600" : "text-zinc-900"}>
              {push.pushCount.toLocaleString()}
            </b>{" "}
            ครั้ง
            <span className="text-xs text-zinc-500"> · โควต้าฟรี ~300/เดือน (ตอบในกลุ่ม = push 1)</span>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
            <Users className="mx-auto size-10 text-zinc-300" />
            <p className="mt-3 font-semibold text-zinc-700">ยังไม่มีกลุ่ม</p>
            <p className="mt-1 leading-relaxed">
              เชิญบอท (LINE OA) เข้ากลุ่มแม่บ้าน แล้วให้มีคนพิมพ์ 1 ข้อความ
              <br />
              กลุ่มจะโผล่ที่นี่ให้เลือกผูกสาขาได้
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">กลุ่ม</th>
                  <th className="px-4 py-2.5 font-medium">สาขาที่ผูก</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-t border-zinc-100">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">
                        👥 {g.groupName || g.displayName || "(กลุ่มไม่มีชื่อ)"}
                      </div>
                      <div className="text-xs text-zinc-500">{g.channel.displayName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <form action={bindGroupBranch} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="conversationId" value={g.id} />
                        <select
                          name="branchRefId"
                          defaultValue={g.branchRefId ?? ""}
                          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                        >
                          <option value="">— ยังไม่ผูก —</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="h-9 rounded-md bg-[var(--color-brand-600)] px-3 text-sm font-medium text-white hover:bg-[var(--color-brand-700)]"
                        >
                          บันทึก
                        </button>
                        {g.branchLabel && (
                          <span className="text-xs text-emerald-700">📍 {g.branchLabel}</span>
                        )}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

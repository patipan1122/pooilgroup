// /recruit/messages — messaging hub
// Per Recruit Redesign canvas section 08 (MessagingDesktop/Mobile)
//
// 2-pane layout: thread list (left) | thread detail (right)
// Channels: INAPP (always works) · EMAIL (via Resend) · LINE/SMS (queued · webhook TODO)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { listThreads } from "@/lib/recruit/message-actions";
import { MessageThreadView } from "@/components/recruit/message-thread-view";
import { MessageCircle, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  app?: string;
}

const CHANNEL_LABEL: Record<string, { label: string; className: string }> = {
  INAPP: { label: "ในระบบ", className: "bg-zinc-100 text-zinc-700" },
  EMAIL: { label: "Email", className: "bg-amber-100 text-amber-700" },
  LINE: { label: "LINE", className: "bg-green-100 text-green-800" },
  SMS: { label: "SMS", className: "bg-blue-100 text-blue-700" },
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const selectedAppId = params.app ?? null;

  const threads = await listThreads(session.user.org_id);

  let selectedThread = null;
  if (selectedAppId) {
    const messages = await prisma.recruitMessage.findMany({
      where: { applicationId: selectedAppId, orgId: session.user.org_id },
      orderBy: { createdAt: "asc" },
      include: { createdBy: { select: { name: true } } },
    });
    const app = await prisma.recruitApplication.findUnique({
      where: { id: selectedAppId },
      include: {
        applicant: { select: { fullName: true, phone: true, email: true, lineId: true } },
        posting: { select: { title: true } },
      },
    });
    if (app && app.orgId === session.user.org_id) {
      selectedThread = {
        applicationId: app.id,
        applicantName: app.applicant.fullName,
        phone: app.applicant.phone,
        email: app.applicant.email,
        lineId: app.applicant.lineId,
        postingTitle: app.posting.title,
        messages: messages.map((m) => ({
          id: m.id,
          channel: m.channel,
          direction: m.direction as "IN" | "OUT",
          body: m.body,
          status: m.status,
          createdAt: m.createdAt.toISOString(),
          sentBy: m.createdBy?.name ?? null,
        })),
      };
    }
  }

  return (
    <div className="h-[calc(100vh-60px)] flex flex-col">
      <div className="p-5 sm:p-7 border-b border-zinc-200 bg-white">
        <Section
          number="08"
          label="Messaging"
          title="กล่องข้อความ"
          description="คุยกับผู้สมัครรวมที่เดียว · LINE / SMS / Email / ในระบบ"
        >
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
            ⚠️ LINE & SMS อยู่ในสถานะ <b>QUEUED</b> — ส่งจริงต้องตั้งค่า LINE OA + SMS gateway (Phase 2)
          </p>
        </Section>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] overflow-hidden">
        {/* Thread list */}
        <aside className={`border-r border-zinc-200 bg-white overflow-y-auto ${selectedThread ? "hidden lg:block" : ""}`}>
          {threads.length === 0 ? (
            <div className="p-8 text-center">
              <Inbox className="size-12 mx-auto text-zinc-300" />
              <p className="mt-4 font-bold text-zinc-900">ยังไม่มีข้อความ</p>
              <p className="text-xs text-zinc-500 mt-1">
                ส่งข้อความถึงผู้สมัครจาก Timeline ในใบสมัคร
              </p>
              <Link
                href="/recruit"
                className="inline-flex items-center mt-4 text-xs font-bold text-[var(--color-brand-700)] hover:underline"
              >
                ไปกล่องใบสมัคร →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {threads.map((t) => {
                const isSelected = t.applicationId === selectedAppId;
                const chMeta = CHANNEL_LABEL[t.lastChannel];
                return (
                  <Link
                    key={t.applicationId}
                    href={`/recruit/messages?app=${t.applicationId}`}
                    className={`block p-3 transition-colors ${
                      isSelected
                        ? "bg-[var(--color-brand-50)] border-l-4 border-[var(--color-brand-500)]"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-bold text-zinc-900 truncate">
                        {t.applicantName}
                      </p>
                      {t.unread > 0 && (
                        <span className="size-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {t.unread}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 truncate">{t.postingTitle}</p>
                    <p className="text-xs text-zinc-700 mt-1 line-clamp-1">
                      {t.lastDirection === "OUT" ? "→ " : "← "}
                      {t.lastMessage}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${chMeta.className}`}
                      >
                        {chMeta.label}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {new Date(t.lastAt).toLocaleString("th-TH", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </aside>

        {/* Thread detail */}
        <main className={`overflow-hidden ${selectedThread ? "" : "hidden lg:flex lg:items-center lg:justify-center"}`}>
          {selectedThread ? (
            <MessageThreadView thread={selectedThread} />
          ) : (
            <div className="text-center p-8">
              <MessageCircle className="size-12 mx-auto text-zinc-300" />
              <p className="mt-3 font-bold text-zinc-700">เลือกข้อความจากรายการ</p>
              <p className="text-xs text-zinc-500 mt-1">
                หรือไปใบสมัครเพื่อเริ่มคุยใหม่
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

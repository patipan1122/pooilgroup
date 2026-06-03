import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { prisma } from "@/lib/prisma";
import { listConversations, conversationCounts, getConversation, type ConvFilter } from "@/lib/fuelos/inbox-data";
import { bkkRelative, bkkTime } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { ReplyBox } from "./reply-box";
import { ChatControls } from "./chat-controls";
import { ArrowLeft, MessageSquareWarning, MessagesSquare, UserCircle2 } from "lucide-react";

const SEG_LABEL: Record<string, string> = { NEW: "ลูกค้าใหม่", OLD: "ลูกค้าเก่า", PRICE_CHECK: "เช็คราคา" };
const SEG_TONE: Record<string, string> = {
  NEW: "bg-info/10 text-info", OLD: "bg-leaf-100 text-leaf-700", PRICE_CHECK: "bg-warning/15 text-warning",
};

type Att =
  | { type: "image" | "video" | "audio"; messageId: string | null }
  | { type: "sticker"; stickerId: string | null }
  | { type: "file"; messageId: string | null; fileName: string | null }
  | { type: "location"; lat: number | null; lng: number | null; title: string | null; address: string | null };

// แสดงเนื้อหาข้อความ: รูป/สติกเกอร์/วิดีโอ/ตำแหน่ง/ไฟล์ หรือข้อความปกติ
function MsgContent({ attachments, externalId, body, out }: { attachments: unknown; externalId: string | null; body: string; out: boolean }) {
  const att = (attachments ?? null) as Att | null;
  if (att?.type === "image" && externalId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/fuelos/line-content/${externalId}`} alt="รูปจากลูกค้า" className="rounded-lg max-h-64 w-auto" />;
  }
  if (att?.type === "sticker" && att.stickerId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${att.stickerId}/android/sticker.png`} alt="สติกเกอร์" className="size-28 object-contain" />;
  }
  if (att?.type === "video" && externalId) {
    return <video src={`/api/fuelos/line-content/${externalId}`} controls className="rounded-lg max-h-64 w-auto" />;
  }
  if (att?.type === "audio" && externalId) {
    return <audio src={`/api/fuelos/line-content/${externalId}`} controls className="max-w-full" />;
  }
  if (att?.type === "location") {
    return <a href={`https://maps.google.com/?q=${att.lat},${att.lng}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📍 {att.title || att.address || "ดูตำแหน่งบนแผนที่"}</a>;
  }
  if (att?.type === "file" && externalId) {
    return <a href={`/api/fuelos/line-content/${externalId}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📎 {att.fileName || "ดาวน์โหลดไฟล์"}</a>;
  }
  return <div className="text-sm whitespace-pre-wrap break-words">{body}</div>;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; c?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = (["all", "unanswered", "mine"].includes(sp.filter ?? "") ? sp.filter : "all") as ConvFilter;

  const [list, counts, conv, salesUsers] = await Promise.all([
    listConversations(user.orgId, { filter, userId: user.id }),
    conversationCounts(user.orgId, user.id),
    sp.c ? getConversation(user.orgId, sp.c) : Promise.resolve(null),
    prisma.fuelUser.findMany({ where: { orgId: user.orgId, role: { in: ["SALES", "SALES_HEAD"] }, isActive: true }, select: { id: true, name: true } }),
  ]);

  const tabs = [
    { key: "all", label: "ทั้งหมด", n: counts.all },
    { key: "unanswered", label: "ค้างตอบ", n: counts.unanswered },
    { key: "mine", label: "ของฉัน", n: counts.mine },
  ];

  return (
    <div className="lg:h-[calc(100dvh-3rem)] -m-4 sm:-m-6 lg:m-0">
      <div className="lg:grid lg:grid-cols-[360px_1fr] lg:h-full lg:gap-0">
        {/* LIST */}
        <div className={cn("lg:border-r border-border lg:overflow-y-auto bg-surface", conv && "hidden lg:block")}>
          <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <MessagesSquare className="size-5 text-brand-600" />
              <h1 className="font-bold">กล่องแชท</h1>
            </div>
            <div className="flex gap-1.5">
              {tabs.map((t) => (
                <Link
                  key={t.key} href={`/fuelos/inbox?filter=${t.key}`}
                  className={cn(
                    "px-2.5 h-8 rounded-lg text-xs font-medium inline-flex items-center gap-1.5",
                    filter === t.key ? "bg-brand-600 text-white" : "bg-surface-2 text-zinc-600",
                  )}
                >
                  {t.label}
                  <span className={cn("tabular-nums", filter === t.key ? "text-white/80" : "text-zinc-400")}>{t.n}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="divide-y divide-border">
            {list.length === 0 && <div className="p-8 text-center text-zinc-400 text-sm">ไม่มีแชทในหมวดนี้</div>}
            {list.map((c) => (
              <Link
                key={c.id} href={`/fuelos/inbox?filter=${filter}&c=${c.id}`}
                className={cn("flex gap-3 p-3 hover:bg-surface-2", conv?.id === c.id && "bg-brand-50")}
              >
                <div className="size-10 rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0">
                  {c.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{c.name}</span>
                    <span className="text-[11px] text-zinc-400 shrink-0">{c.lastMessageAt ? bkkRelative(c.lastMessageAt) : ""}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {c.isUnanswered && <MessageSquareWarning className="size-3.5 text-danger shrink-0" />}
                    <span className={cn("text-xs truncate", c.isUnanswered ? "text-danger font-medium" : "text-zinc-500")}>{c.preview}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", SEG_TONE[c.segment])}>{SEG_LABEL[c.segment]}</span>
                    {c.assignee && <span className="text-[10px] text-zinc-400 inline-flex items-center gap-0.5"><UserCircle2 className="size-3" />{c.assignee}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* DETAIL */}
        <div className={cn("flex flex-col lg:h-full bg-surface-2", !conv && "hidden lg:flex")}>
          {!conv ? (
            <div className="flex-1 grid place-items-center text-zinc-400">
              <div className="text-center">
                <MessagesSquare className="size-10 mx-auto mb-2 opacity-40" />
                เลือกแชทเพื่อเริ่มคุย
              </div>
            </div>
          ) : (
            <>
              {/* detail header */}
              <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-3 py-2.5 flex items-center gap-2">
                <Link href={`/fuelos/inbox?filter=${filter}`} className="lg:hidden size-9 grid place-items-center rounded-lg hover:bg-surface-2">
                  <ArrowLeft className="size-5" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">{conv.customer?.name ?? conv.displayName}</div>
                  <div className="text-[11px] text-zinc-500">
                    {conv.customer?.zone ? `โซน ${conv.customer.zone}` : "ยังไม่ผูกลูกค้า"}
                    {conv.customer?.lastOrderAt && ` · ซื้อล่าสุด ${bkkRelative(conv.customer.lastOrderAt)}`}
                  </div>
                </div>
                {conv.customer && (
                  <Link href={`/fuelos/customers/${conv.customer.id}`} className="text-xs text-brand-600 hover:underline shrink-0">
                    ดูลูกค้า
                  </Link>
                )}
              </div>

              <ChatControls
                convId={conv.id}
                segment={conv.segment}
                assigneeId={conv.assignedTo?.id ?? null}
                salesUsers={salesUsers}
              />

              {/* messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 lg:max-h-none max-h-[55vh]">
                {conv.messages.map((m) => {
                  const out = m.direction === "OUT";
                  return (
                    <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2", out ? "bg-brand-600 text-white" : "bg-surface border border-border")}>
                        {!out && <div className="text-[10px] text-zinc-400 mb-0.5">ลูกค้า</div>}
                        {out && (m.senderUser?.name || m.sentByBot) && (
                          <div className="text-[10px] text-white/70 mb-0.5">{m.sentByBot ? "🤖 บอท" : m.senderUser?.name}</div>
                        )}
                        <MsgContent attachments={m.attachments} externalId={m.externalId} body={m.body} out={out} />
                        <div className={cn("text-[10px] mt-0.5", out ? "text-white/60" : "text-zinc-400")}>{bkkTime(m.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <ReplyBox convId={conv.id} zone={conv.customer?.zone ?? null} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

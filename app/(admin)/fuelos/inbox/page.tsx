import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { prisma } from "@/lib/prisma";
import {
  listConversations,
  conversationCounts,
  getConversation,
  customerProfileStats,
  listLabels,
  type ConvFilter,
} from "@/lib/fuelos/inbox-data";
import { getPricingContext } from "@/lib/fuelos/pricing-data";
import { listCustomerOptions } from "@/lib/fuelos/quotes-data";
import { bkkRelative, bkkTime } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { lineEmojiImageUrl, type LineEmoji } from "@/lib/fuelos/line";
import { ReplyBox } from "./reply-box";
import { ChatControls } from "./chat-controls";
import { ChatTools } from "@/components/fuelos/inbox/chat-tools";
import { LineAvatar } from "@/components/fuelos/inbox/line-avatar";
import { ChatSearch } from "@/components/fuelos/inbox/chat-search";
import { LabelManager } from "@/components/fuelos/inbox/label-manager";
import { ConvLabelPicker } from "@/components/fuelos/inbox/conv-label-picker";
import { labelTone } from "@/components/fuelos/inbox/label-colors";
import { ArrowLeft, MessageSquareWarning, MessagesSquare, UserCircle2, Lock, Users } from "lucide-react";

const SEG_LABEL: Record<string, string> = { NEW: "ลูกค้าใหม่", OLD: "ลูกค้าเก่า", PRICE_CHECK: "เช็คราคา" };
const SEG_TONE: Record<string, string> = {
  NEW: "bg-info/10 text-info", OLD: "bg-leaf-100 text-leaf-700", PRICE_CHECK: "bg-warning/15 text-warning",
};
const STATUS_PREFIX = "📌 สถานะ:";

type Att =
  | { type: "text"; emojis: LineEmoji[] }
  | { type: "image" | "video" | "audio"; messageId: string | null }
  | { type: "sticker"; stickerId: string | null }
  | { type: "file"; messageId: string | null; fileName: string | null }
  | { type: "location"; lat: number | null; lng: number | null; title: string | null; address: string | null };

// ข้อความ text + LINE emoji พรีเมียม → แทรกรูป emoji ตามตำแหน่ง index/length (clamp กัน index เพี้ยน)
function RichText({ text, emojis, out }: { text: string; emojis: LineEmoji[]; out: boolean }) {
  const sorted = [...emojis].sort((a, b) => a.index - b.index);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((e, i) => {
    const start = Math.max(cursor, Math.min(e.index, text.length));
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      // eslint-disable-next-line @next/next/no-img-element
      <img key={`e${i}`} src={lineEmojiImageUrl(e.productId, e.emojiId)} alt="emoji" className="inline-block align-text-bottom size-[1.2em] mx-px" />,
    );
    cursor = Math.min(start + Math.max(1, e.length), text.length);
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <div className={cn("text-sm whitespace-pre-wrap break-words", out && "text-white")}>{nodes}</div>;
}

function MsgContent({ attachments, externalId, body, out }: { attachments: unknown; externalId: string | null; body: string; out: boolean }) {
  const att = (attachments ?? null) as Att | null;
  if (att?.type === "text" && att.emojis?.length) {
    return <RichText text={body} emojis={att.emojis} out={out} />;
  }
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
  if (att?.type === "location" && att.lat != null && att.lng != null) {
    return <a href={`https://maps.google.com/?q=${att.lat},${att.lng}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📍 {att.title || att.address || "ดูตำแหน่งบนแผนที่"}</a>;
  }
  if (att?.type === "file" && externalId) {
    return <a href={`/api/fuelos/line-content/${externalId}`} target="_blank" rel="noreferrer" className={cn("text-sm underline", out ? "text-white" : "text-brand-700")}>📎 {att.fileName || "ดาวน์โหลดไฟล์"}</a>;
  }
  return <div className="text-sm whitespace-pre-wrap break-words">{body}</div>;
}

// avatar แชท: รูปจริง (กลุ่ม/โปรไฟล์) + ป้ายมุมบอกว่าเป็นกลุ่ม
function ConvAvatar({ src, name, isGroup, size = 44 }: { src?: string | null; name: string; isGroup: boolean; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <LineAvatar src={src} name={name} size={size} />
      {isGroup && (
        <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-brand-600 text-white grid place-items-center ring-2 ring-surface">
          <Users className="size-2.5" />
        </span>
      )}
    </div>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; c?: string; q?: string; label?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = (["all", "unanswered", "mine"].includes(sp.filter ?? "") ? sp.filter : "all") as ConvFilter;
  const q = (sp.q ?? "").trim();
  const labelId = sp.label || null;

  const [list, counts, conv, salesUsers, labels] = await Promise.all([
    listConversations(user.orgId, { filter, userId: user.id, q, labelId }),
    conversationCounts(user.orgId, user.id),
    sp.c ? getConversation(user.orgId, sp.c) : Promise.resolve(null),
    prisma.fuelUser.findMany({ where: { orgId: user.orgId, role: { in: ["SALES", "SALES_HEAD"] }, isActive: true }, select: { id: true, name: true } }),
    listLabels(user.orgId),
  ]);

  // ข้อมูลประกอบ panel โปรไฟล์ + drawer ใบเสนอราคา (เฉพาะตอนเปิดแชท)
  const [profileRaw, pricingCtx, customerOpts] = conv
    ? await Promise.all([
        conv.customer ? customerProfileStats(user.orgId, conv.customer.id) : Promise.resolve(null),
        getPricingContext(user.orgId),
        listCustomerOptions(user.orgId),
      ])
    : [null, null, []];

  // serialize Decimal → number ก่อนส่งเข้า client component
  const profile = profileRaw && {
    ...profileRaw,
    creditLimit: profileRaw.creditLimit == null ? null : Number(profileRaw.creditLimit),
    creditUsed: Number(profileRaw.creditUsed),
    recentOrders: profileRaw.recentOrders.map((o) => ({ ...o, subtotal: Number(o.subtotal), createdAt: o.createdAt.toISOString() })),
    firstOrderAt: profileRaw.firstOrderAt?.toISOString() ?? null,
    lastOrderAt: profileRaw.lastOrderAt?.toISOString() ?? null,
  };

  const tabs = [
    { key: "all", label: "ทั้งหมด", n: counts.all },
    { key: "unanswered", label: "ค้างตอบ", n: counts.unanswered },
    { key: "mine", label: "ของฉัน", n: counts.mine },
  ];

  // สร้าง URL คงตัวกรอง/ป้าย/คำค้น (drop c = ปิดแชทที่เปิด)
  const hrefWith = (o: { filter?: string; label?: string | null }) => {
    const f = o.filter ?? filter;
    const l = o.label === undefined ? labelId : o.label;
    const params = new URLSearchParams();
    if (f && f !== "all") params.set("filter", f);
    if (l) params.set("label", l);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `/fuelos/inbox?${s}` : "/fuelos/inbox";
  };
  const convHref = (cid: string) => {
    const base = hrefWith({});
    return base.includes("?") ? `${base}&c=${cid}` : `/fuelos/inbox?c=${cid}`;
  };

  const convLabels = conv ? conv.labels.map((l) => l.label) : [];

  return (
    <div className="h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-4rem)] -m-4 sm:-m-6 lg:m-0 lg:h-[calc(100dvh-4rem)] min-h-0 overflow-hidden">
      <div className="lg:grid lg:grid-cols-[360px_1fr] h-full min-h-0">
        {/* LIST */}
        <div className={cn("lg:border-r border-border overflow-y-auto min-h-0 bg-surface", conv && "hidden lg:block")}>
          <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <MessagesSquare className="size-5 text-brand-600" />
              <h1 className="font-bold flex-1">กล่องแชท</h1>
              <LabelManager labels={labels} />
            </div>

            {/* ค้นหา */}
            <ChatSearch initial={q} filter={filter} labelId={labelId} />

            {/* ตัวกรองสถานะ */}
            <div className="flex gap-1.5">
              {tabs.map((t) => (
                <Link
                  key={t.key} href={hrefWith({ filter: t.key })}
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

            {/* หมวดหมู่/ป้าย (กรอง) */}
            {labels.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto -mb-0.5 pb-1">
                <Link
                  href={hrefWith({ label: null })}
                  className={cn("shrink-0 h-7 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center border",
                    labelId ? "bg-surface border-border text-zinc-500" : "bg-zinc-900 border-zinc-900 text-white")}
                >
                  ทุกหมวด
                </Link>
                {labels.map((l) => (
                  <Link
                    key={l.id} href={hrefWith({ label: labelId === l.id ? null : l.id })}
                    className={cn("shrink-0 h-7 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5 border",
                      labelTone(l.color).chip, labelId === l.id && "ring-2 ring-brand-500/40")}
                  >
                    <span className={cn("size-2 rounded-full", labelTone(l.color).dot)} />
                    {l.name}
                    <span className="tabular-nums opacity-70">{l.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="divide-y divide-border">
            {list.length === 0 && (
              <div className="p-8 text-center text-zinc-400 text-sm">
                {q ? `ไม่พบแชทที่ตรงกับ “${q}”` : "ไม่มีแชทในหมวดนี้"}
              </div>
            )}
            {list.map((c) => (
              <Link
                key={c.id} href={convHref(c.id)}
                className={cn("flex gap-3 p-3 hover:bg-surface-2", conv?.id === c.id && "bg-brand-50")}
              >
                <ConvAvatar src={c.pictureUrl} name={c.name} isGroup={c.isGroup} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{c.name}</span>
                    <span className="text-[11px] text-zinc-400 shrink-0">{c.lastMessageAt ? bkkRelative(c.lastMessageAt) : ""}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {c.isUnanswered && <MessageSquareWarning className="size-3.5 text-danger shrink-0" />}
                    <span className={cn("text-xs truncate flex-1", c.isUnanswered ? "text-danger font-medium" : "text-zinc-500")}>{c.preview || "—"}</span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-brand-600 text-white text-[10px] font-bold grid place-items-center tabular-nums">{c.unreadCount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {c.labels.slice(0, 3).map((l) => (
                      <span key={l.id} className={cn("text-[10px] px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1", labelTone(l.color).chip)}>
                        <span className={cn("size-1.5 rounded-full", labelTone(l.color).dot)} />{l.name}
                      </span>
                    ))}
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", SEG_TONE[c.segment])}>{SEG_LABEL[c.segment]}</span>
                    {c.assignee && <span className="text-[10px] text-zinc-400 inline-flex items-center gap-0.5"><UserCircle2 className="size-3" />{c.assignee}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* DETAIL */}
        <div className={cn("flex flex-col h-full min-h-0 bg-surface-2", !conv && "hidden lg:flex")}>
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
              <div className="shrink-0 bg-surface/95 backdrop-blur border-b border-border px-3 py-2.5 flex items-center gap-2">
                <Link href={hrefWith({})} aria-label="กลับไปรายการแชท" className="lg:hidden size-9 grid place-items-center rounded-lg hover:bg-surface-2">
                  <ArrowLeft className="size-5" />
                </Link>
                <ConvAvatar src={conv.pictureUrl} name={conv.customer?.nickname || conv.customer?.name || conv.lineGroupName || conv.displayName || "แชท"} isGroup={!!conv.lineGroupId} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate flex items-center gap-1.5">
                    <span className="truncate">{conv.customer?.nickname || conv.customer?.name || conv.lineGroupName || conv.displayName}</span>
                    {convLabels.slice(0, 2).map((l) => (
                      <span key={l.id} className={cn("text-[10px] px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1 font-normal shrink-0", labelTone(l.color).chip)}>
                        <span className={cn("size-1.5 rounded-full", labelTone(l.color).dot)} />{l.name}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {conv.customer?.zone ? `โซน ${conv.customer.zone}` : "ยังไม่ผูกลูกค้า"}
                    {conv.customer?.lastOrderAt && ` · ซื้อล่าสุด ${bkkRelative(conv.customer.lastOrderAt)}`}
                    {conv.people.length > 1 && ` · ${conv.people.length} คนในกลุ่ม`}
                  </div>
                </div>
                <ConvLabelPicker convId={conv.id} allLabels={labels.map(({ id, name, color }) => ({ id, name, color }))} activeIds={convLabels.map((l) => l.id)} />
                <ChatTools
                  convId={conv.id}
                  customerId={conv.customer?.id ?? null}
                  profile={profile}
                  people={conv.people}
                  quote={{
                    customers: customerOpts,
                    costs: pricingCtx?.costs ?? {},
                    margins: pricingCtx?.margins ?? {},
                    prefillCustomerId: conv.customer?.id ?? null,
                    prefillZone: conv.customer?.zone ?? null,
                    prospectHint: conv.customer ? null : conv.displayName ?? null,
                  }}
                />
              </div>

              <ChatControls
                convId={conv.id}
                segment={conv.segment}
                assigneeId={conv.assignedTo?.id ?? null}
                salesUsers={salesUsers}
              />

              {/* messages */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                {conv.messages.map((m) => {
                  const out = m.direction === "OUT";
                  // โน้ตภายใน (สถานะ) — ลูกค้าไม่เห็น · แสดงกลางจอแบบ chip
                  if (out && m.body.startsWith(STATUS_PREFIX)) {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 bg-surface border border-border rounded-full px-2.5 py-1">
                          <Lock className="size-3" /> โน้ตภายใน · {m.body.replace(STATUS_PREFIX, "").trim()}
                          <span className="text-zinc-400">(ลูกค้าไม่เห็น)</span>
                        </span>
                      </div>
                    );
                  }
                  const contactName = m.senderContact?.alias?.trim() || m.senderContact?.displayName?.trim() || "ลูกค้า";
                  const pic = m.senderContact?.pictureUrl;
                  return (
                    <div key={m.id} className={cn("flex gap-2", out ? "justify-end" : "justify-start")}>
                      {!out && <LineAvatar src={pic} name={contactName} size={28} className="mt-0.5" />}
                      <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2", out ? "bg-brand-600 text-white" : "bg-surface border border-border")}>
                        {!out && (
                          <div className="text-[10px] text-zinc-500 mb-0.5 flex items-center gap-1">
                            {contactName}
                            {m.senderContact?.roleLabel && <span className="text-brand-600 bg-brand-50 rounded px-1">{m.senderContact.roleLabel}</span>}
                          </div>
                        )}
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

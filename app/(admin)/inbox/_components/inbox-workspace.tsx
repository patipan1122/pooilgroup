"use client";

import { useCallback } from "react";
import { useInboxRealtime } from "@/lib/inbox/use-inbox-realtime";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { businessLabel, INBOX_BUSINESSES } from "@/lib/inbox/business";
import type {
  ConversationListItem,
  ConversationDetail,
  InboxCounts,
} from "@/lib/inbox/queries";
import { ConversationList } from "./conversation-list";
import { ConversationDetailPane } from "./conversation-detail";
import {
  Inbox,
  MessageSquare,
  Search,
  PlugZap,
  Hand,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface ChannelOption {
  id: string;
  platform: "LINE" | "FACEBOOK";
  displayName: string;
  businessTag: string | null;
}

interface ActiveFilters {
  status: string;
  channel: string;
  biz: string;
  human: boolean;
  urgent: boolean;
  lead: boolean;
  q: string;
}

interface Props {
  orgId: string;
  conversations: ConversationListItem[];
  counts: InboxCounts;
  channels: ChannelOption[];
  selected: ConversationDetail | null;
  activeFilters: ActiveFilters;
}

export function InboxWorkspace({
  orgId,
  conversations,
  counts,
  channels,
  selected,
  activeFilters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build a URL with one param patched. null/"" clears it. Selecting a
  // conversation keeps filters; changing a filter clears the open conversation.
  const buildHref = useCallback(
    (patch: Record<string, string | null>, opts?: { keepSelection?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!opts?.keepSelection && !("c" in patch)) next.delete("c");
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const hrefForConversation = useCallback(
    (id: string) => buildHref({ c: id }, { keepSelection: true }),
    [buildHref],
  );

  const setFilter = useCallback(
    (patch: Record<string, string | null>) => {
      router.push(buildHref(patch));
    },
    [router, buildHref],
  );

  // Real-time updates via Supabase broadcast — ingest.ts fires an event on
  // every inbound/outbound message and we re-fetch the Server Component on
  // the next tick.  Zero idle DB load · only fetches when something changed.
  useInboxRealtime({ orgId, conversationId: selected?.id ?? null });

  const hasAnyChannel = channels.length > 0;
  const hasAnyFilter =
    !!activeFilters.status ||
    !!activeFilters.channel ||
    !!activeFilters.biz ||
    activeFilters.human ||
    activeFilters.urgent ||
    activeFilters.lead ||
    !!activeFilters.q;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Page header */}
      <div className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
        <Section
          label="กล่องข้อความรวม"
          title="กล่องข้อความรวม"
          description="รวมแชตลูกค้าจาก LINE และ Facebook ทุกเพจไว้ที่เดียว"
          action={
            <Link
              href="/inbox/settings/channels"
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <PlugZap className="size-4" />
              ตั้งค่าช่องทาง
            </Link>
          }
        />
      </div>

      {/* 3-pane body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_340px_minmax(0,1fr)]">
        {/* LEFT: filter rail */}
        <aside className="hidden overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-4 lg:block">
          {/* Search */}
          <form
            action={pathname}
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("q");
              setFilter({ q: typeof value === "string" ? value.trim() || null : null });
            }}
            className="relative mb-4"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              name="q"
              defaultValue={activeFilters.q}
              placeholder="ค้นหาชื่อ/ข้อความ"
              className="h-9 w-full rounded-xl border border-zinc-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-[var(--color-brand-500)]"
            />
          </form>

          {/* Triage counts (quick filters) */}
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
            คิวงาน
          </p>
          <div className="space-y-1">
            <CountRow
              icon={<Hand className="size-4" />}
              label="ต้องคนตอบ"
              count={counts.needsHuman}
              tone="danger"
              active={activeFilters.human}
              href={buildHref({ human: activeFilters.human ? null : "1" })}
            />
            <CountRow
              icon={<AlertTriangle className="size-4" />}
              label="ด่วน"
              count={counts.urgent}
              tone="orange"
              active={activeFilters.urgent}
              href={buildHref({ urgent: activeFilters.urgent ? null : "1" })}
            />
            <CountRow
              icon={<Sparkles className="size-4" />}
              label="สนใจซื้อ (ลีด)"
              count={counts.leads}
              tone="purple"
              active={activeFilters.lead}
              href={buildHref({ lead: activeFilters.lead ? null : "1" })}
            />
            <CountRow
              icon={<Inbox className="size-4" />}
              label="เปิดอยู่"
              count={counts.open}
              tone="brand"
              active={activeFilters.status === "OPEN"}
              href={buildHref({ status: activeFilters.status === "OPEN" ? null : "OPEN" })}
            />
          </div>

          {/* Status filter */}
          <p className="mb-1.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
            สถานะ
          </p>
          <div className="space-y-1">
            {[
              { value: "", label: "ทั้งหมด" },
              { value: "OPEN", label: "เปิด" },
              { value: "SNOOZED", label: "พักไว้" },
              { value: "CLOSED", label: "ปิดแล้ว" },
            ].map((s) => (
              <FilterRow
                key={s.value || "all"}
                label={s.label}
                active={activeFilters.status === s.value}
                href={buildHref({ status: s.value || null })}
              />
            ))}
          </div>

          {/* Business filter */}
          <p className="mb-1.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
            ธุรกิจ
          </p>
          <div className="space-y-1">
            <FilterRow
              label="ทุกธุรกิจ"
              active={!activeFilters.biz}
              href={buildHref({ biz: null })}
            />
            {INBOX_BUSINESSES.map((b) => (
              <FilterRow
                key={b.tag}
                label={b.label}
                active={activeFilters.biz === b.tag}
                href={buildHref({ biz: b.tag })}
              />
            ))}
          </div>

          {/* Channel filter */}
          {hasAnyChannel && (
            <>
              <p className="mb-1.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                ช่องทาง
              </p>
              <div className="space-y-1">
                <FilterRow
                  label="ทุกช่องทาง"
                  active={!activeFilters.channel}
                  href={buildHref({ channel: null })}
                />
                {channels.map((ch) => (
                  <FilterRow
                    key={ch.id}
                    label={`${ch.platform === "LINE" ? "🟢" : "🔵"} ${ch.displayName}`}
                    sub={ch.businessTag ? businessLabel(ch.businessTag) : undefined}
                    active={activeFilters.channel === ch.id}
                    href={buildHref({ channel: ch.id })}
                  />
                ))}
              </div>
            </>
          )}

          {hasAnyFilter && (
            <Link
              href={pathname}
              className="mt-5 inline-block text-xs font-bold text-[var(--color-brand-700)] hover:underline"
            >
              ล้างตัวกรองทั้งหมด
            </Link>
          )}
        </aside>

        {/* MIDDLE: conversation list */}
        <section
          className={`min-h-0 overflow-y-auto border-r border-zinc-200 bg-white ${
            selected ? "hidden lg:block" : ""
          }`}
          aria-label="รายการบทสนทนา"
        >
          {!hasAnyChannel && conversations.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<Inbox className="size-7" />}
                title="ยังไม่มีข้อความเข้ามา"
                description="ต้องเชื่อมต่อ LINE OA หรือ Facebook Page ก่อน ลูกค้าทักเข้ามาแล้วข้อความจะมารวมที่นี่"
                action={
                  <Link
                    href="/inbox/settings/channels"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--color-brand-700)]"
                  >
                    <PlugZap className="size-4" />
                    เชื่อมต่อช่องทาง
                  </Link>
                }
              />
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedId={selected?.id ?? null}
              hrefForConversation={hrefForConversation}
            />
          )}
        </section>

        {/* RIGHT: conversation detail */}
        <section
          className={`min-h-0 overflow-hidden bg-white ${
            selected ? "" : "hidden lg:block"
          }`}
          aria-label="รายละเอียดบทสนทนา"
        >
          {selected ? (
            <ConversationDetailPane conversation={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <MessageSquare className="mx-auto size-12 text-zinc-300" />
                <p className="mt-3 font-bold text-zinc-700">เลือกบทสนทนาจากรายการ</p>
                <p className="mt-1 text-xs text-zinc-500">
                  คลิกข้อความทางซ้ายเพื่อดูและตอบลูกค้า
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const TONE_DOT: Record<string, string> = {
  danger: "bg-red-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  brand: "bg-[var(--color-brand-500)]",
};

function CountRow({
  icon,
  label,
  count,
  tone,
  href,
  active,
  passive,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: keyof typeof TONE_DOT;
  href: string;
  active?: boolean;
  /** Display-only count that doesn't toggle a filter. */
  passive?: boolean;
}) {
  const content = (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white font-bold text-zinc-900 shadow-soft ring-1 ring-zinc-200"
          : "text-zinc-700 hover:bg-white"
      }`}
    >
      <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
      <span className="text-zinc-500">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-xs font-bold text-zinc-500">{count}</span>
    </div>
  );
  if (passive) return <div aria-hidden>{content}</div>;
  return <Link href={href}>{content}</Link>;
}

function FilterRow({
  label,
  sub,
  active,
  href,
}: {
  label: string;
  sub?: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-[var(--color-brand-50)] font-bold text-[var(--color-brand-800)]"
          : "text-zinc-700 hover:bg-white"
      }`}
      aria-current={active ? "true" : undefined}
    >
      <span className="block truncate">{label}</span>
      {sub && <span className="block truncate text-[11px] text-zinc-400">{sub}</span>}
    </Link>
  );
}

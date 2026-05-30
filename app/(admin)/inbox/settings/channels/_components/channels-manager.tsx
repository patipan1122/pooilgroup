"use client";

// Client component — list connected inbox channels + add new connection form.
// Adapted from components/recruit/channels-manager.tsx with two additions:
//   1. a "ธุรกิจ" (businessTag) dropdown so each channel maps to a business
//   2. a bot on/off toggle per channel, shown only when channel.botCapable
//
// Webhook URL is shown with a copy button so the CEO can paste it into the
// LINE Developers Console / Facebook App webhook settings.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createChannel,
  deleteChannel,
  updateChannel,
  setChannelBotEnabled,
  type InboxPlatform,
} from "@/lib/inbox/channel-actions";
import { isBotCapable } from "@/lib/inbox/business";
import {
  Plus,
  Copy,
  Check,
  Trash2,
  MessageCircle,
  Globe,
  Key,
  Bot,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Channel {
  id: string;
  platform: InboxPlatform;
  displayName: string;
  businessTag: string | null;
  externalId: string | null;
  botEnabled: boolean;
  botCapable: boolean;
  status: string;
  lastEventAt: string | null;
  createdAt: string;
  hasProviderSecret: boolean;
  hasAccessToken: boolean;
  verifyToken: string | null;
}

interface Business {
  tag: string;
  label: string;
  botCapable: boolean;
}

const PLATFORM_META: Record<
  InboxPlatform,
  { label: string; color: string; icon: typeof MessageCircle }
> = {
  LINE: { label: "LINE OA", color: "bg-green-100 text-green-800 border-green-200", icon: MessageCircle },
  FACEBOOK: { label: "Facebook Page", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Globe },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  setup: { label: "กำลังตั้งค่า", color: "bg-amber-100 text-amber-800" },
  active: { label: "ใช้งานอยู่", color: "bg-green-100 text-green-800" },
  error: { label: "ผิดพลาด", color: "bg-red-100 text-red-700" },
  disabled: { label: "ปิดใช้", color: "bg-zinc-100 text-zinc-600" },
};

export function ChannelsManager({
  initialChannels,
  businesses,
}: {
  initialChannels: Channel[];
  businesses: Business[];
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, startAdd] = useTransition();
  const [platform, setPlatform] = useState<InboxPlatform>("LINE");
  const [displayName, setDisplayName] = useState("");
  const [businessTag, setBusinessTag] = useState(businesses[0]?.tag ?? "");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [providerSecret, setProviderSecret] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBusinessTag, setEditBusinessTag] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [editToken, setEditToken] = useState("");
  const [editExternalId, setEditExternalId] = useState("");
  const [savingEdit, startEdit] = useTransition();
  const [togglingId, startToggle] = useTransition();

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  function webhookUrl(c: Channel) {
    return `${baseUrl}/api/webhooks/inbox/${c.platform.toLowerCase()}/${c.id}`;
  }

  function businessLabelOf(tag: string | null): string {
    if (!tag) return "ไม่ระบุ";
    return businesses.find((b) => b.tag === tag)?.label ?? tag;
  }

  async function copyText(key: string, text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(`คัดลอก ${label} แล้ว`);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function add() {
    const name = displayName.trim();
    if (!name) {
      toast.error("ตั้งชื่อช่องทาง");
      return;
    }
    startAdd(async () => {
      try {
        const res = await createChannel({
          platform,
          displayName: name,
          businessTag: businessTag || undefined,
          externalId: externalId.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
          providerSecret: providerSecret.trim() || undefined,
        });
        toast.success(
          `เพิ่มช่องทาง "${name}" แล้ว · คัดลอก webhook URL ไปวางใน ${PLATFORM_META[platform].label}`,
        );
        setChannels((cs) => [
          {
            id: res.id,
            platform,
            displayName: name,
            businessTag: businessTag || null,
            externalId: externalId.trim() || null,
            botEnabled: false,
            botCapable: isBotCapable(businessTag),
            status: accessToken.trim() && providerSecret.trim() ? "active" : "setup",
            lastEventAt: null,
            createdAt: new Date().toISOString(),
            hasProviderSecret: !!providerSecret.trim(),
            hasAccessToken: !!accessToken.trim(),
            verifyToken: res.verifyToken,
          },
          ...cs,
        ]);
        setShowAdd(false);
        setDisplayName("");
        setExternalId("");
        setAccessToken("");
        setProviderSecret("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function startEditing(c: Channel) {
    setEditingId(c.id);
    setEditBusinessTag(c.businessTag ?? "");
    setEditSecret("");
    setEditToken("");
    setEditExternalId(c.externalId ?? "");
  }

  function saveEdit(c: Channel) {
    startEdit(async () => {
      try {
        await updateChannel(c.id, {
          businessTag: editBusinessTag !== (c.businessTag ?? "") ? editBusinessTag : undefined,
          providerSecret: editSecret.trim() || undefined,
          accessToken: editToken.trim() || undefined,
          externalId: editExternalId !== (c.externalId ?? "") ? editExternalId : undefined,
        });
        const nextHasSecret = !!editSecret.trim() || c.hasProviderSecret;
        const nextHasToken = !!editToken.trim() || c.hasAccessToken;
        const nextTag = editBusinessTag || null;
        const nextCapable = isBotCapable(editBusinessTag);
        setChannels((cs) =>
          cs.map((x) =>
            x.id === c.id
              ? {
                  ...x,
                  businessTag: nextTag,
                  botCapable: nextCapable,
                  // backend forces bot off if the new business can't run a bot
                  botEnabled: nextCapable ? x.botEnabled : false,
                  hasProviderSecret: nextHasSecret,
                  hasAccessToken: nextHasToken,
                  externalId: editExternalId.trim() || null,
                  status: nextHasSecret && nextHasToken ? "active" : "setup",
                }
              : x,
          ),
        );
        toast.success("บันทึกแล้ว");
        setEditingId(null);
        setEditSecret("");
        setEditToken("");
        setEditExternalId("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function toggleBot(c: Channel) {
    const next = !c.botEnabled;
    startToggle(async () => {
      try {
        await setChannelBotEnabled(c.id, next);
        setChannels((cs) => cs.map((x) => (x.id === c.id ? { ...x, botEnabled: next } : x)));
        toast.success(next ? "เปิดบอทตอบอัตโนมัติแล้ว" : "ปิดบอทแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function remove(c: Channel) {
    try {
      await deleteChannel(c.id);
      setChannels((cs) => cs.filter((x) => x.id !== c.id));
      toast.success("ลบแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-bold text-zinc-900">
          ช่องทางที่เชื่อม{" "}
          <span className="text-zinc-400 tabular-nums font-normal">({channels.length})</span>
        </p>
        <div className="flex items-center gap-2">
          {/* Kicks off FB OAuth → returns to /facebook-import picker.
              Plain anchor (full-page nav) because the OAuth dialog can't
              load inside a partial fetch. */}
          <a
            href="/api/inbox/facebook-oauth/start"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[#1877F2] px-3 h-10 rounded-xl hover:bg-[#0e5fc0]"
          >
            <Globe className="size-4" />
            เชื่อม Facebook (หลายเพจ)
          </a>
          {/* Backup path when FB OAuth dialog blocks the redirect — CEO
              pastes JSON from Graph API Explorer.  Same destination
              (bulk channel import), different on-ramp. */}
          <a
            href="/inbox/settings/channels/facebook-paste"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-700 bg-white border border-zinc-300 px-3 h-10 rounded-xl hover:bg-zinc-50"
            title="ใช้เมื่อ OAuth dialog ติด"
          >
            <Globe className="size-4" />
            Paste JSON
          </a>
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[var(--color-brand-600)] px-3 h-10 rounded-xl hover:bg-[var(--color-brand-700)]"
          >
            <Plus className="size-4" />
            เพิ่มทีละช่อง
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl border-2 border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-zinc-700 mb-1.5 block">ประเภทช่องทาง</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as InboxPlatform)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]"
              >
                <option value="LINE">LINE Official Account</option>
                <option value="FACEBOOK">Facebook Page</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
                ธุรกิจ <span className="text-red-500">*</span>
              </span>
              <select
                value={businessTag}
                onChange={(e) => setBusinessTag(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]"
              >
                {businesses.map((b) => (
                  <option key={b.tag} value={b.tag}>
                    {b.label}
                    {b.botCapable ? " (เปิดบอทได้)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              ชื่อเรียก (สำหรับทีมงาน) <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น เก้าอี้นวด LINE · เพจ Pooil ราชบุรี"
              className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]"
              maxLength={100}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              External ID (LINE basic ID / FB Page ID · ไม่บังคับ)
            </span>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={platform === "LINE" ? "@pooil-chair" : "102345678901234"}
              className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              {platform === "LINE" ? "LINE Channel Secret" : "Facebook App Secret"}{" "}
              <span className="text-red-500">*</span>
            </span>
            <input
              type="password"
              value={providerSecret}
              onChange={(e) => setProviderSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] font-mono"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              ใช้ตรวจสอบลายเซ็นของ webhook · จากหน้า{" "}
              {platform === "LINE"
                ? "LINE Developers Console → Messaging API → Channel secret"
                : "FB for Developers → Settings → Basic → App Secret (Show)"}
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              {platform === "LINE" ? "Channel Access Token (long-lived)" : "Page Access Token"}
            </span>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] font-mono"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              ใช้ส่งข้อความตอบกลับ · เก็บแบบเข้ารหัส (AES-256-GCM)
            </span>
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-sm font-bold text-zinc-700 px-3 h-10 rounded-lg hover:bg-zinc-100"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={add}
              disabled={adding || !displayName.trim()}
              className="text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-10 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {adding ? "กำลังเพิ่ม..." : "เพิ่มช่องทาง"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {channels.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500">
          <p className="font-bold text-zinc-900 mb-1">ยังไม่มีช่องทาง</p>
          <p>กด &ldquo;เพิ่มช่องทาง&rdquo; ด้านบนเพื่อเริ่มเชื่อม LINE OA หรือ Facebook Page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {channels.map((c) => {
            const meta = PLATFORM_META[c.platform];
            const statusMeta = STATUS_META[c.status] ?? STATUS_META.setup;
            const Icon = meta.icon;
            return (
              <div
                key={c.id}
                className="rounded-2xl border-2 border-zinc-200 bg-white p-4 hover:border-[var(--color-brand-300)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="size-10 rounded-xl bg-zinc-100 inline-flex items-center justify-center shrink-0">
                      <Icon className="size-5 text-zinc-700" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-zinc-900">{c.displayName}</p>
                        <span
                          className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.color}`}
                        >
                          {meta.label}
                        </span>
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
                          {businessLabelOf(c.businessTag)}
                        </span>
                        <span
                          className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${statusMeta.color}`}
                        >
                          {statusMeta.label}
                        </span>
                        {c.botCapable && c.botEnabled && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]">
                            <Bot className="size-3" />
                            บอทเปิด
                          </span>
                        )}
                      </div>
                      {c.externalId && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">ID: {c.externalId}</p>
                      )}
                      <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">
                        เพิ่มเมื่อ {new Date(c.createdAt).toLocaleDateString("th-TH")}
                        {c.lastEventAt &&
                          ` · ข้อความล่าสุด ${new Date(c.lastEventAt).toLocaleString("th-TH")}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ConfirmDialog
                      title={`ลบช่องทาง "${c.displayName}"?`}
                      body="ข้อความที่มาทางช่องทางนี้จะเชื่อมต่อไม่ได้อีก · ลบแล้วกู้คืนไม่ได้"
                      confirmLabel="ลบช่องทาง"
                      onConfirm={() => remove(c)}
                      trigger={
                        <button
                          type="button"
                          className="size-9 inline-flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="ลบช่องทาง"
                          aria-label={`ลบช่องทาง ${c.displayName}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      }
                    />
                  </div>
                </div>

                {/* Bot toggle — only for bot-capable channels */}
                {c.botCapable && (
                  <div className="mb-3 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40 p-3 flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <Bot className="size-4 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
                      <div className="text-xs text-zinc-700">
                        <p className="font-bold text-zinc-900">บอทตอบอัตโนมัติ</p>
                        <p className="text-[11px] text-zinc-500">
                          เมื่อเปิด บอทจะตอบลูกค้าด้วยคลังคำตอบใน /inbox/bot · ตอบไม่ได้จะส่งต่อทีมงาน
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBot(c)}
                      disabled={togglingId}
                      role="switch"
                      aria-checked={c.botEnabled}
                      // title attr alone doesn't announce — give the switch
                      // an explicit accessible name (audit CH-005).
                      aria-label={`บอทตอบอัตโนมัติ · ช่อง ${c.displayName} · ${
                        c.botEnabled ? "เปิดอยู่" : "ปิดอยู่"
                      }`}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        c.botEnabled ? "bg-[var(--color-brand-600)]" : "bg-zinc-300"
                      }`}
                      title={c.botEnabled ? "ปิดบอท" : "เปิดบอท"}
                    >
                      <span
                        className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                          c.botEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* Webhook URL */}
                <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 space-y-2">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 mb-1.5">
                      WEBHOOK URL — พาสต์เข้า {meta.label} settings:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 font-mono text-[11px] text-zinc-700 break-all">
                        {webhookUrl(c)}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(`url:${c.id}`, webhookUrl(c), "webhook URL")}
                        className="size-8 inline-flex items-center justify-center text-zinc-600 hover:text-[var(--color-brand-700)] hover:bg-white rounded-lg shrink-0"
                        title="คัดลอก URL"
                      >
                        {copiedKey === `url:${c.id}` ? (
                          <Check className="size-4 text-green-600" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* FB-only verify token */}
                  {c.platform === "FACEBOOK" && c.verifyToken && (
                    <div>
                      <p className="text-[10px] font-bold text-zinc-500 mb-1.5">
                        VERIFY TOKEN — วางในช่อง &ldquo;Verify Token&rdquo; ของ FB App webhook:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 font-mono text-[11px] text-zinc-700 break-all">
                          {c.verifyToken}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyText(`vt:${c.id}`, c.verifyToken ?? "", "verify token")}
                          className="size-8 inline-flex items-center justify-center text-zinc-600 hover:text-[var(--color-brand-700)] hover:bg-white rounded-lg shrink-0"
                          title="คัดลอก verify token"
                        >
                          {copiedKey === `vt:${c.id}` ? (
                            <Check className="size-4 text-green-600" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Secret status indicators */}
                  <div className="flex items-center gap-2 text-[10px] flex-wrap pt-1 border-t border-zinc-200">
                    <SecretStatusChip
                      ok={c.hasProviderSecret}
                      label={c.platform === "LINE" ? "Channel Secret" : "App Secret"}
                    />
                    <SecretStatusChip
                      ok={c.hasAccessToken}
                      label={c.platform === "LINE" ? "Access Token" : "Page Token"}
                    />
                    <button
                      type="button"
                      onClick={() => (editingId === c.id ? setEditingId(null) : startEditing(c))}
                      className="text-[10px] text-[var(--color-brand-700)] hover:underline ml-auto inline-flex items-center gap-1"
                    >
                      <Key className="size-3" />
                      {editingId === c.id ? "ยกเลิก" : "แก้ไข / ใส่ secret"}
                    </button>
                  </div>

                  {/* Inline edit form */}
                  {editingId === c.id && (
                    <div className="space-y-2 pt-2 border-t border-zinc-200">
                      <label className="block">
                        <span className="text-[10px] font-bold text-zinc-600 mb-1 block">ธุรกิจ</span>
                        <select
                          value={editBusinessTag}
                          onChange={(e) => setEditBusinessTag(e.target.value)}
                          className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-xs"
                        >
                          <option value="">ไม่ระบุ</option>
                          {businesses.map((b) => (
                            <option key={b.tag} value={b.tag}>
                              {b.label}
                              {b.botCapable ? " (เปิดบอทได้)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold text-zinc-600 mb-1 block">
                          {c.platform === "LINE" ? "LINE Channel Secret" : "FB App Secret"} (ว่างไว้ = ไม่เปลี่ยน)
                        </span>
                        <input
                          type="password"
                          value={editSecret}
                          onChange={(e) => setEditSecret(e.target.value)}
                          placeholder={c.hasProviderSecret ? "•••• already set ••••" : "paste secret here"}
                          className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] font-mono text-xs"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold text-zinc-600 mb-1 block">
                          {c.platform === "LINE" ? "Channel Access Token" : "Page Access Token"} (ว่างไว้ = ไม่เปลี่ยน)
                        </span>
                        <input
                          type="password"
                          value={editToken}
                          onChange={(e) => setEditToken(e.target.value)}
                          placeholder={c.hasAccessToken ? "•••• already set ••••" : "paste token here"}
                          className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] font-mono text-xs"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold text-zinc-600 mb-1 block">External ID</span>
                        <input
                          type="text"
                          value={editExternalId}
                          onChange={(e) => setEditExternalId(e.target.value)}
                          placeholder={c.platform === "LINE" ? "@pooil-chair" : "102345678901234"}
                          className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] font-mono text-xs"
                        />
                      </label>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs font-bold text-zinc-700 px-3 h-9 rounded-lg hover:bg-zinc-100"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(c)}
                          disabled={savingEdit}
                          className="text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 h-9 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
                        >
                          {savingEdit ? "กำลังบันทึก..." : "บันทึก"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SecretStatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
        ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-green-600" : "bg-amber-600"}`} />
      {label}: {ok ? "✓" : "ยังไม่ใส่"}
    </span>
  );
}

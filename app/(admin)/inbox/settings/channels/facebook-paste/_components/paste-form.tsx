"use client";

// Two-stage form: (1) paste JSON + parse, (2) pick businesses + import.
// Keeps tokens in the same browser/memory only until the server action
// fires, which encrypts them with channel-crypto before persisting.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckSquare,
  Square,
  Loader2,
  Sparkles,
  ClipboardPaste,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import {
  bulkImportFacebookFromPlaintext,
  fetchFacebookPagesFromUserToken,
} from "@/lib/inbox/channel-actions";
import type { InboxBusiness } from "@/lib/inbox/business";

interface ParsedPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
}

interface Selection {
  selected: boolean;
  businessTag: string;
}

const DEFAULT_BUSINESS = "other";

// Heuristic: guess a sensible business tag from the page name / category.
// CEO can override per-row before submitting; this just saves clicks for
// obvious cases (e.g., Owl Cha rows → owl_cha, Cafe Amazon → fnb).
function guessBusiness(name: string, category?: string): string {
  const n = name.toLowerCase();
  const c = (category ?? "").toLowerCase();
  if (/owl ?cha|hamcharo|dinocha|pearly tea|j['"]s favs/i.test(name)) {
    return "owl_cha";
  }
  if (/pim ?gas|po[- ]?oil|พีโอออยล์|ขายส่งน้ำมัน|ถังแก๊ส/i.test(name)) {
    return "pooil";
  }
  if (/โรงแรม|hotel|hospitality/i.test(name) || c.includes("โรงแรม")) {
    return "hotel";
  }
  if (
    /swensen|cafe.?amazon|กาแฟ|amazon|coffee|ซูชิ|mr\.?woof|quick service|tiny food/i.test(
      name,
    ) ||
    c.includes("ร้านอาหาร") ||
    c.includes("คาเฟ่") ||
    c.includes("ร้านกาแฟ") ||
    c.includes("ร้านชานมไข่มุก") ||
    c.includes("ร้านไอศกรีม") ||
    c.includes("ร้านเบเกอรี่")
  ) {
    return "fnb";
  }
  if (/jolly ?play|selfie|fast delivery/i.test(name) || c.includes("เกม")) {
    return "playland";
  }
  if (/aeke|salon|ความงาม/i.test(name) || c.includes("ความงาม")) {
    return "fnb"; // services bucket
  }
  if (
    /fiction|note twit|joker|years|hrk|ROV|LoL/i.test(n) ||
    c.includes("เว็บบล็อก") ||
    c.includes("ศิลปะ") ||
    c.includes("นักเขียน") ||
    c.includes("เกมเมอร์") ||
    c.includes("ครีเอเตอร์")
  ) {
    return "personal";
  }
  return DEFAULT_BUSINESS;
}

export function PasteImportForm({
  businesses,
}: {
  businesses: InboxBusiness[];
}) {
  const [mode, setMode] = useState<"token" | "json">("token");
  const [userToken, setUserToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [fetching, startFetch] = useTransition();
  const [raw, setRaw] = useState("");
  const [pages, setPages] = useState<ParsedPage[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, Selection>>({});
  const [bulkTag, setBulkTag] = useState<string>("");
  const [submitting, startSubmit] = useTransition();
  const router = useRouter();

  // Shared: once we have a page list (from either path) populate the picker.
  function loadPicker(valid: ParsedPage[]) {
    setPages(valid);
    const init: Record<string, Selection> = {};
    for (const p of valid) {
      init[p.id] = {
        selected: true,
        businessTag: guessBusiness(p.name, p.category),
      };
    }
    setSel(init);
  }

  // Preferred path: paste one user token → server upgrades to long-lived +
  // fetches pages with PERMANENT tokens.
  function fetchByToken() {
    setTokenError(null);
    if (!userToken.trim()) return;
    startFetch(async () => {
      try {
        const res = await fetchFacebookPagesFromUserToken({ userToken });
        setPermanent(res.longLived);
        loadPicker(res.pages);
        toast.success(
          `ดึง ${res.pages.length} เพจสำเร็จ` +
            (res.longLived ? " · token ถาวร ✓" : ""),
        );
      } catch (e) {
        setTokenError((e as Error).message || "ดึงเพจไม่สำเร็จ");
      }
    });
  }

  function parse() {
    setParseError(null);
    try {
      const data = JSON.parse(raw) as { data?: ParsedPage[] };
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("JSON ไม่มีฟิลด์ data[] · ต้อง paste response จาก /me/accounts");
      }
      const valid = data.data.filter(
        (p) => p.id && p.name && p.access_token,
      );
      if (valid.length === 0) {
        throw new Error("ไม่พบเพจในรูปแบบที่ถูกต้อง");
      }
      setPermanent(false); // raw page tokens — may be short-lived
      loadPicker(valid);
      toast.success(`อ่าน ${valid.length} เพจสำเร็จ`);
    } catch (e) {
      setParseError((e as Error).message);
      setPages(null);
    }
  }

  const selectedCount = useMemo(
    () => Object.values(sel).filter((s) => s.selected).length,
    [sel],
  );

  function toggleAll(value: boolean) {
    setSel((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) next[id] = { ...next[id], selected: value };
      return next;
    });
  }

  function applyBulkTag() {
    if (!bulkTag) return;
    setSel((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id].selected) next[id] = { ...next[id], businessTag: bulkTag };
      }
      return next;
    });
    toast.success(`ตั้งธุรกิจให้ ${selectedCount} เพจ`);
  }

  function submit() {
    if (!pages) return;
    const chosen = pages
      .filter((p) => sel[p.id]?.selected)
      .map((p) => ({
        id: p.id,
        name: p.name,
        accessToken: p.access_token,
        businessTag: sel[p.id]?.businessTag || DEFAULT_BUSINESS,
      }));
    if (chosen.length === 0) {
      toast.error("ติ๊กอย่างน้อย 1 เพจก่อน");
      return;
    }
    startSubmit(async () => {
      try {
        const res = await bulkImportFacebookFromPlaintext({ pages: chosen });
        const parts: string[] = [];
        if (res.created) parts.push(`สร้างใหม่ ${res.created}`);
        if (res.updated) parts.push(`อัปเดต ${res.updated}`);
        if (res.subscribed) parts.push(`subscribe webhook ${res.subscribed}`);
        toast.success(parts.join(" · ") || "เสร็จแล้ว");
        if (res.errors.length > 0) {
          toast.warning(`${res.errors.length} เพจไม่สำเร็จ — ดู console`);
          console.warn("[fb-paste errors]", res.errors);
        }
        router.push("/inbox/settings/channels");
      } catch (e) {
        toast.error((e as Error).message || "นำเข้าไม่สำเร็จ");
      }
    });
  }

  if (!pages) {
    return (
      <div className="space-y-4">
        {/* Mode switch */}
        <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setMode("token")}
            className={`rounded-lg px-3 py-1.5 ${
              mode === "token"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            วางกุญแจหลัก · แนะนำ
          </button>
          <button
            type="button"
            onClick={() => setMode("json")}
            className={`rounded-lg px-3 py-1.5 ${
              mode === "json"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500"
            }`}
          >
            วาง JSON · ขั้นสูง
          </button>
        </div>

        {mode === "token" && (
          <>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-900">
              <p className="mb-2 flex items-center gap-1.5 font-bold text-emerald-950">
                <ShieldCheck className="size-4" />
                วิธีนี้ token ไม่หมดอายุ (ระบบยืดเป็น 60 วัน + ดึงเพจถาวรให้เอง)
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  เปิด{" "}
                  <a
                    href="https://developers.facebook.com/tools/explorer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-800 underline"
                  >
                    Graph API Explorer
                  </a>{" "}
                  · มุมขวาบนเลือก App = <b>Pooil Inbox Connector</b>
                </li>
                <li>
                  กด <b>"Generate Access Token"</b> · ติ๊กสิทธิ์{" "}
                  <span className="font-mono text-[10px]">pages_show_list</span>,{" "}
                  <span className="font-mono text-[10px]">pages_messaging</span>,{" "}
                  <span className="font-mono text-[10px]">
                    pages_manage_metadata
                  </span>
                  ,{" "}
                  <span className="font-mono text-[10px]">
                    pages_read_engagement
                  </span>{" "}
                  · ตอนเด้งถามเพจให้กด <b>เลือกทั้งหมด</b>
                </li>
                <li>
                  copy <b>Access Token</b> (ก้อนยาวๆ ในช่องบนสุด) มาวางด้านล่าง ·
                  ไม่ต้องพิมพ์คำสั่ง ไม่ต้อง copy JSON
                </li>
              </ol>
            </div>

            <textarea
              value={userToken}
              onChange={(e) => setUserToken(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="EAAB... (Access Token จาก Graph API Explorer)"
              className="w-full resize-y rounded-2xl border border-zinc-300 bg-white p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />

            {tokenError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="font-bold">ดึงเพจไม่ได้</p>
                <p>{tokenError}</p>
              </div>
            )}

            <button
              type="button"
              onClick={fetchByToken}
              disabled={!userToken.trim() || fetching}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {fetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              ยืดอายุ + ดึงเพจ
            </button>
          </>
        )}

        {mode === "json" && (
          <>
        {/* Step-by-step explainer */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-700">
          <p className="mb-2 font-bold text-zinc-900">
            วิธีหา JSON (3 ขั้น · ~2 นาที):
          </p>
          <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            ⚠️ วิธีนี้ token เพจอาจหมดอายุใน ~1 ชม. ถ้าไม่ได้ยืดอายุก่อน —
            ถ้าไม่แน่ใจให้ใช้ "วางกุญแจหลัก" ด้านบนแทน
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              เปิด{" "}
              <a
                href="https://developers.facebook.com/tools/explorer"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-brand-700)] underline"
              >
                Graph API Explorer
              </a>{" "}
              · มุมขวาบนเลือก App = <b>Pooil Inbox Connector</b>
            </li>
            <li>
              กดปุ่ม <b>"Generate Access Token"</b> · ติ๊ก permissions:
              <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px]">
                pages_show_list
              </span>
              <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px]">
                pages_messaging
              </span>
              <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px]">
                pages_manage_metadata
              </span>
              <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[10px]">
                pages_read_engagement
              </span>
            </li>
            <li>
              ในช่อง URL พิมพ์{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                me/accounts?fields=id,name,access_token,category&limit=200
              </code>{" "}
              · กด <b>Submit</b> · copy <b>ทั้ง JSON</b> มาวางด้านล่าง
            </li>
          </ol>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder='{"data": [{"id": "...", "name": "...", "access_token": "...", "category": "..."}], "paging": {...}}'
          className="w-full resize-y rounded-2xl border border-zinc-300 bg-white p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
        />

        {parseError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-bold">อ่าน JSON ไม่ได้</p>
            <p>{parseError}</p>
          </div>
        )}

        <button
          type="button"
          onClick={parse}
          disabled={!raw.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
        >
          <ClipboardPaste className="size-4" />
          อ่าน JSON · เลือกเพจ
        </button>
          </>
        )}
      </div>
    );
  }

  // STAGE 2 — picker
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
        <p>
          อ่านได้ <b>{pages.length}</b> เพจ · ผมเดาธุรกิจให้แล้วตามชื่อ + category
          (Owl Cha → Owl Cha · กาแฟ/ขนม → ร้านอาหาร · พีโอ → Pooil · ฯลฯ) ·
          แก้ได้ทุกแถว
        </p>
        {permanent ? (
          <p className="mt-1 flex items-center gap-1 font-bold text-emerald-950">
            <ShieldCheck className="size-3.5" />
            token ถาวร — ไม่หมดอายุ ✓
          </p>
        ) : (
          <p className="mt-1 text-amber-700">
            ⚠️ token เพจชุดนี้อาจหมดอายุใน ~1 ชม. (มาจากการวาง JSON) —
            ถ้าอยากให้ถาวรให้กลับไปใช้ "วางกุญแจหลัก"
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <button
          type="button"
          onClick={() => toggleAll(true)}
          className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
        >
          เลือกทั้งหมด
        </button>
        <button
          type="button"
          onClick={() => toggleAll(false)}
          className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
        >
          ล้าง
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs"
          >
            <option value="">เลือกธุรกิจ...</option>
            {businesses.map((b) => (
              <option key={b.tag} value={b.tag}>
                {b.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkTag}
            disabled={!bulkTag || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-800 hover:bg-zinc-200 disabled:opacity-40"
          >
            <Sparkles className="size-3.5" />
            ตั้งธุรกิจให้ที่ติ๊กไว้
          </button>
        </div>
        <span className="basis-full text-[11px] text-zinc-500">
          ติ๊กไว้ {selectedCount} / {pages.length} เพจ
        </span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white">
        <ul className="divide-y divide-zinc-100">
          {pages.map((p) => {
            const s = sel[p.id] || { selected: false, businessTag: DEFAULT_BUSINESS };
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setSel((prev) => ({
                      ...prev,
                      [p.id]: { ...s, selected: !s.selected },
                    }))
                  }
                  className="text-[var(--color-brand-600)]"
                >
                  {s.selected ? (
                    <CheckSquare className="size-5" />
                  ) : (
                    <Square className="size-5 text-zinc-300" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-900">
                    {p.name}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    Page ID: {p.id}
                    {p.category ? ` · ${p.category}` : ""}
                  </p>
                </div>
                <select
                  value={s.businessTag}
                  onChange={(e) =>
                    setSel((prev) => ({
                      ...prev,
                      [p.id]: { ...s, businessTag: e.target.value },
                    }))
                  }
                  disabled={!s.selected}
                  className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs disabled:opacity-50"
                >
                  {businesses.map((b) => (
                    <option key={b.tag} value={b.tag}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setPages(null);
            setSel({});
            setBulkTag("");
          }}
          className="text-xs text-zinc-600 hover:underline"
        >
          ← แก้ JSON ใหม่
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || selectedCount === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-40"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          นำเข้า {selectedCount} เพจ
        </button>
      </div>
    </div>
  );
}

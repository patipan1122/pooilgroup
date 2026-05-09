"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  Bell,
  Info,
  AlertTriangle,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { bkkRelative } from "@/lib/utils/format";

interface Notification {
  id: string;
  type: "info" | "warning" | "danger" | "success";
  module: string | null;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON = {
  info: Info,
  warning: AlertTriangle,
  danger: CircleAlert,
  success: CheckCircle2,
};

const TYPE_COLOR = {
  info: "text-blue-600 bg-blue-50",
  warning: "text-amber-600 bg-amber-50",
  danger: "text-red-600 bg-red-50",
  success: "text-green-600 bg-green-50",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const lastFetch = useRef(0);

  async function load() {
    if (Date.now() - lastFetch.current < 5_000) return;
    lastFetch.current = Date.now();
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.notifications ?? []);
      setUnread(json.unread ?? 0);
    } finally {
      setLoading(false);
    }
  }

  // Initial load + 60s poll
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  // Reload on open (force refresh)
  useEffect(() => {
    if (open) {
      lastFetch.current = 0;
      void load();
    }
  }, [open]);

  async function markAllRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  }

  async function markOneRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-zinc-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-danger)] text-white text-[10px] font-bold border-2 border-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border-2 border-zinc-200 shadow-pop z-20 max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b-2 border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold font-display">การแจ้งเตือน</h3>
                {unread > 0 && (
                  <p className="text-xs text-zinc-500">
                    {unread} รายการยังไม่อ่าน
                  </p>
                )}
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs text-[var(--color-brand-700)] font-semibold hover:underline"
                >
                  อ่านทั้งหมด
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {loading && items.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-400">
                  กำลังโหลด...
                </div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-400">
                  <Bell className="size-8 text-zinc-300 mx-auto mb-2" />
                  ยังไม่มีการแจ้งเตือน
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {items.map((n) => {
                    const Icon = TYPE_ICON[n.type];
                    const colorCls = TYPE_COLOR[n.type];
                    const inner = (
                      <>
                        <div
                          className={cn(
                            "size-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                            colorCls,
                          )}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold truncate">
                              {n.title}
                            </p>
                            {!n.is_read && (
                              <span className="size-2 rounded-full bg-[var(--color-brand-600)] mt-1.5 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-zinc-600 mt-0.5 line-clamp-2">
                            {n.body}
                          </p>
                          <p className="text-[10px] text-zinc-400 mt-1">
                            {bkkRelative(n.created_at)}
                          </p>
                        </div>
                      </>
                    );

                    const handleClick = () => {
                      if (!n.is_read) void markOneRead(n.id);
                      setOpen(false);
                    };

                    return (
                      <li key={n.id}>
                        {n.link ? (
                          <Link
                            href={n.link}
                            onClick={handleClick}
                            className={cn(
                              "flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors",
                              !n.is_read && "bg-[var(--color-brand-50)]/40",
                            )}
                          >
                            {inner}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={handleClick}
                            className={cn(
                              "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors",
                              !n.is_read && "bg-[var(--color-brand-50)]/40",
                            )}
                          >
                            {inner}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {items.length > 0 && (
              <div className="px-4 py-2.5 border-t border-zinc-100 text-center">
                <Link
                  href="/profile"
                  onClick={() => setOpen(false)}
                  className="text-xs text-zinc-500 hover:text-[var(--color-brand-700)]"
                >
                  ตั้งค่าการแจ้งเตือนที่โปรไฟล์
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

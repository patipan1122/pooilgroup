"use client";

// Cmd+K command palette — glues every Playland feature together
// Search members · jump to pages · run quick actions (open shift / check-out)
//
// Per memory ceo-prefers-multi-pane-workspace: never make user navigate to
// find something — give them a global search that goes anywhere.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ScanFace, ShoppingBasket, Clock, BarChart3, Tv, Settings, CalendarClock, Users, Activity, History } from "lucide-react";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  action: () => void;
  shortcut?: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [members, setMembers] = useState<Array<{ id: string; name: string; phone: string | null; memberCode: string | null }>>([]);
  const [, startSearch] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Toggle on Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  // Live member search (debounced)
  useEffect(() => {
    if (!query.trim() || query.length < 2) { setMembers([]); return; }
    const t = setTimeout(() => {
      startSearch(async () => {
        try {
          const res = await fetch(`/api/playland/search?q=${encodeURIComponent(query.trim())}`);
          const data = await res.json();
          if (data.ok) setMembers(data.members ?? []);
        } catch {/* noop */}
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const nav = (path: string) => () => { setOpen(false); router.push(path); };

  const baseCommands: Command[] = [
    { id: "go-workspace", label: "Cashier Workspace", hint: "หน้าหลัก · register · check-in · POS", group: "ไปยัง", icon: <Activity size={16} />, action: nav("/playland") },
    { id: "go-monitor", label: "Live Monitor", hint: "ตาราง real-time", group: "ไปยัง", icon: <Tv size={16} />, action: nav("/playland/monitor") },
    { id: "go-monitor-tv", label: "Live Monitor (TV mode)", hint: "หน้าจอใหญ่หลังเคาน์เตอร์", group: "ไปยัง", icon: <Tv size={16} />, action: nav("/playland/monitor?tv=1") },
    { id: "go-members", label: "สมาชิกทั้งหมด", group: "ไปยัง", icon: <Users size={16} />, action: nav("/playland/members") },
    { id: "go-bookings", label: "การจองวันนี้", group: "ไปยัง", icon: <CalendarClock size={16} />, action: nav("/playland/bookings") },
    { id: "go-pos", label: "POS ขายของ", group: "ไปยัง", icon: <ShoppingBasket size={16} />, action: nav("/playland/pos") },
    { id: "go-shifts", label: "เปิด/ปิดกะ · ปิดวัน", group: "ไปยัง", icon: <Clock size={16} />, action: nav("/playland/shifts") },
    { id: "go-reports", label: "รายงาน · CSV", group: "ไปยัง", icon: <BarChart3 size={16} />, action: nav("/playland/reports") },
    { id: "go-audit", label: "Audit Log", group: "ไปยัง", icon: <History size={16} />, action: nav("/playland/audit") },
    { id: "go-settings", label: "ตั้งค่า Playland", group: "ไปยัง", icon: <Settings size={16} />, action: nav("/playland/settings") },
    { id: "action-register", label: "ลงทะเบียนสมาชิกใหม่", hint: "ถ่ายรูปหน้า + เลือก package + ชำระเงิน", group: "การกระทำ", icon: <ScanFace size={16} />, action: nav("/playland") },
  ];

  const q = query.trim().toLowerCase();
  const filteredCommands = q
    ? baseCommands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q))
    : baseCommands;

  const memberItems = members.map((m) => ({
    id: `m-${m.id}`,
    label: m.name,
    hint: [m.phone, m.memberCode].filter(Boolean).join(" · "),
    group: "สมาชิก",
    icon: <ScanFace size={16} />,
    action: nav(`/playland/members?selected=${m.id}`),
  }));

  const allItems = [...memberItems, ...filteredCommands];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, allItems.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); allItems[active]?.action(); }
  }

  // Group items
  const groups = allItems.reduce<Record<string, typeof allItems>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});

  let idx = 0;
  return (
    <>
      {open && (
        <div className="pl-cmdk-overlay" onClick={() => setOpen(false)}>
          <div className="pl-cmdk" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="pl-cmdk-input"
              placeholder="ค้นหา หรือ พิมพ์คำสั่ง..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
            />
            <div className="pl-cmdk-list">
              {allItems.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--pl-text-muted)", fontSize: 14 }}>
                  ไม่พบรายการ
                </div>
              ) : Object.entries(groups).map(([group, items]) => (
                <div key={group}>
                  <div className="pl-cmdk-group-label">{group}</div>
                  {items.map((it) => {
                    const i = idx++;
                    return (
                      <div
                        key={it.id}
                        className={`pl-cmdk-item ${active === i ? "is-active" : ""}`}
                        onClick={it.action}
                        onMouseEnter={() => setActive(i)}
                      >
                        <span style={{ color: "var(--pl-text-muted)" }}>{it.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{it.label}</div>
                          {it.hint && <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginTop: 1 }}>{it.hint}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ padding: "8px 16px", borderTop: "1px solid var(--pl-line)", fontSize: 11, color: "var(--pl-text-muted)", display: "flex", gap: 12, fontFamily: "var(--pl-font-mono)" }}>
              <span><span className="pl-kbd">↑↓</span> เลือก</span>
              <span><span className="pl-kbd">↵</span> เปิด</span>
              <span><span className="pl-kbd">esc</span> ปิด</span>
              <span style={{ marginLeft: "auto" }}><span className="pl-kbd">⌘K</span> เปิด/ปิด</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

// Mobile-only tab switcher for the cockpit 3-pane layout
// On phone (≤599px): show ONE pane at a time · tabs swap which is active
// Toggles the `.pl-pane-show-mobile` class on each pane via DOM (panes already
// in the DOM from server render · we just show/hide)
// Hidden on tablet+ via CSS media query

"use client";
import { useEffect, useState } from "react";
import { ScanFace, Users, Bell } from "lucide-react";

type Tab = "register" | "list" | "alerts";

interface Props {
  alertCount: number;
  inRoomCount: number;
}

export function MobileCockpitTabs({ alertCount, inRoomCount }: Props) {
  const [active, setActive] = useState<Tab>("register");

  useEffect(() => {
    // Find the 3 panes in the cockpit's pl-three-pane container
    const panes = document.querySelectorAll(".pl-three-pane > .pl-pane");
    if (panes.length < 3) return;
    const [left, center, right] = [panes[0], panes[1], panes[2]];

    const apply = () => {
      // center is the form · always shown in mobile when register tab
      [left, center, right].forEach((p) => p.classList.remove("pl-pane-show-mobile"));
      if (active === "register") center.classList.add("pl-pane-show-mobile");
      if (active === "list") left.classList.add("pl-pane-show-mobile");
      if (active === "alerts") right.classList.add("pl-pane-show-mobile");
    };
    apply();
    return () => {
      [left, center, right].forEach((p) => p.classList.remove("pl-pane-show-mobile"));
    };
  }, [active]);

  return (
    <div
      className="pl-mobile-cockpit-tabs"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 25,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        background: "var(--pl-paper)",
        borderBottom: "1px solid var(--pl-line)",
        padding: "4px",
        gap: 4,
      }}
    >
      <TabBtn active={active === "register"} onClick={() => setActive("register")} icon={<ScanFace size={16} />} label="ลงทะเบียน" />
      <TabBtn active={active === "list"}     onClick={() => setActive("list")}     icon={<Users size={16} />}   label="ในร้าน" count={inRoomCount} />
      <TabBtn active={active === "alerts"}   onClick={() => setActive("alerts")}   icon={<Bell size={16} />}    label="แจ้งเตือน" count={alertCount} accent={alertCount > 0} />
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count, accent }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 2, padding: "8px 4px",
        background: active ? "var(--pl-amber-100)" : "transparent",
        border: "none",
        borderRadius: "var(--pl-r-md)",
        color: active ? "var(--pl-amber-900)" : "var(--pl-text-muted)",
        fontWeight: active ? 700 : 500,
        fontSize: 12,
        cursor: "pointer",
        position: "relative",
        minHeight: 44,
      }}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          style={{
            position: "absolute", top: 4, right: "calc(50% - 22px)",
            background: accent ? "var(--pl-danger)" : "var(--pl-amber-500)",
            color: "white", fontSize: 9, fontWeight: 700,
            borderRadius: 999, padding: "1px 5px",
            minWidth: 16, textAlign: "center",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

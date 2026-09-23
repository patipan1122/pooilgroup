// DocuFlow · Top Banner (canvas TopBar element)
// ────────────────────────────────────────────────────────────────────
// Slim breadcrumb header rendered at the top of each docuflow page.
// Mimics the canvas `df-topbar` element with brand mark + breadcrumb +
// search hint + bell. The breadcrumb/search chrome is desktop-only
// (hidden below 768px — bottom nav takes over on mobile), but the
// notification bell is extracted into its own standalone floating
// button rendered as a sibling of `.df-topbanner`, shown only below
// 768px (mirror of the desktop-hide rule) so notifications stay
// reachable on mobile too.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ChevronRight, Search, Bell } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function DfTopBanner({
  breadcrumbs,
  actions,
}: {
  breadcrumbs: BreadcrumbItem[];
  actions?: React.ReactNode;
}) {
  return (
    <>
    <div
      className="df-topbanner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 16px",
        marginBottom: 18,
        background: "var(--df-surface)",
        border: "1px solid var(--df-line)",
        borderRadius: 12,
      }}
    >
      {/* Breadcrumb */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--df-muted)",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Link
          href="/docuflow"
          style={{
            color: "var(--df-brand)",
            fontWeight: 700,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          DocuFlow
        </Link>
        <ChevronRight size={12} style={{ color: "var(--df-muted-2)" }} />
        {breadcrumbs.map((b, i) => {
          const last = i === breadcrumbs.length - 1;
          return (
            <span
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              {b.href && !last ? (
                <Link
                  href={b.href}
                  style={{
                    color: "var(--df-muted)",
                    textDecoration: "none",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.label}
                </Link>
              ) : (
                <span
                  style={{
                    color: last ? "var(--df-ink)" : "var(--df-muted)",
                    fontWeight: last ? 600 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.label}
                </span>
              )}
              {!last && (
                <ChevronRight size={12} style={{ color: "var(--df-muted-2)", flexShrink: 0 }} />
              )}
            </span>
          );
        })}
      </div>

      {/* Search shortcut hint */}
      <Link
        href="/docuflow/search"
        className="df-topbanner-search"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 14px",
          background: "var(--df-bg-warm)",
          borderRadius: 999,
          color: "var(--df-muted)",
          fontSize: 13,
          textDecoration: "none",
          minWidth: 220,
          flexShrink: 0,
        }}
      >
        <Search size={14} />
        <span style={{ flex: 1 }}>ค้นหาเอกสาร · กด K</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--df-muted-2)",
            padding: "2px 6px",
            border: "1px solid var(--df-line)",
            borderRadius: 4,
            background: "var(--df-surface)",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          ⌘K
        </span>
      </Link>

      <Link
        href="/docuflow/notifications"
        className="df-btn df-btn-ghost df-btn-icon"
        aria-label="การแจ้งเตือน"
        style={{
          padding: 8,
          flexShrink: 0,
        }}
      >
        <Bell size={16} />
      </Link>

      {actions}
      <style>{`
        @media (max-width: 768px) {
          .df-topbanner { display: none !important; }
        }
        @media (max-width: 1100px) {
          .df-topbanner-search { display: none !important; }
        }
      `}</style>
    </div>

    {/* Mobile-only notification bell — sibling of .df-topbanner (which is
        entirely hidden below 768px). Fixed floating circular button in the
        top-right corner, same shadow/elevation/z-index conventions as the
        floating primary upload button in df-mobile-nav.tsx, so it reads as
        part of the same mobile chrome language. */}
    <Link
      href="/docuflow/notifications"
      className="df-topbanner-mobile-bell"
      aria-label="การแจ้งเตือน"
      style={{
        position: "fixed",
        top: "max(12px, env(safe-area-inset-top))",
        right: 16,
        zIndex: 40,
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: "var(--df-surface)",
        border: "1px solid var(--df-line)",
        color: "var(--df-ink)",
        boxShadow: "0 6px 16px -4px rgba(30,58,255,0.35)",
      }}
    >
      <Bell size={18} />
      <style>{`
        @media (max-width: 768px) {
          .df-topbanner-mobile-bell { display: flex !important; }
        }
      `}</style>
    </Link>
    </>
  );
}

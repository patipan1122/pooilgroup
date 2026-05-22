// DocuFlow · Calendar (DesktopCalendar canvas)
// ────────────────────────────────────────────────────────────────────
// Full month grid · events from document_renewals · color-coded by status ·
// "today" highlight · side panel with upcoming events + legend.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Download,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar as CalendarIcon,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { loadRenewals } from "@/lib/docuflow/data";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const WEEK_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

interface SP {
  m?: string;
  y?: string;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;

  const sp = await searchParams;
  const now = new Date();
  const year = parseInt(sp.y ?? String(now.getFullYear()), 10);
  const month = parseInt(sp.m ?? String(now.getMonth()), 10);

  const renewals = await loadRenewals(orgId, { withinDays: 365 });

  // Build calendar grid
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() === month;
  const today = now.getDate();

  // Group events by day
  const eventsByDay = new Map<number, typeof renewals>();
  for (const r of renewals) {
    const d = new Date(r.expiryDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      const list = eventsByDay.get(day) ?? [];
      list.push(r);
      eventsByDay.set(day, list);
    }
  }

  // Upcoming (current month, not yet passed)
  const upcoming = renewals
    .filter((r) => {
      const d = new Date(r.expiryDate);
      const ref = isCurrentMonth ? now : new Date(year, month, 1);
      return d >= ref;
    })
    .slice(0, 6);

  // Prev / next month nav
  const prevM = month === 0 ? 11 : month - 1;
  const prevY = month === 0 ? year - 1 : year;
  const nextM = month === 11 ? 0 : month + 1;
  const nextY = month === 11 ? year + 1 : year;

  const monthLabel = new Date(year, month, 1).toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
  });

  const todayEvents = isCurrentMonth ? eventsByDay.get(today) ?? [] : [];

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "ปฏิทินวันหมดอายุ" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>ปฏิทินวันหมดอายุ</DfEyebrow>}
        title={
          <>
            <span style={{ color: "var(--df-muted)" }}>{monthLabel}</span>
          </>
        }
        description={`${renewals.length} เอกสารต้องจัดการในช่วง 365 วันข้างหน้า`}
        actions={
          <>
            <DfButton variant="ghost">
              <Download size={14} />
              Export
            </DfButton>
            <DfButton variant="brand">
              <Bell size={14} />
              เพิ่ม Google Cal
            </DfButton>
          </>
        }
      />

      {/* Month nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <DfButton
          href={`/docuflow/calendar?m=${prevM}&y=${prevY}`}
          variant="ghost"
          iconOnly
        >
          <ChevronLeft size={14} />
        </DfButton>
        <DfButton
          href="/docuflow/calendar"
          variant="ghost"
          size="sm"
        >
          วันนี้
        </DfButton>
        <DfButton
          href={`/docuflow/calendar?m=${nextM}&y=${nextY}`}
          variant="ghost"
          iconOnly
        >
          <ChevronRight size={14} />
        </DfButton>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
          gap: 20,
        }}
        className="df-grid-2col"
      >
        {/* LEFT — calendar grid */}
        <DfCard padding={0} className="df-fade-up df-fade-up-100">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              background: "var(--df-surface-soft)",
              borderBottom: "1px solid var(--df-line)",
            }}
          >
            {WEEK_DAYS.map((d) => (
              <div
                key={d}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                }}
              >
                {d}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
            }}
          >
            {Array.from({ length: firstDow }).map((_, i) => (
              <div
                key={`empty-${i}`}
                style={{
                  minHeight: 110,
                  borderRight:
                    i % 7 !== 6 ? "1px solid var(--df-line-soft)" : "none",
                  borderBottom: "1px solid var(--df-line-soft)",
                  background: "var(--df-surface)",
                  opacity: 0.4,
                }}
              />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const slotIdx = firstDow + i;
              const isToday = isCurrentMonth && day === today;
              const dayEvents = eventsByDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  style={{
                    minHeight: 110,
                    padding: 8,
                    borderRight:
                      slotIdx % 7 !== 6
                        ? "1px solid var(--df-line-soft)"
                        : "none",
                    borderBottom: "1px solid var(--df-line-soft)",
                    background: isToday
                      ? "var(--df-surface-soft)"
                      : "var(--df-surface)",
                  }}
                >
                  <div
                    className="df-tnum"
                    style={{
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "#fff" : "var(--df-ink)",
                      background: isToday ? "var(--df-accent)" : "transparent",
                      width: isToday ? 22 : "auto",
                      height: isToday ? 22 : "auto",
                      borderRadius: isToday ? 99 : 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 6,
                    }}
                  >
                    {day}
                  </div>
                  {dayEvents.slice(0, 3).map((e, j) => {
                    const tone =
                      e.daysUntilExpiry < 0
                        ? "var(--df-danger)"
                        : e.daysUntilExpiry <= 7
                          ? "var(--df-danger)"
                          : e.daysUntilExpiry <= 30
                            ? "var(--df-warn)"
                            : "var(--df-brand)";
                    return (
                      <Link
                        key={j}
                        href={`/docuflow/documents/${e.document.id}`}
                        style={{
                          background: tone,
                          color: "#fff",
                          padding: "3px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          marginBottom: 3,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textDecoration: "none",
                          display: "block",
                        }}
                      >
                        {e.document.name}
                      </Link>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--df-muted)",
                        fontWeight: 600,
                      }}
                    >
                      +{dayEvents.length - 3}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DfCard>

        {/* RIGHT — side panel */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          className="df-fade-up df-fade-up-200"
        >
          {/* Today */}
          {isCurrentMonth && (
            <DfCard
              padding={18}
              style={{
                background: "linear-gradient(135deg, #F4E2D3, #FAF6EE)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background:
                      todayEvents.length > 0 ? "var(--df-danger)" : "var(--df-success)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Clock size={18} />
                </span>
                <div>
                  <DfEyebrow>
                    วันนี้ · {now.getDate()}{" "}
                    {now.toLocaleDateString("th-TH", { month: "short" })}
                  </DfEyebrow>
                  <h3
                    className="df-serif"
                    style={{ fontSize: 18, margin: 0, marginTop: 4 }}
                  >
                    {todayEvents.length === 0
                      ? "ไม่มีงานวันนี้"
                      : `${todayEvents.length} เอกสารต้องดู`}
                  </h3>
                </div>
              </div>
              {todayEvents.map((e) => (
                <Link
                  key={e.id}
                  href={`/docuflow/documents/${e.document.id}`}
                  style={{
                    padding: 12,
                    background: "var(--df-surface)",
                    borderRadius: 10,
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.document.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--df-muted)" }}>
                    {e.notes ?? "ต้องต่ออายุ"}
                  </div>
                </Link>
              ))}
            </DfCard>
          )}

          {/* Upcoming */}
          <DfCard padding={18}>
            <DfEyebrow>กำลังจะมาถึง</DfEyebrow>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {upcoming.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--df-muted)",
                    textAlign: "center",
                    padding: 12,
                  }}
                >
                  ไม่มีกำหนดต่ออายุในเดือนนี้
                </div>
              ) : (
                upcoming.map((e, i) => {
                  const d = new Date(e.expiryDate);
                  const tone =
                    e.daysUntilExpiry < 0
                      ? "var(--df-danger)"
                      : e.daysUntilExpiry <= 7
                        ? "var(--df-danger)"
                        : e.daysUntilExpiry <= 30
                          ? "var(--df-warn)"
                          : "var(--df-brand)";
                  return (
                    <Link
                      key={e.id}
                      href={`/docuflow/documents/${e.document.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 0",
                        borderBottom:
                          i < upcoming.length - 1
                            ? "1px solid var(--df-line-soft)"
                            : "none",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <div style={{ textAlign: "center", minWidth: 40 }}>
                        <div
                          className="df-tnum df-serif"
                          style={{
                            fontSize: 22,
                            fontWeight: 600,
                            color: tone,
                            lineHeight: 1,
                          }}
                        >
                          {d.getDate()}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--df-muted)",
                            marginTop: 2,
                            textTransform: "uppercase",
                          }}
                        >
                          {d.toLocaleDateString("th-TH", { month: "short" })}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e.document.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--df-muted)" }}>
                          {e.daysUntilExpiry < 0
                            ? `หมดแล้ว ${Math.abs(e.daysUntilExpiry)} วัน`
                            : `อีก ${e.daysUntilExpiry} วัน`}
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </DfCard>

          {/* Legend */}
          <DfCard padding={18}>
            <DfEyebrow>ประเภทเหตุการณ์</DfEyebrow>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 12,
              }}
            >
              {[
                { c: "var(--df-danger)", n: "หมดอายุวันนี้ · เร่งด่วน" },
                { c: "var(--df-warn)", n: "ใกล้หมด/ต่ออายุ ≤ 30 วัน" },
                { c: "var(--df-brand)", n: "ส่งเอกสาร/อัปโหลด" },
                { c: "var(--df-accent)", n: "เซ็น/อนุมัติ" },
              ].map((l, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: l.c,
                    }}
                  />
                  <span>{l.n}</span>
                </div>
              ))}
            </div>
          </DfCard>

          {/* Summary */}
          <DfCard padding={16} warm>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <CalendarIcon size={18} style={{ color: "var(--df-accent)" }} />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  {thaiDateLong(new Date())}
                </div>
                <div style={{ color: "var(--df-muted)" }}>
                  {renewals.length} เอกสารที่ต้องจัดการในรอบปี
                </div>
              </div>
            </div>
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

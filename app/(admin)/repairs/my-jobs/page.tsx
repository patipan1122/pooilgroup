// /repairs/my-jobs — tech persona queue · uses .panel + .kcard-like cards
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import {
  findTechnicianForUser,
  listTechnicianJobs,
} from "@/lib/repair/queries";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  OPEN_STATUSES,
  formatBaht,
  totalTicketCost,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";
import {
  HardHat,
  MapPin,
  Camera,
  PackageSearch,
  Flame,
  CheckCircle2,
  ChevronRight,
  Plus,
} from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<RepairTicketStatus, string> = {
  NEW: "pill-new",
  ACK: "pill-assess",
  IN_PROGRESS: "pill-approval",
  WAITING_PARTS: "pill-parts",
  RESOLVED: "pill-done",
  CLOSED: "pill-done",
  CANCELLED: "pill-low",
};

export default async function MyJobsPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const tech = await findTechnicianForUser(session.user.org_id, session.user.id);

  if (!tech) {
    return (
      <>
        <RepairSubHeader
          icon={HardHat}
          eyebrow="Persona · Technician"
          title="งานของฉัน"
          subtitle="ช่างเห็นงานที่ตัวเองได้รับมอบหมาย"
        />
        <div className="repair-content">
          <div className="panel" style={{
            padding: 40, textAlign: "center",
            borderStyle: "dashed", borderColor: "var(--ink-300)",
          }}>
            <HardHat size={32} style={{ color: "var(--ink-300)" }} />
            <p style={{ marginTop: 14, fontSize: 13.5, fontWeight: 700, color: "var(--ink-900)" }}>
              ยังไม่ลงทะเบียนเป็นช่าง
            </p>
            <p style={{
              marginTop: 4, fontSize: 12, color: "var(--ink-500)",
              maxWidth: 480, marginLeft: "auto", marginRight: "auto",
            }}>
              บัญชีของคุณ ({session.user.name}) ยังไม่ผูกกับโปรไฟล์ช่าง · แจ้ง admin
              ให้เพิ่มชื่อคุณเข้าระบบเป็นช่างใน · จากนั้นกลับมาดูงานที่ถูกมอบหมายได้
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
              <Link href="/repairs" className="btn">ไปภาพรวม Command</Link>
              <Link href="/repairs/technicians" className="btn btn-primary">
                เปิดหน้า Technicians
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const jobs = await listTechnicianJobs(session.user.org_id, tech.id);

  const open = jobs.filter((j) => OPEN_STATUSES.includes(j.status as RepairTicketStatus));
  const urgent = open.filter((j) => (j.urgency as RepairUrgency) === "URGENT");
  const parts = jobs.filter((j) => j._count.parts > 0).length;

  return (
    <>
      <RepairSubHeader
        icon={HardHat}
        eyebrow="Persona · Technician"
        title={`สวัสดี ${tech.name.split(" ")[0]} · งานของฉัน`}
        subtitle={`${tech.kind === "INTERNAL" ? "ช่างใน" : "Vendor"} · งานที่ถูกมอบหมาย · ${jobs.length} ใบ`}
        stats={[
          { label: "เปิดอยู่", value: open.length },
          { label: "ด่วน", value: urgent.length, tone: urgent.length > 0 ? "danger" : "default" },
          { label: "รออะไหล่", value: parts },
        ]}
        actions={
          <Link href="/repairs/new" className="btn btn-primary btn-sm">
            <Plus /> แจ้งซ่อมใหม่
          </Link>
        }
      />

      <div className="repair-content" style={{ maxWidth: 900 }}>
        {jobs.length === 0 ? (
          <div className="panel" style={{
            padding: 40, textAlign: "center",
            borderStyle: "dashed", borderColor: "var(--ink-300)",
          }}>
            <CheckCircle2 size={32} style={{ color: "var(--good)" }} />
            <p style={{ marginTop: 12, fontSize: 13.5, fontWeight: 700, color: "var(--ink-900)" }}>
              ยังไม่มีงานที่ถูกมอบหมาย
            </p>
            <p style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}>
              เมื่อแอดมินมอบใบให้คุณ จะเข้ามาที่นี่ทันที
            </p>
            <Link
              href="/repairs/triage"
              className="btn"
              style={{ marginTop: 14, display: "inline-flex" }}
            >
              ดูใบทั้งหมด
            </Link>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {jobs.map((t) => {
              const sla = slaStatusFor(t);
              const isUrgent = (t.urgency as RepairUrgency) === "URGENT";
              const cost = totalTicketCost(t);
              return (
                <li key={t.id}>
                  <Link
                    href={`/repairs/${t.id}`}
                    className={"kcard " + (isUrgent ? "is-urgent" : "")}
                  >
                    <div className="kcard-top">
                      <span className="kcard-id">{t.ticketCode}</span>
                      <span style={{ flex: 1 }} />
                      {isUrgent && (
                        <span className="pill pill-urgent">
                          <Flame size={10} style={{ marginRight: 2 }} />
                          {URGENCY_LABELS.URGENT}
                        </span>
                      )}
                      <span className={"pill " + STATUS_CLS[t.status as RepairTicketStatus]}>
                        <span className="dot" />
                        {STATUS_LABELS[t.status as RepairTicketStatus]}
                      </span>
                    </div>
                    <div className="kcard-title" style={{ fontSize: 14 }}>
                      {t.category?.emoji && <span style={{ marginRight: 4 }}>{t.category.emoji}</span>}
                      {t.title}
                    </div>
                    <div className="kcard-bottom">
                      {t.branch && (
                        <>
                          <MapPin size={11} style={{ color: "var(--ink-500)" }} />
                          <span style={{ fontSize: 11, color: "var(--ink-600)" }}>
                            <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)" }}>
                              {t.branch.code}
                            </span>{" "}
                            {t.branch.name}
                          </span>
                        </>
                      )}
                      <span className="spacer" />
                      {t._count.photos > 0 && (
                        <span className="kcard-iconlet"><Camera /> {t._count.photos}</span>
                      )}
                      {t._count.parts > 0 && (
                        <span className="kcard-iconlet"><PackageSearch /> {t._count.parts}</span>
                      )}
                      {cost > 0 && (
                        <span className="kcard-cost">{formatBaht(cost)}</span>
                      )}
                      {sla !== "done" && (
                        <span className={"sla " + sla}>
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      )}
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "flex-end",
                      paddingTop: 4, borderTop: "1px dashed var(--line-2)",
                      fontSize: 11, color: "var(--brand-700)", fontWeight: 600,
                    }}>
                      เปิดใบ <ChevronRight size={12} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

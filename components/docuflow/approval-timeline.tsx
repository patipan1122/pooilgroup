// DocuFlow · Approval Timeline
// ────────────────────────────────────────────────────────────────────
// Merged timeline of signature placements + audit log events for a
// single document. Renders signers in `ordering` sequence with status
// chips (signed / current / pending) plus audit "trail" events
// underneath.
//
// Used in the document detail page's left column to satisfy CEO ask
// "ระบบต่ออายุ preview · log timeline การอนุมัติ".
// ────────────────────────────────────────────────────────────────────

import {
  CheckCircle2,
  Circle,
  Clock,
  PenLine,
  Tag,
  Share2,
  Upload as UploadIcon,
  RefreshCcw,
  Trash2,
  FileText,
  Sparkles,
} from "lucide-react";
import { DfCard, DfEyebrow, DfPill } from "./df-ui";
import { bkkDateTime, thaiDateLong } from "@/lib/utils/format";

export interface ApprovalSignerRow {
  id: string;
  ordering: number;
  signerName: string | null;
  signerUserName: string | null;
  signerRole: string;
  label: string | null;
  signedAt: Date | null;
}

export interface AuditEventRow {
  id: string;
  action: string;
  createdAt: Date;
  userName: string | null;
  diff: unknown;
}

const ACTION_META: Record<
  string,
  { label: string; icon: React.ReactNode; tone: "brand" | "success" | "warn" | "default" }
> = {
  DOCUFLOW_UPLOAD: {
    label: "อัปโหลดเอกสาร",
    icon: <UploadIcon size={13} />,
    tone: "brand",
  },
  DOCUFLOW_TAG: { label: "ติดแท็ก", icon: <Tag size={13} />, tone: "default" },
  DOCUFLOW_RENEW: {
    label: "ต่ออายุเอกสาร",
    icon: <RefreshCcw size={13} />,
    tone: "success",
  },
  DOCUFLOW_SIGN_PLACEMENT_ADD: {
    label: "ตั้งจุดเซ็น",
    icon: <PenLine size={13} />,
    tone: "default",
  },
  DOCUFLOW_SIGNATURE_SIGNED: {
    label: "ลงนาม",
    icon: <CheckCircle2 size={13} />,
    tone: "success",
  },
  DOCUFLOW_SHARE: {
    label: "แชร์ข้ามสาขา",
    icon: <Share2 size={13} />,
    tone: "brand",
  },
  DOCUFLOW_DELETE: {
    label: "ลบเอกสาร",
    icon: <Trash2 size={13} />,
    tone: "warn",
  },
  DOCUFLOW_RISK_ANALYZE: {
    label: "วิเคราะห์ความเสี่ยง (AI)",
    icon: <Sparkles size={13} />,
    tone: "brand",
  },
};

function actionMeta(action: string) {
  return (
    ACTION_META[action] ?? {
      label: action.replace(/^DOCUFLOW_/, "").replace(/_/g, " ").toLowerCase(),
      icon: <FileText size={13} />,
      tone: "default" as const,
    }
  );
}

const SIGNER_ROLE_LABEL: Record<string, string> = {
  owner: "เจ้าของ",
  employee: "พนักงาน",
  counterparty: "คู่สัญญา",
  other: "อื่น ๆ",
};

interface Props {
  signers: ApprovalSignerRow[];
  events: AuditEventRow[];
  expiryDate?: Date | null;
  alertDays?: number[];
  lastRenewedDate?: Date | null;
}

export function ApprovalTimeline({
  signers,
  events,
  expiryDate,
  alertDays,
  lastRenewedDate,
}: Props) {
  const totalSigners = signers.length;
  const signedCount = signers.filter((s) => s.signedAt).length;
  const allSigned = totalSigners > 0 && signedCount === totalSigners;
  const currentSignerIdx = signers.findIndex((s) => !s.signedAt);

  // Renewal alert preview — only when expiry is set and in the future
  const now = new Date();
  const renewalAlerts =
    expiryDate && expiryDate > now && alertDays && alertDays.length > 0
      ? alertDays
          .slice()
          .sort((a, b) => b - a)
          .map((days) => ({
            days,
            triggersAt: new Date(
              expiryDate.getTime() - days * 24 * 60 * 60 * 1000,
            ),
          }))
      : [];

  return (
    <DfCard padding={20}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <DfEyebrow>ประวัติการอนุมัติ · Audit Log</DfEyebrow>
          <h3
            className="df-serif"
            style={{ fontSize: 18, marginTop: 4, marginBottom: 0 }}
          >
            Approval Timeline
          </h3>
        </div>
        {totalSigners > 0 && (
          <DfPill tone={allSigned ? "success" : "warn"}>
            {allSigned ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
            {signedCount}/{totalSigners} เซ็นแล้ว
          </DfPill>
        )}
      </div>

      {/* Signer chain */}
      {totalSigners > 0 && (
        <div style={{ marginBottom: events.length > 0 ? 20 : 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--df-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            ลายเซ็นตามลำดับ
          </div>
          <div style={{ position: "relative", paddingLeft: 28 }}>
            <div
              style={{
                position: "absolute",
                left: 11,
                top: 10,
                bottom: 10,
                width: 2,
                background: "var(--df-line)",
              }}
            />
            {signers.map((s, i) => {
              const signed = !!s.signedAt;
              const isCurrent = !signed && i === currentSignerIdx;
              const name =
                s.signerUserName ?? s.signerName ?? `ผู้เซ็น #${s.ordering + 1}`;
              const roleLabel =
                SIGNER_ROLE_LABEL[s.signerRole] ?? s.signerRole;
              return (
                <div
                  key={s.id}
                  style={{
                    position: "relative",
                    paddingBottom: i < totalSigners - 1 ? 16 : 0,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: -23,
                      top: 2,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: signed
                        ? "var(--df-success, #10b981)"
                        : isCurrent
                          ? "var(--df-brand)"
                          : "var(--df-surface)",
                      border: `2px solid ${
                        signed
                          ? "var(--df-success, #10b981)"
                          : isCurrent
                            ? "var(--df-brand)"
                            : "var(--df-line)"
                      }`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: signed || isCurrent ? "#fff" : "var(--df-muted)",
                    }}
                  >
                    {signed ? (
                      <CheckCircle2 size={12} strokeWidth={3} />
                    ) : isCurrent ? (
                      <Clock size={11} strokeWidth={3} />
                    ) : (
                      <Circle size={9} fill="currentColor" />
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--df-ink)",
                        }}
                      >
                        {name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--df-muted)",
                          marginTop: 2,
                        }}
                      >
                        {s.label ? `${s.label} · ` : ""}
                        {roleLabel}
                      </div>
                      {s.signedAt && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--df-success, #047857)",
                            marginTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          ลงนามเมื่อ {bkkDateTime(s.signedAt)}
                        </div>
                      )}
                    </div>
                    <DfPill
                      tone={
                        signed ? "success" : isCurrent ? "warn" : "outline"
                      }
                      small
                    >
                      {signed ? "เซ็นแล้ว" : isCurrent ? "กำลังรอ" : "คิว"}
                    </DfPill>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Renewal preview */}
      {expiryDate && (
        <div style={{ marginBottom: events.length > 0 ? 20 : 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--df-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            ตารางต่ออายุ
          </div>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "var(--df-bg-warm)",
              border: "1px solid var(--df-line-soft)",
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ color: "var(--df-muted)" }}>วันหมดอายุ</span>
              <span style={{ fontWeight: 700, color: "var(--df-ink)" }}>
                {thaiDateLong(expiryDate)}
              </span>
            </div>
            {lastRenewedDate && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={{ color: "var(--df-muted)" }}>ต่ออายุล่าสุด</span>
                <span style={{ fontWeight: 600, color: "var(--df-ink)" }}>
                  {thaiDateLong(lastRenewedDate)}
                </span>
              </div>
            )}
            {renewalAlerts.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    color: "var(--df-muted)",
                    marginBottom: 6,
                  }}
                >
                  จะแจ้งเตือนล่วงหน้า
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {renewalAlerts.map((a) => (
                    <div
                      key={a.days}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "4px 8px",
                        background: "var(--df-surface)",
                        borderRadius: 6,
                        border: "1px solid var(--df-line-soft)",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {a.days} วันก่อน
                      </span>
                      <span style={{ color: "var(--df-muted)", fontSize: 11 }}>
                        {thaiDateLong(a.triggersAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit events */}
      {events.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--df-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            เหตุการณ์ทั้งหมด
          </div>
          <div style={{ position: "relative", paddingLeft: 28 }}>
            <div
              style={{
                position: "absolute",
                left: 11,
                top: 10,
                bottom: 10,
                width: 2,
                background: "var(--df-line)",
              }}
            />
            {events.map((e, i) => {
              const meta = actionMeta(e.action);
              return (
                <div
                  key={e.id}
                  style={{
                    position: "relative",
                    paddingBottom: i < events.length - 1 ? 14 : 0,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: -23,
                      top: 2,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: "var(--df-surface)",
                      border: "2px solid var(--df-line)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--df-muted)",
                    }}
                  >
                    {meta.icon}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--df-ink)",
                        }}
                      >
                        {meta.label}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--df-muted)",
                          marginTop: 2,
                        }}
                      >
                        {bkkDateTime(e.createdAt)} · โดย {e.userName ?? "ระบบ"}
                      </div>
                    </div>
                    <DfPill tone={meta.tone} small>
                      {meta.label}
                    </DfPill>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalSigners === 0 && events.length === 0 && !expiryDate && (
        <div
          style={{
            textAlign: "center",
            padding: "24px 12px",
            color: "var(--df-muted)",
            fontSize: 13,
          }}
        >
          ยังไม่มีประวัติเหตุการณ์
        </div>
      )}
    </DfCard>
  );
}

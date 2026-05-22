// DocuFlow · AI Search "ภาษาคน"
// ────────────────────────────────────────────────────────────────────
// Canvas-parity 2026-05-22 — matches DesktopSearch:
//   centered hero · big search bar (delegated to SearchInterface) ·
//   2-col layout after results · LEFT main · RIGHT filter sidebar +
//   recent searches + AI templates.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  Sparkles,
  ArrowLeft,
  Building2,
  Clock as ClockIcon,
  Filter,
  Wallet,
  History,
  AlertTriangle,
  Download,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { SearchInterface } from "@/components/docuflow/search-interface";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPill,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const EXAMPLE_QUERIES = [
  "ใบอนุญาตสถานีบริการน้ำมัน KKN ยังไม่หมดอายุไหม?",
  "รถคันไหนทะเบียนหมดเดือนนี้บ้าง?",
  "โรงบรรจุก๊าซต้องมีใบอนุญาตอะไรบ้าง?",
  "ใบขับขี่คนขับที่หมดแล้วมีใครบ้าง?",
  "เอกสารอะไรที่ใช้กับทุกสาขาปั๊มน้ำมัน?",
];

const AI_TEMPLATES = [
  { icon: <Wallet size={13} />, t: "ค่าใช้จ่ายต่ออายุปีนี้" },
  { icon: <History size={13} />, t: "สรุปประวัติย้อนหลัง" },
  { icon: <AlertTriangle size={13} />, t: "วิเคราะห์ความเสี่ยง" },
  { icon: <Download size={13} />, t: "Export Excel" },
];

export default async function DocuFlowSearchPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "ค้นหา AI" }]} />

      {/* Hero */}
      <div
        style={{ marginBottom: 22, textAlign: "center" }}
        className="df-fade-up"
      >
        <DfEyebrow>ค้นหาด้วย AI · ภาษาคน</DfEyebrow>
        <h1
          className="df-serif"
          style={{
            fontSize: "clamp(26px, 4vw, 36px)",
            lineHeight: 1.15,
            marginTop: 10,
            marginBottom: 8,
          }}
        >
          ถามอะไรเกี่ยวกับเอกสารก็ได้
        </h1>
        <p style={{ color: "var(--df-muted)", fontSize: 15, margin: 0 }}>
          ค้นหาเป็นภาษาธรรมชาติ · AI เข้าใจบริบทบริษัท สาขา และประเภทเอกสาร
        </p>
      </div>

      {/* 2-col layout matching canvas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        {/* LEFT — search interface (hero search + answer + results) */}
        <div className="df-fade-up df-fade-up-100">
          <DfCard
            padding={20}
            style={{ boxShadow: "var(--df-shadow-2)", marginBottom: 16 }}
          >
            <SearchInterface examples={EXAMPLE_QUERIES} />
          </DfCard>

          {/* Suggestion pills (visible before first search) */}
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 16,
              padding: "0 4px",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "var(--df-muted)",
                marginRight: 4,
                alignSelf: "center",
              }}
            >
              ลองถามด้วยคำเหล่านี้:
            </span>
            {EXAMPLE_QUERIES.slice(0, 4).map((q, i) => (
              <DfPill key={i} tone="outline" small>
                {q}
              </DfPill>
            ))}
          </div>
        </div>

        {/* RIGHT — filter sidebar + AI templates */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "relative",
          }}
          className="df-fade-up df-fade-up-200"
        >
          <DfCard padding={18}>
            <DfEyebrow>
              <Filter size={11} style={{ display: "inline-block", marginRight: 4 }} />
              ตัวกรองที่ AI เข้าใจ
            </DfEyebrow>

            <div style={{ marginTop: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                บริษัท
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <DfPill tone="brand" small>
                  <Building2 size={11} /> Pooil Oil
                </DfPill>
                <DfPill tone="outline" small>
                  + JP Sync
                </DfPill>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                ประเภทเอกสาร
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <DfPill tone="accent" small>
                  ใบอนุญาตหลัก
                </DfPill>
                <DfPill tone="outline" small>
                  สัญญา
                </DfPill>
                <DfPill tone="outline" small>
                  + ภาษี
                </DfPill>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--df-muted)",
                  marginBottom: 6,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                ช่วงวันหมดอายุ
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <DfPill tone="warn" small>
                  <ClockIcon size={11} /> ภายใน 3 เดือน
                </DfPill>
                <DfPill tone="outline" small>
                  ปีนี้
                </DfPill>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: "1px solid var(--df-line)",
              }}
            >
              <DfEyebrow>เครื่องมือ AI</DfEyebrow>
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {AI_TEMPLATES.map((t, i) => (
                  <DfButton
                    key={i}
                    variant="ghost"
                    size="sm"
                    style={{
                      justifyContent: "flex-start",
                      width: "100%",
                    }}
                  >
                    {t.icon}
                    {t.t}
                  </DfButton>
                ))}
              </div>
            </div>
          </DfCard>

          {/* Recent searches (placeholder — client component handles real history) */}
          <DfCard padding={18}>
            <DfEyebrow>
              <History size={11} style={{ display: "inline-block", marginRight: 4 }} />
              ตัวอย่างคำถาม
            </DfEyebrow>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {EXAMPLE_QUERIES.slice(0, 3).map((q, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 10px",
                    background: "var(--df-surface-soft)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--df-ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {q}
                </div>
              ))}
            </div>
          </DfCard>

          {/* Tips */}
          <DfCard padding={16} warm>
            <DfEyebrow>เคล็ดลับการถาม</DfEyebrow>
            <ul
              style={{
                margin: "10px 0 0",
                paddingLeft: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 12,
              }}
            >
              {[
                "ระบุชื่อสาขา เช่น &lsquo;สาขา KKN&rsquo;",
                "ระบุช่วงเวลา เช่น &lsquo;หมดใน 30 วัน&rsquo;",
                "คำตอบ cache 1 ชั่วโมง",
              ].map((tip, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--df-brand)" stroke-width="1.8" style="flex-shrink:0;margin-top:2px"><path d="M5 3v4M3 5h4M19 13v6M16 16h6M12 4l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></svg><span>${tip}</span>`,
                  }}
                />
              ))}
            </ul>
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

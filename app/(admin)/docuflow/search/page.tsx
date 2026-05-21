// DocuFlow · AI Search "ภาษาคน"
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopSearch canvas:
//   centered hero · big search bar · suggestion pills · result rendering
//   delegated to <SearchInterface />.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Sparkles, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { SearchInterface } from "@/components/docuflow/search-interface";
import {
  DfCard,
  DfEyebrow,
  DfPill,
} from "@/components/docuflow/df-ui";

export const dynamic = "force-dynamic";

const EXAMPLE_QUERIES = [
  "ใบอนุญาตสถานีบริการน้ำมัน KKN ยังไม่หมดอายุไหม?",
  "รถคันไหนทะเบียนหมดเดือนนี้บ้าง?",
  "โรงบรรจุก๊าซต้องมีใบอนุญาตอะไรบ้าง?",
  "ใบขับขี่คนขับที่หมดแล้วมีใครบ้าง?",
  "เอกสารอะไรที่ใช้กับทุกสาขาปั๊มน้ำมัน?",
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
      <Link
        href="/docuflow"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับ DocuFlow
      </Link>

      <div style={{ marginBottom: 28, textAlign: "center" }} className="df-fade-up">
        <DfEyebrow>ค้นหาด้วย AI</DfEyebrow>
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

      <DfCard
        padding={20}
        className="df-fade-up df-fade-up-100"
        style={{ boxShadow: "var(--df-shadow-2)", marginBottom: 24 }}
      >
        <SearchInterface examples={EXAMPLE_QUERIES} />
      </DfCard>

      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}
        className="df-fade-up df-fade-up-200"
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--df-muted)",
            marginRight: 8,
            alignSelf: "center",
          }}
        >
          ลองถามด้วยคำเหล่านี้:
        </span>
        {EXAMPLE_QUERIES.map((q, i) => (
          <DfPill key={i} tone="outline" small>
            {q}
          </DfPill>
        ))}
      </div>

      <DfCard padding={18} warm className="df-fade-up df-fade-up-300">
        <DfEyebrow>เคล็ดลับการถาม</DfEyebrow>
        <ul
          style={{
            marginTop: 12,
            marginBottom: 0,
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {[
            "ระบุชื่อ/รหัสสาขา เช่น \"สาขา KKN\" เพื่อจำกัดคำตอบ",
            "ระบุช่วงเวลา เช่น \"หมดใน 30 วัน\" หรือ \"หมดเดือนนี้\"",
            "ถามเรื่อง รถ → จะค้นจากทะเบียน/พ.ร.บ./ตรวจสภาพ",
            "ถามเรื่อง คนขับ → ใบขับขี่/ใบรับรอง",
            "คำตอบ cache 1 ชั่วโมง — ถ้าพึ่งอัปเดตเอกสาร อาจต้องรอสักครู่",
          ].map((tip, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 13,
                color: "var(--df-ink-2)",
              }}
            >
              <Sparkles
                size={14}
                style={{
                  color: "var(--df-brand)",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </DfCard>
    </div>
  );
}

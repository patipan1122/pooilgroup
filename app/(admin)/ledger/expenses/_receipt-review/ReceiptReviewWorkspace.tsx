"use client";

// โหมดตรวจใบเสร็จ — เวิร์กสเปซเต็มจอ 3 คอลัมน์ (รายการ · ฟอร์มลงบัญชี · รูปใบเสร็จ+ประวัติ).
// เป็น overlay (fixed inset-0) ทับ AdminShell → โหมดเดิมไม่ถูกแตะ. ข้อมูลทั้งหมดมาจาก
// page.tsx (server) ทาง prop `data` — การนำทาง/ฟิลเตอร์ทำผ่าน URL (?view=receipt-review คงไว้).
import "./receipt-review.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LedgerViewToggle } from "./LedgerViewToggle";
import { RRListRail } from "./RRListRail";
import { RRDetailForm } from "./RRDetailForm";
import { RRReceiptColumn } from "./RRReceiptColumn";
import { RRFilterOverlay } from "./RRFilterOverlay";
import { rrHref, rrStatusHref, rrActivePrimary, RR_PRIMARY_TABS } from "./nav";
import { useLedgerUpload } from "../../_components/LedgerUploadProvider";
import type { ReceiptReviewData } from "./types";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function ReceiptReviewWorkspace({ data }: { data: ReceiptReviewData }) {
  const router = useRouter();
  const { openSheet, busy, done, total, mode } = useLedgerUpload();
  const { baseParams, filter, statusCounts, completenessSummary, companies, branches } = data;
  const selected = filter.selected;

  const [searchText, setSearchText] = useState(filter.q ?? "");
  const [filterOpen, setFilterOpen] = useState(false);

  // ปุ่มสลับกลับ list mode = ตัด view ออก (คงฟิลเตอร์เดิม + คงใบที่เลือก)
  const backToListHref = (() => {
    const sp = new URLSearchParams(baseParams);
    if (selected) sp.set("selected", selected);
    const qs = sp.toString();
    return qs ? `/ledger/expenses?${qs}` : "/ledger/expenses";
  })();

  function go(href: string) {
    router.push(href);
  }

  function submitSearch() {
    go(rrHref(baseParams, { q: searchText.trim() || null }, selected));
  }

  const activePrimary = rrActivePrimary(filter);
  const secondaryFilterCount = [filter.categoryId, filter.projectId, filter.cc].filter(
    Boolean,
  ).length;

  const blockedVat = completenessSummary.blockedVat;
  const undecided = completenessSummary.counts.undecided;

  return (
    <div className="rr-root">
      {/* ── HEADER 52px ─────────────────────────────────────────── */}
      <div
        style={{
          height: 52,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          background: "#fff",
          borderBottom: "1px solid #dfe3ea",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: "#1e293b",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            P
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>
              ระบบบัญชี · รายจ่าย
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.3 }}>
              LedgerLine · LINE → AI อ่าน → บัญชียืนยัน → ส่งเข้า TRCloud
            </div>
          </div>
        </div>
        <div style={{ width: 1, height: 24, background: "#e8ecf2" }} />
        {/* บริษัท */}
        <select
          value={data.companyId}
          onChange={(e) => go(rrHref(baseParams, { company: e.target.value, branch: null }, null))}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 8px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            background: "#fff",
            color: "#0f172a",
          }}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {/* สาขา */}
        <select
          value={data.branchId ?? ""}
          onChange={(e) => go(rrHref(baseParams, { branch: e.target.value || null }, selected))}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 8px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            background: "#fff",
            color: "#0f172a",
          }}
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {/* ค้นหา */}
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
          placeholder="ค้นหา ผู้ขาย / เลขที่ / ยอดเงิน"
          style={{
            width: 250,
            fontSize: 12,
            padding: "6px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            background: "#f8fafc",
            color: "#0f172a",
          }}
        />
        <div style={{ flex: 1 }} />
        {/* คีย์ลัด (แสดงผลอย่างเดียว) */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "#94a3b8" }}>
          <span
            style={{
              padding: "2px 6px",
              border: "1px solid #e2e8f0",
              borderRadius: 5,
              background: "#f8fafc",
              color: "#475569",
              fontWeight: 600,
            }}
          >
            J/K
          </span>
          <span>เลื่อนใบ</span>
        </div>
        {/* ปุ่มสลับโหมด (อยู่แถวปุ่มอัปโหลด ตามที่ CEO ขอ) */}
        <LedgerViewToggle
          current="receipt-review"
          listHref={backToListHref}
          reviewHref="#"
          variant="flat"
        />
        {/* อัปโหลดใบเสร็จ (เรียกระบบอัปโหลดตัวจริงผ่าน context) */}
        <button
          type="button"
          onClick={() => {
            if (data.companyId) openSheet({ companyId: data.companyId, branchId: data.branchId, baseParams });
          }}
          disabled={busy || !data.companyId}
          className="rr-bright"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#fff",
            background: "#2563eb",
            padding: "7px 12px",
            borderRadius: 8,
            border: "none",
            opacity: busy || !data.companyId ? 0.6 : 1,
          }}
        >
          {busy ? (mode === "group" ? "กำลังอ่านบิล…" : `กำลังทำ ${done}/${total}…`) : "↑ อัปโหลดใบเสร็จ"}
        </button>
      </div>

      {/* ── STAT / FILTER BAR 46px ──────────────────────────────── */}
      <div
        style={{
          height: 46,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 16px",
          background: "#fff",
          borderBottom: "1px solid #dfe3ea",
        }}
      >
        {blockedVat > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: "#b45309",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              padding: "4px 9px",
              borderRadius: 999,
            }}
          >
            <span className="rr-num">⚠ {baht(blockedVat)} VAT ติด</span>
            {undecided > 0 && (
              <span style={{ color: "#a16207", fontWeight: 400 }}>· อีก {undecided} ใบยังไม่ตรวจ</span>
            )}
          </div>
        )}
        {blockedVat > 0 && <div style={{ width: 1, height: 20, background: "#e8ecf2" }} />}
        {/* แท็บสถานะ (ลิงก์ — คงผลเหมือน list mode) */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, overflowX: "auto" }}>
          {RR_PRIMARY_TABS.filter((t) => data.payreqEnabled || !t.pay).map((t) => {
            const active = activePrimary === t.id;
            const count = statusCounts[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go(rrStatusHref(baseParams, t.id, selected))}
                className="rr-dim"
                style={{
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: "none",
                  background: active ? "#1e3a8a" : "#f1f5f9",
                  color: active ? "#fff" : "#475569",
                }}
              >
                <span>{t.label}</span>
                {count > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.85 }} className="rr-num">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className="rr-hb"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "#334155",
            padding: "6px 11px",
            border: `1px solid ${secondaryFilterCount > 0 ? "#93c5fd" : "#e2e8f0"}`,
            background: secondaryFilterCount > 0 ? "#eff6ff" : "#fff",
            borderRadius: 8,
          }}
        >
          <span>ตัวกรอง</span>
          {secondaryFilterCount > 0 && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "#fff",
                background: "#2563eb",
                padding: "1px 6px",
                borderRadius: 999,
              }}
              className="rr-num"
            >
              {secondaryFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ── MAIN GRID 272 · 1fr · 330 ───────────────────────────── */}
      <div className="rr-gridwrap" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          className="rr-grid"
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "272px 1fr 330px",
            gap: 10,
            padding: 10,
          }}
        >
          <RRListRail data={data} onNavigate={go} />
          <RRDetailForm data={data} />
          <RRReceiptColumn data={data} />
        </div>
      </div>

      {filterOpen && (
        <RRFilterOverlay data={data} onClose={() => setFilterOpen(false)} onNavigate={go} />
      )}
    </div>
  );
}

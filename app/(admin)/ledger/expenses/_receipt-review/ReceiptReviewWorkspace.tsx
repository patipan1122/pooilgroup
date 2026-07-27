"use client";

// โหมดตรวจใบเสร็จ — เวิร์กสเปซเต็มจอ 3 คอลัมน์ (รายการ · ฟอร์มลงบัญชี · รูปใบเสร็จ+ประวัติ).
// เป็น overlay (fixed inset-0) ทับ AdminShell → โหมดเดิมไม่ถูกแตะ. ข้อมูลทั้งหมดมาจาก
// page.tsx (server) ทาง prop `data`. คอลัมน์ซ้าย + แท็บสถานะ + ตัวกรอง ใช้คอมโพเนนต์
// "ตัวจริง" ของโหมดรายการ (ExpenseList / ExpenseStatusTabs) เพื่อให้หน้าตา+การทำงานเหมือนกัน
// เป๊ะ. เคล็ดสำคัญ: ส่ง baseParams ที่ฝัง ?view=receipt-review ไว้แล้ว → ทุกลิงก์ที่คอมโพเนนต์
// สร้างเอง (เลือกใบ/สลับแท็บ/กรอง) จะคง view ไว้ = อยู่ในโหมดตรวจต่อทุกคลิก.
import "./receipt-review.css";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LedgerViewToggle } from "./LedgerViewToggle";
import { RRDetailForm } from "./RRDetailForm";
import { RRReceiptColumn } from "./RRReceiptColumn";
import { rrHref } from "./nav";
import { ExpenseList } from "../_components/ExpenseList";
import { ExpenseStatusTabs } from "../_components/ExpenseStatusTabs";
import { useLedgerUpload } from "../../_components/LedgerUploadProvider";
import type { ReceiptReviewData } from "./types";
import type { LedgerStatusValue } from "@/components/ledger/_kit/types";
import type { ExpenseTab } from "../page";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function ReceiptReviewWorkspace({ data }: { data: ReceiptReviewData }) {
  const router = useRouter();
  // เปลี่ยนบริษัท/สาขา/ค้นหา = navigation ใน transition → ไม่โดน loading.tsx คั่น (จอไม่วูบ).
  const [, startTransition] = useTransition();
  const { openSheet, busy, done, total, mode } = useLedgerUpload();
  const { baseParams, filter, statusCounts, completenessSummary, companies, branches } = data;
  const selected = filter.selected;

  const [searchText, setSearchText] = useState(filter.q ?? "");

  // ★ กุญแจ "อยู่ในโหมดตรวจทุกคลิก": ExpenseList / ExpenseStatusTabs สร้างลิงก์ภายในจาก
  //   baseParams (new URLSearchParams(baseParams) + set/delete). ถ้า baseParams ฝัง
  //   view=receipt-review ไว้แล้ว ทุกลิงก์ (เลือกใบ/สลับแท็บ/กรอง) จะพา view ติดไปด้วย
  //   → ผู้ใช้ไม่หลุดออกจากโหมดตรวจ. (คอมโพเนนต์เหล่านั้นลบเฉพาะคีย์ของตัวเอง ไม่แตะ view.)
  const reviewBase = new URLSearchParams(baseParams);
  reviewBase.set("view", "receipt-review");
  const reviewBaseParams = reviewBase.toString();

  // ปุ่มสลับกลับ list mode = ตัด view ออก (คงฟิลเตอร์เดิม + คงใบที่เลือก)
  const backToListHref = (() => {
    const sp = new URLSearchParams(baseParams);
    if (selected) sp.set("selected", selected);
    const qs = sp.toString();
    return qs ? `/ledger/expenses?${qs}` : "/ledger/expenses";
  })();

  function go(href: string) {
    startTransition(() => router.push(href));
  }

  function submitSearch() {
    go(rrHref(baseParams, { q: searchText.trim() || null }, selected));
  }

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

      {/* ── STATUS BAR — แท็บสถานะเต็มกว้าง (ExpenseStatusTabs ตัวจริง · เหมือน list mode) ── */}
      <div
        style={{
          minHeight: 46,
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
          <>
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
                flex: "none",
              }}
            >
              <span className="rr-num">⚠ {baht(blockedVat)} VAT ติด</span>
              {undecided > 0 && (
                <span style={{ color: "#a16207", fontWeight: 400 }}>· อีก {undecided} ใบยังไม่ตรวจ</span>
              )}
            </div>
            <div style={{ width: 1, height: 20, background: "#e8ecf2", flex: "none" }} />
          </>
        )}
        {/* แท็บสถานะตัวจริง — สร้างลิงก์จาก reviewBaseParams → คง view=receipt-review ทุกครั้ง. */}
        <ExpenseStatusTabs
          baseParams={reviewBaseParams}
          status={filter.status as LedgerStatusValue | undefined}
          tr={filter.tr}
          ap={filter.ap}
          pv={filter.pv}
          nr={filter.nr}
          pay={filter.pay}
          payreqEnabled={data.payreqEnabled}
          statusCounts={statusCounts}
          selectedId={selected}
          className="flex-1 py-1.5"
        />
      </div>

      {/* ── MAIN GRID — ExpenseList (ตัวจริง) · ฟอร์มลงบัญชี · รูปใบเสร็จ+ประวัติ ───────── */}
      <div className="rr-gridwrap" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          className="rr-grid"
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            // ซ้าย (รายการ) / กลาง (ฟอร์ม · ยืดหดได้) / ขวา (รูป+ประวัติ · กว้างขึ้นให้รูปใหญ่).
            gridTemplateColumns: "minmax(340px, 380px) minmax(0, 1fr) minmax(400px, 460px)",
            // แถวเดียวเต็มความสูงเสมอ → ทุกคอลัมน์ (ลิสต์/ฟอร์ม/ตัวดูรูป) ยืดเต็มแนวตั้ง ไม่เหลือช่องว่าง.
            gridTemplateRows: "minmax(0, 1fr)",
            gap: 10,
            padding: 10,
          }}
        >
          {/* คอลัมน์ซ้าย = ExpenseList ตัวจริง (การ์ด/ตัวกรอง/bulk เหมือน list mode).
              height:100% + overflowY:auto + overscroll:contain → เลื่อนแยกอิสระ (ลิสต์นิ่งเมื่อ
              เลื่อนกลาง/ขวา · ไม่ scroll ทั้งจอตาม) · compact → ExpenseList ยืดเต็ม + sticky top-0. */}
          <div
            style={{
              minHeight: 0,
              height: "100%",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <ExpenseList
              compact
              rows={data.rows}
              categories={data.categories}
              selectedId={selected}
              baseParams={reviewBaseParams}
              status={filter.status as LedgerStatusValue | undefined}
              categoryId={filter.categoryId}
              projectId={filter.projectId}
              projects={data.projects}
              tr={filter.tr}
              cc={filter.cc}
              q={filter.q}
              draftIds={data.draftIds}
              sendableIds={data.sendableIds}
              convertibleIds={data.convertibleIds}
              companyId={data.companyId}
              payreqEnabled={data.payreqEnabled}
              branches={branches}
              tab={filter.tab as ExpenseTab}
              sort={
                filter.sort as
                  | "date-desc"
                  | "date-asc"
                  | "amount-desc"
                  | "amount-asc"
                  | "created-desc"
                  | undefined
              }
              nr={filter.nr}
              pay={filter.pay}
              ap={filter.ap}
              pv={filter.pv}
              statusCounts={statusCounts}
            />
          </div>
          <RRDetailForm data={data} />
          <RRReceiptColumn data={data} />
        </div>
      </div>
    </div>
  );
}

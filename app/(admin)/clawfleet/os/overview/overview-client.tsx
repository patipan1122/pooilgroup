"use client";

/**
 * ตู้คีบ OS — ภาพรวมทุกสาขา · client island.
 * แถบควบคุมบรรทัดเดียว (โหมด date/latest + ช่องวันที่ + สรุปรวม) แล้วการ์ด 1 ใบ/สาขา.
 * เปลี่ยนโหมด/วันที่ → router.push อัปเดต searchParams → server re-fetch (force-dynamic).
 * DENSITY: แน่น · ไม่มีแบนเนอร์อธิบายเต็มแถว · การ์ดกริด · content ขึ้นสูง.
 */

import { useRouter, usePathname } from "next/navigation";
import { CalendarDays, Store, TriangleAlert } from "lucide-react";
import { bahtN, num, TONE } from "@/components/clawfleet/os/format";
import { EmptyState } from "@/components/clawfleet/os/kit";
import type { BranchOverview, BranchOverviewRow } from "@/lib/clawfleet/overview-queries";

type Mode = "date" | "latest";

/** "1 ส.ค. 69" (ปฏิทินไทย · พ.ศ. 2 หลัก) จาก iso "YYYY-MM-DD" */
function thaiDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok",
  }).format(d);
}

export function OverviewClient({
  data, date, mode,
}: {
  data: BranchOverview;
  date: string;
  mode: Mode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { mode?: Mode; date?: string }) {
    const m = next.mode ?? mode;
    const d = next.date ?? date;
    const params = new URLSearchParams();
    params.set("mode", m);
    params.set("date", d); // คงวันที่ไว้เสมอ → สลับกลับมาโหมด date ค่าเดิมยังอยู่
    router.push(`${pathname}?${params.toString()}`);
  }

  const t = data.totals;

  return (
    <div>
      {/* control bar — บรรทัดเดียว: โหมด + วันที่ + สรุปรวม */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {/* segmented mode toggle */}
        <div style={{ display: "inline-flex", background: "#F1F2F5", borderRadius: 10, padding: 3, gap: 3 }}>
          {([["date", "ระบุวัน"], ["latest", "ดูล่าสุด"]] as const).map(([m, label]) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => go({ mode: m })}
                style={{
                  fontSize: 12.5, fontWeight: 700, padding: "6px 15px", borderRadius: 8, border: "none",
                  cursor: "pointer", background: active ? "#fff" : "transparent",
                  color: active ? "#1A1D21" : "#6B7280",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* date picker — เฉพาะโหมด date */}
        {mode === "date" && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 10, padding: "6px 11px" }}>
            <CalendarDays size={15} color="#6B7280" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
              aria-label="เลือกวันที่"
              title="เลือกวันที่"
              style={{ border: "none", background: "transparent", fontSize: 12.5, fontWeight: 600, color: "#1A1D21", outline: "none", cursor: "pointer" }}
            />
          </div>
        )}

        <span style={{ flex: 1 }} />

        {/* สรุปรวมทุกสาขา (compact) */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, fontSize: 12.5, color: "#5A6270", flexWrap: "wrap" }}>
          <span><Store size={13} style={{ verticalAlign: "-2px" }} /> {num(t.branches)} สาขา</span>
          <span>เก็บ <b className="num" style={{ color: "#15803D" }}>{num(t.collected)}</b>/{num(t.machines)}</span>
          {t.missing > 0 && <span>ขาด <b className="num" style={{ color: TONE.amber.text }}>{num(t.missing)}</b></span>}
          <span>เงินรวม <b className="num" style={{ color: t.cashBaht > 0 ? "#15803D" : "#5A6270" }}>{bahtN(t.cashBaht)}</b></span>
          {t.problems > 0 && (
            <span style={{ color: TONE.red.text }}>
              <TriangleAlert size={13} style={{ verticalAlign: "-2px" }} /> ปัญหา <b className="num">{num(t.problems)}</b>
            </span>
          )}
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14 }}>
          <EmptyState
            icon={<Store size={30} />}
            title="ยังไม่มีสาขาให้แสดง"
            sub={
              mode === "date"
                ? `ไม่พบสาขาคีบในขอบเขตของคุณ หรือยังไม่มีข้อมูลวันที่ ${thaiDayLabel(date)}`
                : "ไม่พบสาขาคีบในขอบเขตของคุณ"
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.rows.map((r) => (
            <BranchCard key={r.branchId} r={r} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── การ์ดต่อสาขา ───────── */
function BranchCard({ r, mode }: { r: BranchOverviewRow; mode: Mode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "13px 15px" }}>
      {/* header: ชื่อสาขา + รหัส (+ วันล่าสุดในโหมด latest) */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 11 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1D21", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.branchName}
        </span>
        <span style={{ fontSize: 11.5, color: "#9AA1AB", fontWeight: 600, flex: "0 0 auto" }}>{r.branchCode}</span>
        <span style={{ flex: 1 }} />
        {mode === "latest" && (
          <span style={{ fontSize: 11, color: "#9AA1AB", fontWeight: 600, flex: "0 0 auto" }}>
            {r.dayIso ? `ล่าสุด: ${thaiDayLabel(r.dayIso)}` : "ยังไม่เคยเก็บ"}
          </span>
        )}
      </div>

      {/* แถวสถิติแน่น */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Stat label="ตู้ทั้งหมด" value={num(r.totalMachines)} color="#1A1D21" bg="#F5F6F8" />
        <Stat label="เก็บ" value={num(r.collected)} color="#15803D" bg={TONE.green.soft} />
        <Stat
          label="ขาด"
          value={num(r.missing)}
          color={r.missing > 0 ? TONE.amber.text : "#5A6270"}
          bg={r.missing > 0 ? TONE.amber.soft : "#F5F6F8"}
        />
        <Stat
          label="เงิน"
          value={bahtN(r.cashBaht)}
          color={r.cashBaht > 0 ? "#15803D" : "#5A6270"}
          bg={r.cashBaht > 0 ? TONE.green.soft : "#F5F6F8"}
        />
        <Stat
          label="ปัญหา"
          value={r.problems > 0 ? num(r.problems) : "ไม่มี"}
          color={r.problems > 0 ? TONE.red.text : "#15803D"}
          bg={r.problems > 0 ? TONE.red.soft : TONE.green.soft}
        />
      </div>
    </div>
  );
}

/* pill สถิติเล็ก (label บน · ค่าใต้) — ขนาดตาม DaySummaryCard */
function Stat({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: "7px 12px", minWidth: 62 }}>
      <div style={{ fontSize: 10.5, color: "#6B7280" }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

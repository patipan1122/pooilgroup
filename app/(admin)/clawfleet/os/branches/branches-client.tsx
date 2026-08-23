"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Wallet, Store, AlertTriangle, ArrowRight, Cpu, ChevronRight, Truck, Calendar, Warehouse, Landmark, Users, Copy, Check, UserMinus } from "lucide-react";
import { Kpi, IconBox, Pill, Card, Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN, num, deltaColor, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";
import { reassignCfMachineBranch, setBranchStockSource } from "@/lib/clawfleet/actions";
import { inviteCfStaff, removeCfStaff } from "@/lib/clawfleet/team-actions";
import {
  getClawfleetReconcileStatus,
  setClawfleetReconcileAccount,
  sendClawfleetDepositsToReconcile,
  type ReconcileStatus,
} from "@/lib/clawfleet/reconcile/actions";
import type { CompanyOpt, BankAccountOpt } from "@/lib/cashhub/amazon-settlement-data";
import type { BranchReconcileOverviewRow as ReconcileOverviewRow } from "@/lib/clawfleet/reconcile/overview";

/** สถานะตู้จริงจาก server (cfMachine): ดี / ต้องเติม / เสีย */
export type ServerDotStatus = "good" | "warn" | "broken";

export type BranchRow = {
  branchId: string;
  code: string;
  name: string;
  machines: number;
  dolls: number;
  revenue: number;
  profit: number;
  avgWin: number;
  flag: string;
  /** สถานะรายตู้จริง (เรียงตาม code) — ว่าง = ไม่มีข้อมูลตู้ */
  dots: ServerDotStatus[];
};

/** surface-existing (reassign) — ตัวเลือกตู้ + สาขา (แอดมินเท่านั้น) */
export type MachineOption = {
  id: string;
  code: string;
  nickname: string | null;
  branchId: string;
  branchName: string;
  isActive: boolean;
};
export type BranchOption = { id: string; name: string; code: string };

/* ── per-machine status dots — ใช้ "สถานะตู้จริง" จาก server (cfMachine) เท่านั้น ──
 * ถ้าสาขาไม่มีข้อมูลตู้จริง (dots ว่าง) จะ "ไม่แสดง" แถบจุด — ไม่จำลอง เพื่อไม่ให้เข้าใจผิดว่าตู้สุขภาพดี/เสีย */
type DotKind = "good" | "warn" | "broken";
const DOT: Record<DotKind, { bg: string; letter: string; title: string }> = {
  good: { bg: "#2FA866", letter: "✓", title: "กำลังดี" },
  warn: { bg: "#E8A33D", letter: "!", title: "ตุ๊กตาใกล้หมด · ต้องเติม" },
  broken: { bg: "#B9BEC7", letter: "–", title: "ตู้เสีย (ปิดใช้งาน)" },
};

/** map สถานะตู้จริงจาก server → DotKind (real มีแค่ good/warn/broken) */
function realDots(dots: ServerDotStatus[]): DotKind[] {
  return dots.map((d) => (d === "warn" ? "warn" : d === "broken" ? "broken" : "good"));
}

/** "YYYY-MM-DD" → "1 ก.ค. 68" (พ.ศ. ย่อ) · ค่าเสีย → คืน string เดิม (graceful) */
function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return iso;
  return `${Number(m[3])} ${months[mo - 1]} ${(Number(m[1]) + 543) % 100}`;
}

/** สไตล์ชิปปุ่มลัดช่วงเวลา — active = indigo ทึบ · ปกติ = ขาวกดได้ (reuse โทน/ขนาดเดิมในหน้า) */
function quickChipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8,
    textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center",
    border: active ? "1px solid #4F46E5" : "1px solid #E3E6EA",
    background: active ? "#4F46E5" : "#fff",
    color: active ? "#fff" : "#5A6270",
    cursor: "pointer",
  };
}

/** ช่อง <input type=date> ในแถบช่วงวันที่ — โปร่ง ไร้กรอบ (กรอบอยู่ที่กล่องหุ้ม) */
const DATE_INPUT_STYLE: React.CSSProperties = {
  border: "none", background: "transparent", fontSize: 12.5, fontWeight: 600,
  color: "#1A1D21", outline: "none", cursor: "pointer",
};

export function BranchesClient({
  branches,
  isAdmin = false,
  machineOptions = [],
  branchOptions = [],
  stockSourceByBranch = {},
  companies = [],
  bankAccounts = [],
  reconcileOverview = [],
  fromISO = "",
  toISO = "",
}: {
  branches: BranchRow[];
  // surface-existing (reassign) — โชว์การ์ด "ย้ายตู้ข้ามสาขา" เฉพาะแอดมิน (server assert อยู่แล้ว)
  isAdmin?: boolean;
  machineOptions?: MachineOption[];
  branchOptions?: BranchOption[];
  // คลังหลักข้ามสาขา — map branchId → คลังต้นทาง (null = ใช้คลังตัวเอง)
  stockSourceByBranch?: Record<string, string | null>;
  // ผูกบัญชีธนาคาร + ส่งเข้า reconcile (CEO 2026-08-23) — ตัวเลือกบริษัท/บัญชีธนาคาร (แอดมินเท่านั้น)
  companies?: CompanyOpt[];
  bankAccounts?: BankAccountOpt[];
  // สรุปรายสาขา (สาขานำหน้า) — พนักงาน/ผูกบัญชีแล้วยัง/เก็บเงินล่าสุด (CEO 2026-08-23)
  reconcileOverview?: ReconcileOverviewRow[];
  // ช่วงวันที่ปัจจุบัน (YYYY-MM-DD) — สถิติ P&L ต่อสาขาอิงช่วงนี้ · เติมค่า <input type=date> + คง state ใน link
  fromISO?: string;
  toISO?: string;
}) {
  const empty = branches.length === 0;
  // ห้าม fallback SAMPLE — ใช้ข้อมูลจริงเสมอ · ว่าง = โชว์ empty-state
  const rows = branches;
  const [openId, setOpenId] = useState<string | null>(null);

  // ── ช่วงวันที่ (local input state) · กด "ดูช่วงนี้" → soft-nav ผ่าน <Link> ──
  const [fromInput, setFromInput] = useState(fromISO);
  const [toInput, setToInput] = useState(toISO);

  // ── ปุ่มลัดช่วงเวลา (วันนี้/เมื่อวาน/7 วัน/เดือนนี้) — "วันตามปฏิทินเครื่อง" (local) ให้ตรงกับที่ server parse ──
  const quickRanges = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const todayI = isoLocal(now);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const wk = new Date(now); wk.setDate(now.getDate() - 6);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return [
      { key: "today", label: "วันนี้", from: todayI, to: todayI },
      { key: "yesterday", label: "เมื่อวาน", from: isoLocal(yest), to: isoLocal(yest) },
      { key: "7d", label: "7 วัน", from: isoLocal(wk), to: todayI },
      { key: "month", label: "เดือนนี้", from: isoLocal(firstOfMonth), to: todayI },
    ];
  }, []);
  /** href ปุ่มลัด — set ช่วง (soft-nav) */
  const quickHref = (from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return `?${q.toString()}`;
  };
  /** href เปลี่ยนช่วงวันที่ (จากค่า input) */
  const rangeHref = (() => {
    const q = new URLSearchParams();
    if (fromInput) q.set("from", fromInput);
    if (toInput) q.set("to", toInput);
    return `?${q.toString()}`;
  })();
  // ช่วง input ต่างจากที่ query อยู่ตอนนี้ไหม (เปิดปุ่ม "ดูช่วงนี้" เฉพาะเมื่อเปลี่ยน)
  const rangeDirty = fromInput !== fromISO || toInput !== toISO;

  // ป้ายช่วงที่เลือก (แทนคำว่า "7 วัน" ที่ hardcode) — ตรงกับปุ่มลัดถ้าเข้าคู่ · ไม่งั้นโชว์วันที่จริง
  const rangeLabel = useMemo(() => {
    const q = quickRanges.find((r) => r.from === fromISO && r.to === toISO);
    if (q) return q.label;
    if (fromISO && toISO) return fromISO === toISO ? thaiDate(fromISO) : `${thaiDate(fromISO)}–${thaiDate(toISO)}`;
    return "วันนี้";
  }, [quickRanges, fromISO, toISO]);

  const totMachines = rows.reduce((s, b) => s + b.machines, 0);
  const totRevenue = rows.reduce((s, b) => s + b.revenue, 0);
  const problem = rows.filter((b) => b.flag === "HIGH" || b.flag === "LOSS" || b.flag === "AMBER").length;

  // ว่างจริง (ยังไม่มีสาขา) → โชว์ empty-state ตรง ๆ · ไม่เรนเดอร์ KPI/การ์ดที่เต็มไปด้วยเลข 0
  if (empty) {
    return (
      <div>
        <EmptyState
          icon={<Store size={30} />}
          title="ยังไม่มีสาขา"
          sub="เพิ่มสาขาตู้คีบ + ผูกตู้เข้าสาขา เพื่อเริ่มเก็บเงิน"
        />
      </div>
    );
  }

  return (
    <div>
      {/* ── แถบเลือกช่วงวันที่ (ปุ่มลัด + จาก/ถึง) — สถิติ P&L ทุกการ์ดด้านล่างขยับตามช่วงนี้ ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {/* ปุ่มลัด — กดปุ๊บกรองเลย ไม่ต้องเปิดปฏิทินทีละช่อง (CEO ขอ วันนี้/เมื่อวาน/7 วัน/เดือนนี้) */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {quickRanges.map((q) => {
            const active = fromISO === q.from && toISO === q.to;
            return (
              <Link key={q.key} href={quickHref(q.from, q.to)} className="co-tap" style={quickChipStyle(active)}>
                {q.label}
              </Link>
            );
          })}
        </div>

        {/* ช่วงวันที่ (จาก/ถึง) · กด "ดูช่วงนี้" → soft-nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 10, padding: "6px 10px", flexWrap: "wrap" }}>
          <Calendar size={15} color="#6B7280" style={{ flex: "0 0 15px" }} />
          <input
            type="date"
            value={fromInput}
            max={toInput || undefined}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label="วันที่เริ่มต้น"
            title="วันที่เริ่มต้น"
            style={DATE_INPUT_STYLE}
          />
          <span style={{ fontSize: 12, color: "#9AA1AB" }}>ถึง</span>
          <input
            type="date"
            value={toInput}
            min={fromInput || undefined}
            onChange={(e) => setToInput(e.target.value)}
            aria-label="วันที่สิ้นสุด"
            title="วันที่สิ้นสุด"
            style={DATE_INPUT_STYLE}
          />
          {rangeDirty ? (
            <Link
              href={rangeHref}
              style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#4F46E5", padding: "5px 12px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              ดูช่วงนี้
            </Link>
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#C2C7CF" }}>ดูช่วงนี้</span>
          )}
        </div>
      </div>

      {/* ── 4 KPI summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <Kpi icon={<Store size={16} />} label="สาขาทั้งหมด" value={`${num(rows.length)} สาขา`} delta="ทั่วกรุงเทพฯ–ปริมณฑล" deltaColor="#9AA1AB" />
        <Kpi icon={<Boxes size={16} />} iconTone="neutral" label="ตู้คีบรวม" value={`${num(totMachines)} ตู้`} delta={`${rows.length} สาขา`} deltaColor="#9AA1AB" />
        <Kpi icon={<Wallet size={16} />} iconTone="green" label={`รายได้รวม · ${rangeLabel}`} value={bahtN(totRevenue)} valueColor="#15803D" delta="ก่อนหักต้นทุนตุ๊กตา" deltaColor="#9AA1AB" />
        <Kpi icon={<AlertTriangle size={16} />} iconTone="red" label="สาขาที่ต้องดู" value={`${num(problem)} สาขา`} valueColor="#B42318" delta="ตั้งค่าตู้เพี้ยน/ขาดทุน" deltaColor="#C2756C" />
      </div>

      {/* ── branches grid: 2 คอลัมน์ desktop → 1 คอลัมน์มือถือ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((b) => {
          const t = pnlTone(b.flag as PnlFlagKey);
          const open = openId === b.branchId;
          // เฉพาะสถานะตู้จริงจาก server · ถ้าไม่มีข้อมูลตู้จริง (DB ว่าง/สาขายังไม่ผูกตู้) = ไม่แสดงจุด
          const dots = b.dots.length > 0 ? realDots(b.dots) : [];
          const hasRealDots = dots.length > 0;
          return (
            <div key={b.branchId} className="co-card" style={{ padding: "18px 20px" }}>
              {/* header: code chip + name + flag pill */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <IconBox tone="neutral" size={42} radius={11} bg="#F1F2F7" color="#4F46E5">
                  <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{b.code}</span>
                </IconBox>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>{b.name}</div>
                  <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                    <span className="num">{b.machines}</span> ตู้ · <span className="num">{b.dolls}</span> ตัวออก ({rangeLabel})
                  </div>
                </div>
                <Pill tone={t.tone as Tone}>{t.label}</Pill>
              </div>

              {/* stats row: รายได้ / กำไร / ต้นทุน(เฉลี่ย บาท/ตัว) */}
              <div style={{ display: "flex", gap: 26, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>รายได้ {rangeLabel}</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>{bahtN(b.revenue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>กำไรสุทธิ</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: deltaColor(b.profit) }}>
                    {b.profit >= 0 ? "+" : ""}{bahtN(b.profit)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9AA1AB", marginBottom: 3 }}>เฉลี่ย บาท/ตัว</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: t.tone === "green" ? "#15803D" : t.tone === "red" ? "#B42318" : "#B45309" }}>
                    ฿{b.avgWin}
                  </div>
                </div>
              </div>

              {/* footer: dot strip (เฉพาะเมื่อมีสถานะตู้จริง) + ปุ่มเจาะดูในหน้า matrix */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 14, borderTop: "1px solid #F4F5F7" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>สถานะตู้ในสาขา</div>
                  {hasRealDots ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {dots.map((d, i) => {
                        const cfg = DOT[d];
                        return (
                          <span
                            key={i}
                            title={cfg.title}
                            style={{ width: 18, height: 18, borderRadius: 5, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9.5, fontWeight: 700, lineHeight: 1, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
                          >
                            {cfg.letter}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>ยังไม่มีข้อมูลสถานะตู้</div>
                  )}
                </div>
                {hasRealDots ? (
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : b.branchId)}
                    className="co-tap"
                    style={{
                      border: "1px solid #E3E6EA",
                      background: open ? "#EEF0FE" : "#fff",
                      color: open ? "#4F46E5" : "#454B54",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "7px 13px",
                      borderRadius: 9,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      whiteSpace: "nowrap",
                    }}
                  >
                    ดูรายตู้ <ChevronRight size={15} style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }} />
                  </button>
                ) : (
                  <Link
                    href={`/clawfleet/os/matrix?branch=${encodeURIComponent(b.code)}`}
                    className="co-tap"
                    style={{ textDecoration: "none", border: "1px solid #E3E6EA", background: "#fff", color: "#454B54", fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 9, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
                  >
                    เจาะดู <ArrowRight size={13} />
                  </Link>
                )}
              </div>

              {/* expandable detail — สรุปสถานะตู้จริง (นับตามสถานะ · ไม่กุรหัสตู้/เวลาเก็บปลอม) */}
              {open && hasRealDots && (() => {
                const goodN = dots.filter((d) => d === "good").length;
                const warnN = dots.filter((d) => d === "warn").length;
                const brokenN = dots.filter((d) => d === "broken").length;
                const breakdown = ([
                  { kind: "good", n: goodN },
                  { kind: "warn", n: warnN },
                  { kind: "broken", n: brokenN },
                ] as { kind: DotKind; n: number }[]).filter((x) => x.n > 0);
                return (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F4F5F7" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                      <span style={{ fontSize: 11, color: "#9AA1AB" }}>สรุปสถานะตู้ในสาขา ({dots.length} ตู้)</span>
                      <span style={{ flex: 1 }} />
                      <Link
                        href={`/clawfleet/os/matrix?branch=${encodeURIComponent(b.code)}`}
                        style={{ textDecoration: "none", fontSize: 10.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "5px 11px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        ดูรายตู้ในหน้าเจาะดู <ArrowRight size={12} />
                      </Link>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {breakdown.map(({ kind, n }) => {
                        const cfg = DOT[kind];
                        const st = pnlTone(kind === "good" ? "GOOD" : kind === "warn" ? "AMBER" : "NODATA");
                        return (
                          <div key={kind} style={{ display: "flex", alignItems: "center", gap: 11, background: "#F8F9FB", borderRadius: 10, padding: "9px 11px" }}>
                            <span style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 8, background: "#EAECF1", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AB" }}>
                              <Cpu size={16} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
                              <Pill tone={st.tone as Tone}>{cfg.title}</Pill>
                              <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54" }}>{n} ตู้</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* ── surface-existing: ย้ายตู้ข้ามสาขา (แอดมินเท่านั้น) ── */}
      {isAdmin && <ReassignMachineCard machineOptions={machineOptions} branchOptions={branchOptions} />}

      {/* ── คลังหลักข้ามสาขา: ตั้งให้สาขาใช้คลังของสาขาอื่น (แอดมินเท่านั้น) ── */}
      {isAdmin && <WarehouseSourceCard branchOptions={branchOptions} stockSourceByBranch={stockSourceByBranch} />}

      {/* ── ผูกบัญชีธนาคาร + ส่งเข้า reconcile (CEO 2026-08-23 · แอดมินเท่านั้น) ── */}
      {isAdmin && <ReconcileAccountCard branchOptions={branchOptions} companies={companies} bankAccounts={bankAccounts} overview={reconcileOverview} />}

      {/* ── legend: ความหมายของช่องสถานะตู้ ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          marginTop: 18,
          padding: "13px 18px",
          background: "#fff",
          border: "1px solid #E8EAED",
          borderRadius: 12,
          fontSize: 11.5,
          color: "#6B7280",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, color: "#454B54" }}>สถานะตู้ (ตัวย่อในช่อง · ชี้เมาส์ดูได้):</span>
        {(["good", "warn", "broken"] as DotKind[]).map((k) => {
          const cfg = DOT[k];
          return (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9.5, fontWeight: 700, lineHeight: 1, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>{cfg.letter}</span>
              {cfg.title}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * surface-existing — ย้ายตู้ข้ามสาขา (admin only · server = assertCfAdmin)
 *  เลือกตู้ → เลือกสาขาปลายทาง → ยืนยัน → reassignCfMachineBranch.
 *  ⚠️ ย้ายไปข้างหน้าเท่านั้น · ประวัติเก่า (การเก็บ/เคลื่อนไหว) คงสาขาเดิมไว้.
 * ───────────────────────────────────────────────────────────────────────── */
const R_FIELD: React.CSSProperties = {
  width: "100%", fontSize: 13, padding: "10px 12px", borderRadius: 10,
  border: "1px solid #E3E6EA", background: "#fff", color: "#1A1D21", outline: "none",
};
const R_LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5A6270", marginBottom: 6, display: "block" };

function ReassignMachineCard({
  machineOptions,
  branchOptions,
}: {
  machineOptions: MachineOption[];
  branchOptions: BranchOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canUse = machineOptions.length > 0 && branchOptions.length >= 2;
  const selected = machineOptions.find((m) => m.id === machineId) ?? null;

  function reset() {
    setMachineId(""); setToBranchId(""); setError(null);
  }
  function openModal() {
    reset();
    setOkMsg(null);
    setOpen(true);
  }
  function submit() {
    setError(null);
    if (!machineId) { setError("เลือกตู้ที่จะย้าย"); return; }
    if (!toBranchId) { setError("เลือกสาขาปลายทาง"); return; }
    if (selected && selected.branchId === toBranchId) { setError("ตู้อยู่ในสาขานี้อยู่แล้ว — เลือกสาขาอื่น"); return; }

    startTransition(async () => {
      const res = await reassignCfMachineBranch(machineId, toBranchId);
      if (!res.ok) { setError(res.error); return; }
      const mName = selected ? selected.code : "ตู้";
      const bName = branchOptions.find((b) => b.id === toBranchId)?.name ?? "สาขาใหม่";
      setOkMsg(`ย้าย ${mName} ไปสาขา ${bName} แล้ว`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 18 }}>
      <Card
        title="ย้ายตู้ข้ามสาขา"
        sub="สำหรับแอดมิน — ย้ายตู้คีบไปอยู่สาขาอื่น (ประวัติเก่าคงสาขาเดิม · ย้ายไปข้างหน้าเท่านั้น)"
        right={
          <button
            type="button"
            onClick={openModal}
            disabled={!canUse}
            className="co-tap"
            style={{
              border: "none", cursor: canUse ? "pointer" : "not-allowed",
              background: canUse ? "#4F46E5" : "#C7C4EE", color: "#fff",
              fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 10,
              display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
            }}
          >
            <Truck size={15} /> ย้ายตู้
          </button>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#6B7280" }}>
          <IconBox tone="neutral" size={38} radius={10} bg="#F1F2F7" color="#9AA1AB"><Cpu size={17} /></IconBox>
          <div style={{ flex: 1 }}>
            {canUse
              ? <>มีตู้ในระบบ <b className="num" style={{ color: "#454B54" }}>{num(machineOptions.length)}</b> ตู้ · กด “ย้ายตู้” เพื่อเลือกตู้และสาขาปลายทาง</>
              : "ต้องมีตู้อย่างน้อย 1 ตู้ และสาขาตู้คีบอย่างน้อย 2 สาขา ถึงจะย้ายได้"}
          </div>
        </div>
        {okMsg && (
          <div style={{ marginTop: 12, background: "#E7F4EC", border: "1px solid #BBE3C9", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, color: "#15803D" }}>
            {okMsg}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => { if (!pending) { setOpen(false); reset(); } }}
        width={500}
        title="ย้ายตู้ไปสาขาอื่น"
        sub="ประวัติการเก็บเงิน/สต๊อกเดิมจะยังผูกกับสาขาเดิม — ย้ายมีผลนับจากนี้ไป"
        footer={
          <div style={{ display: "flex", gap: 10, padding: "14px 20px" }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              style={{ flex: 1, border: "none", cursor: pending ? "wait" : "pointer", background: pending ? "#A5A0EC" : "#4F46E5", color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "11px 0", borderRadius: 10 }}
            >
              {pending ? "กำลังย้าย…" : "ยืนยันย้ายตู้"}
            </button>
            <button
              type="button"
              onClick={() => { if (!pending) { setOpen(false); reset(); } }}
              disabled={pending}
              style={{ border: "1px solid #E3E6EA", background: "#fff", cursor: pending ? "not-allowed" : "pointer", color: "#6B7280", fontSize: 13.5, fontWeight: 600, padding: "11px 20px", borderRadius: 10 }}
            >
              ยกเลิก
            </button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={R_LABEL}>ตู้ที่จะย้าย</label>
            <select
              aria-label="เลือกตู้ที่จะย้าย"
              value={machineId}
              onChange={(e) => { setMachineId(e.target.value); setError(null); }}
              style={R_FIELD}
            >
              <option value="">— เลือกตู้ —</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code}{m.nickname ? ` (${m.nickname})` : ""} · อยู่ {m.branchName}{!m.isActive ? " · ปิดใช้งาน" : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9AA1AB", fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>สาขาปัจจุบัน:</span>
            <span style={{ color: "#454B54", fontWeight: 600 }}>{selected ? selected.branchName : "—"}</span>
            <ArrowRight size={15} />
            <span style={{ fontWeight: 600 }}>ปลายทาง</span>
          </div>

          <div>
            <label style={R_LABEL}>สาขาปลายทาง</label>
            <select
              aria-label="เลือกสาขาปลายทาง"
              value={toBranchId}
              onChange={(e) => { setToBranchId(e.target.value); setError(null); }}
              style={R_FIELD}
            >
              <option value="">— เลือกสาขา —</option>
              {branchOptions
                .filter((b) => !selected || b.id !== selected.branchId)
                .map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
            </select>
          </div>

          <div style={{ fontSize: 11.5, color: "#B45309", background: "#FCF6EC", border: "1px solid #F0E2BE", borderRadius: 9, padding: "9px 12px" }}>
            หมายเหตุ: ตู้จะหลุดจากกลุ่ม (group) ของสาขาเดิมโดยอัตโนมัติ · ประวัติการเก็บเงินและการเคลื่อนไหวสต๊อกเดิมยังคงอยู่ที่สาขาเดิม (ย้ายมีผลนับจากนี้ไปเท่านั้น)
          </div>

          {error && (
            <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#B42318" }}>{error}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * คลังหลักข้ามสาขา (admin only · server = assertCfAdmin + กันทอดซ้อน)
 *  เลือกสาขา → เลือกคลังต้นทาง (หรือ "ใช้คลังตัวเอง") → ยืนยัน → setBranchStockSource.
 *  ผล: เวลาเติมตู้สาขานี้ ดึงของจากคลังสาขาต้นทาง (โอนเข้ามาก่อนแล้วเข้าตู้) · คืนสโตร์โอนกลับ.
 * ───────────────────────────────────────────────────────────────────────── */
function WarehouseSourceCard({
  branchOptions,
  stockSourceByBranch,
}: {
  branchOptions: BranchOption[];
  stockSourceByBranch: Record<string, string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [sourceBranchId, setSourceBranchId] = useState(""); // "" = ใช้คลังตัวเอง
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canUse = branchOptions.length >= 2;
  const nameOf = (id: string | null | undefined) =>
    id ? (branchOptions.find((b) => b.id === id)?.name ?? "—") : null;
  const configuredCount = Object.values(stockSourceByBranch).filter(Boolean).length;

  function openModal() {
    setBranchId(""); setSourceBranchId(""); setError(null); setOkMsg(null);
    setOpen(true);
  }
  // เมื่อเลือกสาขา → เติมค่าคลังต้นทางปัจจุบันให้ (แก้ง่าย)
  function pickBranch(id: string) {
    setBranchId(id);
    setSourceBranchId(stockSourceByBranch[id] ?? "");
    setError(null);
  }
  function submit() {
    setError(null);
    if (!branchId) { setError("เลือกสาขาที่จะตั้งค่า"); return; }
    if (sourceBranchId && sourceBranchId === branchId) { setError("เลือกคลังต้นทางเป็นสาขาตัวเองไม่ได้"); return; }
    startTransition(async () => {
      const res = await setBranchStockSource({ branchId, sourceBranchId: sourceBranchId || null });
      if (!res.ok) { setError(res.error); return; }
      const bName = nameOf(branchId);
      setOkMsg(sourceBranchId ? `${bName} ใช้คลังของ ${nameOf(sourceBranchId)} เป็นคลังหลักแล้ว` : `${bName} กลับไปใช้คลังตัวเองแล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 18 }}>
      <Card
        title="คลังหลักข้ามสาขา"
        sub="สำหรับแอดมิน — ตั้งให้สาขาหนึ่งใช้คลังของอีกสาขาเป็นคลังหลัก (เติมตู้ดึงจากคลังนั้น · คืนสโตร์ก็โอนกลับ)"
        right={
          <button
            type="button"
            onClick={openModal}
            disabled={!canUse}
            className="co-tap"
            style={{
              border: "none", cursor: canUse ? "pointer" : "not-allowed",
              background: canUse ? "#4F46E5" : "#C7C4EE", color: "#fff",
              fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 10,
              display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
            }}
          >
            <Warehouse size={15} /> ตั้งคลังหลัก
          </button>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#6B7280" }}>
          <IconBox tone="neutral" size={38} radius={10} bg="#F1F2F7" color="#9AA1AB"><Warehouse size={17} /></IconBox>
          <div style={{ flex: 1 }}>
            {canUse
              ? <>ตั้งไว้แล้ว <b className="num" style={{ color: "#454B54" }}>{num(configuredCount)}</b> สาขา · กด “ตั้งคลังหลัก” เพื่อเลือกสาขาและคลังต้นทาง</>
              : "ต้องมีสาขาตู้คีบอย่างน้อย 2 สาขา ถึงจะตั้งคลังข้ามสาขาได้"}
          </div>
        </div>
        {okMsg && (
          <div style={{ marginTop: 12, background: "#E7F4EC", border: "1px solid #BBE3C9", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, color: "#15803D" }}>
            {okMsg}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => { if (!pending) { setOpen(false); } }}
        width={500}
        title="ตั้งคลังหลักของสาขา"
        sub="เลือกสาขา แล้วเลือกว่าจะใช้คลังของสาขาไหนเป็นคลังหลัก (หรือใช้คลังตัวเอง)"
        footer={
          <div style={{ display: "flex", gap: 10, padding: "14px 20px" }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              style={{ flex: 1, border: "none", cursor: pending ? "wait" : "pointer", background: pending ? "#A5A0EC" : "#4F46E5", color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "11px 0", borderRadius: 10 }}
            >
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
            <button
              type="button"
              onClick={() => { if (!pending) { setOpen(false); } }}
              disabled={pending}
              style={{ border: "1px solid #E3E6EA", background: "#fff", cursor: pending ? "not-allowed" : "pointer", color: "#6B7280", fontSize: 13.5, fontWeight: 600, padding: "11px 20px", borderRadius: 10 }}
            >
              ยกเลิก
            </button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={R_LABEL}>สาขาที่จะตั้งค่า</label>
            <select aria-label="เลือกสาขาที่จะตั้งค่า" value={branchId} onChange={(e) => pickBranch(e.target.value)} style={R_FIELD}>
              <option value="">— เลือกสาขา —</option>
              {branchOptions.map((b) => {
                const cur = stockSourceByBranch[b.id];
                return (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code}){cur ? ` · ใช้คลัง ${nameOf(cur)}` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9AA1AB", fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>คลังหลักปัจจุบัน:</span>
            <span style={{ color: "#454B54", fontWeight: 600 }}>{branchId ? (nameOf(stockSourceByBranch[branchId]) ?? "คลังตัวเอง") : "—"}</span>
            <ArrowRight size={15} />
            <span style={{ fontWeight: 600 }}>ใหม่</span>
          </div>

          <div>
            <label style={R_LABEL}>ใช้คลังของ</label>
            <select aria-label="เลือกคลังต้นทาง" value={sourceBranchId} onChange={(e) => { setSourceBranchId(e.target.value); setError(null); }} style={R_FIELD}>
              <option value="">ใช้คลังตัวเอง (ค่าเริ่มต้น)</option>
              {branchOptions
                .filter((b) => b.id !== branchId && !stockSourceByBranch[b.id]) // ต้นทางต้องใช้คลังตัวเอง (กันทอดซ้อน)
                .map((b) => (
                  <option key={b.id} value={b.id}>คลังของ {b.name} ({b.code})</option>
                ))}
            </select>
          </div>

          <div style={{ fontSize: 11.5, color: "#B45309", background: "#FCF6EC", border: "1px solid #F0E2BE", borderRadius: 9, padding: "9px 12px" }}>
            เวลาเติมตู้สาขานี้ ระบบจะดึงของจากคลังต้นทาง (โอนเข้ามาเป็นของสาขานี้ก่อนแล้วเข้าตู้) · คืนตุ๊กตากลับก็จะโอนคืนคลังต้นทางให้อัตโนมัติ · สต๊อก/ต้นทุนตรงตามจริง
          </div>

          {error && (
            <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#B42318" }}>{error}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ผูกบัญชีธนาคาร + ส่งเข้า reconcile (admin only · server = assertCfAdmin)
 *  CEO 2026-08-23 — 1 บัญชีตายตัวต่อสาขา. เลือกสาขา → ตั้งบริษัท/บัญชีธนาคาร →
 *  กดส่งยอดฝาก (CfCashDeposit ที่ผ่านตรวจแล้ว) เข้า ledger_revenue_entry (LedgerLine
 *  bank-recon). กดส่งซ้ำได้ตลอด — ระบบข้ามรายการที่ส่งแล้วให้อัตโนมัติ (idempotent ·
 *  ดู lib/clawfleet/reconcile/ledger-push.ts).
 * ───────────────────────────────────────────────────────────────────────── */
function ReconcileAccountCard({
  branchOptions,
  companies,
  bankAccounts,
  overview,
}: {
  branchOptions: BranchOption[];
  companies: CompanyOpt[];
  bankAccounts: BankAccountOpt[];
  overview: ReconcileOverviewRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<ReconcileStatus["summary"] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [staffModalBranchId, setStaffModalBranchId] = useState<string | null>(null);

  const canUse = branchOptions.length > 0 && companies.length > 0 && bankAccounts.length > 0;
  const bankLabelById = useMemo(() => new Map(bankAccounts.map((a) => [a.id, a.label])), [bankAccounts]);
  const staffModalBranch = overview.find((r) => r.branchId === staffModalBranchId) ?? null;

  function openModalFor(id: string) {
    setError(null); setOkMsg(null);
    setOpen(true);
    pickBranch(id);
  }

  function pickBranch(id: string) {
    setBranchId(id);
    setStatus(null);
    setError(null);
    if (!id) return;
    setLoadingStatus(true);
    startTransition(async () => {
      const res = await getClawfleetReconcileStatus(id);
      setLoadingStatus(false);
      if (!res.ok) { setError(res.error); return; }
      setStatus(res.data.summary);
      setCompanyId(res.data.companyId ?? "");
      setBankAccountId(res.data.bankAccountId ?? "");
    });
  }

  function saveConfig() {
    setError(null);
    if (!branchId) { setError("เลือกสาขาก่อน"); return; }
    if (!companyId || !bankAccountId) { setError("เลือกบริษัทและบัญชีธนาคารให้ครบ"); return; }
    startTransition(async () => {
      const res = await setClawfleetReconcileAccount({ branchId, companyId, bankAccountId });
      if (!res.ok) { setError(res.error); return; }
      setOkMsg("บันทึกบัญชีธนาคารของสาขานี้แล้ว");
      pickBranch(branchId); // โหลดสรุปใหม่ (configured=true แล้ว)
      router.refresh();
    });
  }

  function sendToReconcile() {
    setError(null);
    if (!branchId) return;
    startTransition(async () => {
      const res = await sendClawfleetDepositsToReconcile({ branchId });
      if (!res.ok) { setError(res.error); return; }
      setOkMsg(
        `ส่งเข้าบัญชี reconcile แล้ว ${res.data.inserted} ใบ` +
        (res.data.pendingReviewSkipped > 0 ? ` · ข้าม ${res.data.pendingReviewSkipped} ใบ (รอตรวจสอบก่อน)` : "")
      );
      pickBranch(branchId); // โหลดสรุปใหม่ (readyCount ควรลดลง/เท่าเดิมถ้ากดซ้ำ)
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 18 }}>
      <Card
        title="ผูกบัญชีธนาคาร + ส่งเข้า reconcile"
        sub="สาขานำหน้า — ดูได้ทีเดียวว่าสาขาไหนมีพนักงานยัง ผูกบัญชียัง เก็บเงินล่าสุดกี่วันก่อน แล้วกดผูกบัญชีจากแถวได้เลย"
      >
        {!canUse ? (
          <div style={{ fontSize: 12.5, color: "#6B7280" }}>
            ต้องมีสาขาตู้คีบ + บริษัท + บัญชีธนาคารในระบบก่อน ถึงจะตั้งค่าได้
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#8A90A0", fontSize: 11 }}>
                  <th style={{ padding: "0 10px 8px 0", fontWeight: 600 }}>สาขา</th>
                  <th style={{ padding: "0 10px 8px", fontWeight: 600 }}>พนักงาน</th>
                  <th style={{ padding: "0 10px 8px", fontWeight: 600 }}>บัญชีธนาคาร</th>
                  <th style={{ padding: "0 10px 8px", fontWeight: 600 }}>เก็บเงินล่าสุด</th>
                  <th style={{ padding: "0 0 8px", fontWeight: 600 }} />
                </tr>
              </thead>
              <tbody>
                {overview.map((r) => {
                  const bankLabel = r.bankAccountId ? bankLabelById.get(r.bankAccountId) : null;
                  return (
                    <tr key={r.branchId} style={{ borderTop: "1px solid #F0F1F4" }}>
                      <td style={{ padding: "9px 10px 9px 0", fontWeight: 600, color: "#1A1D21", whiteSpace: "nowrap" }}>
                        {r.branchName} <span style={{ color: "#9AA1AB", fontWeight: 500 }}>({r.branchCode})</span>
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <button
                          type="button"
                          onClick={() => setStaffModalBranchId(r.branchId)}
                          className="co-tap"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            border: "none", background: "transparent", cursor: "pointer", padding: 0,
                            fontSize: 12.5, fontWeight: 600,
                            color: r.staff.length > 0 ? "#15803D" : "#B42318", textDecoration: "underline", textUnderlineOffset: 2,
                          }}
                        >
                          <Users size={12} /> {r.staff.length > 0 ? `${r.staff.length} คน` : "ยังไม่มี"}
                        </button>
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        {bankLabel ? (
                          <span style={{ color: "#15803D" }}>{bankLabel}</span>
                        ) : (
                          <span style={{ color: "#B45309" }}>ยังไม่ผูก</span>
                        )}
                      </td>
                      <td style={{ padding: "9px 10px", color: r.lastCollectedAt ? "#3A414B" : "#9AA1AB", whiteSpace: "nowrap" }}>
                        {r.lastCollectedLabel}
                      </td>
                      <td style={{ padding: "9px 0", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => openModalFor(r.branchId)}
                          className="co-tap"
                          style={{
                            border: "none", cursor: "pointer",
                            background: bankLabel ? "#F1F2F7" : "#4F46E5",
                            color: bankLabel ? "#454B54" : "#fff",
                            fontSize: 11.5, fontWeight: 600, padding: "6px 11px", borderRadius: 8,
                            display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                          }}
                        >
                          <Landmark size={12} /> {bankLabel ? "แก้ไข" : "ผูกบัญชี"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {okMsg && (
          <div style={{ marginTop: 12, background: "#E7F4EC", border: "1px solid #BBE3C9", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, color: "#15803D" }}>
            {okMsg}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => { if (!pending) setOpen(false); }}
        width={520}
        title="ผูกบัญชีธนาคาร + ส่งเข้า reconcile"
        sub="1 บัญชีตายตัวต่อสาขา — ยอดฝากที่ผ่านตรวจแล้วจะพร้อมส่งเข้า LedgerLine bank-recon"
        footer={
          <div style={{ display: "flex", gap: 10, padding: "14px 20px" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              style={{ flex: 1, border: "1px solid #E3E6EA", background: "#fff", cursor: pending ? "not-allowed" : "pointer", color: "#6B7280", fontSize: 13.5, fontWeight: 600, padding: "11px 0", borderRadius: 10 }}
            >
              ปิด
            </button>
          </div>
        }
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={R_LABEL}>สาขา</label>
            <select aria-label="เลือกสาขา" value={branchId} onChange={(e) => pickBranch(e.target.value)} style={R_FIELD}>
              <option value="">— เลือกสาขา —</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>

          {loadingStatus && <div style={{ fontSize: 12.5, color: "#9AA1AB" }}>กำลังโหลดสถานะ…</div>}

          {branchId && !loadingStatus && status && (
            <>
              <div>
                <label style={R_LABEL}>บริษัทที่เงินเข้า</label>
                <select aria-label="เลือกบริษัท" value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={R_FIELD}>
                  <option value="" disabled>เลือกบริษัท…</option>
                  {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label style={R_LABEL}>บัญชีธนาคารที่เงินเข้า</label>
                <select aria-label="เลือกบัญชีธนาคาร" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} style={R_FIELD}>
                  <option value="" disabled>เลือกบัญชี…</option>
                  {bankAccounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                </select>
              </div>
              <button
                type="button"
                onClick={saveConfig}
                disabled={pending}
                style={{ border: "none", cursor: pending ? "wait" : "pointer", background: pending ? "#A5A0EC" : "#4F46E5", color: "#fff", fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 10 }}
              >
                บันทึกการตั้งค่า
              </button>

              <div style={{ paddingTop: 12, borderTop: "1px dashed #E3E6EA" }}>
                {status.configured ? (
                  <>
                    <p style={{ fontSize: 12.5, color: "#5A6270", marginBottom: 10 }}>
                      พร้อมส่ง <b className="num">{num(status.readyCount)}</b> ใบ · ยอดรวม{" "}
                      <b className="num">{bahtN(status.readyAmountBaht)}</b>
                      {status.pendingReviewCount > 0 && (
                        <> · <span style={{ color: "#B45309" }}>{status.pendingReviewCount} ใบรอตรวจสอบ (ยังไม่ส่ง)</span></>
                      )}
                      {status.rejectedCount > 0 && (
                        <> · <span style={{ color: "#B42318" }}>{status.rejectedCount} ใบถูกปฏิเสธ (ไม่ส่ง)</span></>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={sendToReconcile}
                      disabled={pending || status.readyCount === 0}
                      style={{ width: "100%", border: "none", cursor: pending || status.readyCount === 0 ? "not-allowed" : "pointer", background: status.readyCount === 0 ? "#C7C4EE" : "#15803D", color: "#fff", fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 10 }}
                    >
                      ส่งเข้าบัญชี reconcile
                    </button>
                  </>
                ) : (
                  <p style={{ fontSize: 12.5, color: "#B42318" }}>ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคาร — ตั้งค่าด้านบนก่อนถึงจะส่งได้</p>
                )}
              </div>
            </>
          )}

          {error && (
            <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#B42318" }}>{error}</div>
          )}
        </div>
      </Modal>

      <BranchStaffModal
        branch={staffModalBranch ? { branchId: staffModalBranch.branchId, branchName: staffModalBranch.branchName, staff: staffModalBranch.staff } : null}
        onClose={() => setStaffModalBranchId(null)}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ดูพนักงาน + เพิ่มพนักงาน ของสาขานี้ — เปิดจากแถวในตารางผูกบัญชี (CEO 2026-08-23:
 * "กดเลือกพนักงาน/เพิ่มพนักงานหน้านี้ได้เลย") · reuse inviteCfStaff เดียวกับ
 * หน้า /clawfleet/os/staff — ไม่ทำ edit-role/remove ซ้ำที่นี่ (จัดการเต็มรูปแบบยังอยู่
 * หน้าพนักงานเดิม) แค่ดูรายชื่อ + เพิ่มคนใหม่เข้าสาขานี้โดยตรง.
 * ───────────────────────────────────────────────────────────────────────── */
type BranchAssignableRole = "staff" | "branch_manager" | "area_manager";
const BRANCH_ASSIGNABLE_ROLES: { value: BranchAssignableRole; label: string }[] = [
  { value: "staff", label: "พนักงานเก็บเงิน" },
  { value: "branch_manager", label: "ผจก.สาขา" },
  { value: "area_manager", label: "ผจก.เขต" },
];
const BRANCH_ROLE_TH: Record<string, string> = {
  org_admin: "ผู้ดูแลระบบ", super_admin: "ผู้ดูแลระบบ", admin: "ผู้ดูแลระบบ",
  program_admin: "ผู้ดูแลโปรแกรม", area_manager: "ผจก.เขต", branch_manager: "ผจก.สาขา",
  staff: "พนักงานเก็บเงิน", viewer: "ผู้ชม",
};
function branchRoleLabel(r: string): string {
  return BRANCH_ROLE_TH[r] ?? "พนักงานเก็บเงิน";
}
/** บทบาทระดับแอดมินองค์กร — ห้ามเอาออกจากหน้านี้ (จัดที่หน้าผู้ใช้ส่วนกลาง) — ตรงกับ staff-client.tsx */
const BRANCH_ADMIN_TIER_ROLES = new Set(["super_admin", "org_admin", "admin", "program_admin"]);

function BranchStaffModal({
  branch,
  onClose,
}: {
  branch: { branchId: string; branchName: string; staff: { id: string; name: string; role: string }[] } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<BranchAssignableRole>("staff");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ url: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [removeErr, setRemoveErr] = useState<{ id: string; msg: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function resetAdd() {
    setShowAdd(false); setName(""); setRole("staff"); setEmail(""); setPhone("");
    setError(null); setInviteResult(null); setCopied(false);
  }

  // เอาพนักงานออกจากสาขานี้ — action เดียวกับหน้า "พนักงาน" เป๊ะ (ข้อมูลเชื่อมกันทั้งโปรแกรม
  // ไม่ทำ logic ลบซ้ำที่นี่) · ถ้าไม่เหลือสาขาเลย ระบบปิดใช้งานบัญชีให้อัตโนมัติ (มีข้อความเตือนไว้แล้ว)
  function removeStaff(m: { id: string; name: string }) {
    if (!branch) return;
    if (!confirm(`เอา "${m.name}" ออกจากสาขานี้?\nถ้าไม่เหลือสาขา บัญชีจะถูกปิดใช้งาน`)) return;
    setRemoveErr(null);
    setRemovingId(m.id);
    startTransition(async () => {
      const res = await removeCfStaff(m.id, branch.branchId);
      setRemovingId(null);
      if (!res.ok) { setRemoveErr({ id: m.id, msg: res.error }); return; }
      router.refresh();
    });
  }

  function submit() {
    if (!branch) return;
    setError(null);
    if (!name.trim()) { setError("กรอกชื่อพนักงาน"); return; }
    startTransition(async () => {
      const em = email.trim();
      const res = await inviteCfStaff({
        name: name.trim(),
        branchId: branch.branchId,
        role,
        email: em && /.+@.+\..+/.test(em) ? em : undefined,
        phone: phone.trim() || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      setInviteResult({ url: res.data.inviteUrl, name: res.data.name });
      router.refresh();
    });
  }

  async function copyLink() {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      open={!!branch}
      onClose={() => { onClose(); resetAdd(); }}
      width={480}
      title={branch ? `พนักงาน · ${branch.branchName}` : "พนักงาน"}
      sub="ดูรายชื่อพนักงานของสาขานี้ หรือเพิ่มคนใหม่เข้าสาขานี้"
    >
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {branch && branch.staff.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {branch.staff.map((m) => {
              const canRemove = !BRANCH_ADMIN_TIER_ROLES.has(m.role);
              return (
                <div key={m.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F8F9FB", borderRadius: 9 }}>
                    <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#EDEBFB", color: "#4F46E5", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 30px" }}>
                      {(m.name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                    <span style={{ fontSize: 11.5, color: "#6B7280", whiteSpace: "nowrap" }}>{branchRoleLabel(m.role)}</span>
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => removeStaff(m)}
                        disabled={removingId === m.id}
                        title="เอาออกจากสาขานี้"
                        className="co-tap"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                          border: "1px solid #F3D9D5", background: "transparent", color: "#B42318",
                          fontSize: 11, fontWeight: 600, padding: "5px 8px", borderRadius: 7,
                          cursor: removingId === m.id ? "wait" : "pointer",
                        }}
                      >
                        <UserMinus size={11} /> เอาออก
                      </button>
                    ) : (
                      <span style={{ fontSize: 10.5, color: "#9AA1AB", whiteSpace: "nowrap" }}>ผู้ดูแลองค์กร</span>
                    )}
                  </div>
                  {removeErr?.id === m.id && (
                    <div style={{ marginTop: 4, padding: "6px 10px", fontSize: 11, color: "#B42318", background: "#FCEDEC", borderRadius: 7 }}>
                      {removeErr.msg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "#9AA1AB" }}>ยังไม่มีพนักงานในสาขานี้</div>
        )}

        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="co-tap"
            style={{ border: "1px dashed #C7C4EE", background: "#F7F8FF", color: "#4F46E5", fontSize: 12.5, fontWeight: 600, padding: "9px 0", borderRadius: 9, cursor: "pointer" }}
          >
            + เพิ่มพนักงาน
          </button>
        ) : inviteResult ? (
          <div style={{ background: "#F2FAF5", border: "1px solid #CDE9D7", borderRadius: 11, padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "#15803D", marginBottom: 8 }}>
              <Check size={15} /> สร้างลิงก์เชิญ &quot;{inviteResult.name}&quot; สำเร็จ
            </div>
            <div style={{ fontSize: 11.5, color: "#5A6270", marginBottom: 8 }}>
              ส่งลิงก์นี้ให้พนักงานเปิดเพื่อตั้งรหัสและเข้าระบบ (ลิงก์มีอายุ 48 ชั่วโมง)
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input readOnly value={inviteResult.url} onFocus={(e) => e.currentTarget.select()} style={{ ...R_FIELD, fontSize: 12, background: "#fff", flex: 1, minWidth: 0 }} />
              <button type="button" onClick={copyLink} style={{ border: "none", cursor: "pointer", color: "#fff", background: copied ? "#15803D" : "#4F46E5", padding: "0 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
              </button>
            </div>
            <button type="button" onClick={resetAdd} style={{ marginTop: 10, border: "1px solid #DFE2E8", background: "#fff", color: "#5A6270", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>
              เพิ่มอีกคน
            </button>
          </div>
        ) : (
          <div style={{ borderTop: "1px dashed #E3E6EA", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={R_LABEL}>ชื่อพนักงาน</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย ใจดี" style={R_FIELD} autoFocus />
            </div>
            <div>
              <label style={R_LABEL}>บทบาท</label>
              <select value={role} onChange={(e) => setRole(e.target.value as BranchAssignableRole)} style={R_FIELD}>
                {BRANCH_ASSIGNABLE_ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={R_LABEL}>อีเมล (ถ้ามี)</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ไม่บังคับ" style={R_FIELD} />
              </div>
              <div>
                <label style={R_LABEL}>เบอร์โทร (ถ้ามี)</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="ไม่บังคับ" style={R_FIELD} />
              </div>
            </div>
            {error && (
              <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 9, padding: "9px 12px", fontSize: 12, color: "#B42318" }}>{error}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={resetAdd} disabled={pending} style={{ flex: 1, border: "1px solid #E3E6EA", background: "#fff", cursor: pending ? "not-allowed" : "pointer", color: "#6B7280", fontSize: 13, fontWeight: 600, padding: "10px 0", borderRadius: 10 }}>
                ยกเลิก
              </button>
              <button type="button" onClick={submit} disabled={pending} style={{ flex: 1, border: "none", cursor: pending ? "wait" : "pointer", background: pending ? "#A5A0EC" : "#4F46E5", color: "#fff", fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 10 }}>
                {pending ? "กำลังสร้างลิงก์…" : "สร้างลิงก์เชิญ"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

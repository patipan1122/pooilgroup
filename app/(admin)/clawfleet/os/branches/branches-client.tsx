"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Wallet, Store, AlertTriangle, ArrowRight, Cpu, ChevronRight, Truck, Calendar } from "lucide-react";
import { Kpi, IconBox, Pill, Card, Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN, num, deltaColor, pnlTone, type PnlFlagKey, type Tone } from "@/components/clawfleet/os/format";
import { reassignCfMachineBranch } from "@/lib/clawfleet/actions";

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
  fromISO = "",
  toISO = "",
}: {
  branches: BranchRow[];
  // surface-existing (reassign) — โชว์การ์ด "ย้ายตู้ข้ามสาขา" เฉพาะแอดมิน (server assert อยู่แล้ว)
  isAdmin?: boolean;
  machineOptions?: MachineOption[];
  branchOptions?: BranchOption[];
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

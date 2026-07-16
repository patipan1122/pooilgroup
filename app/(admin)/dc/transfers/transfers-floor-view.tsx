"use client";

// DC · หน้าคลัง · ใบที่ฉันส่ง / รอรับเข้า (client) — สองแท็บ, presentational only.
//   • "ที่ฉันส่งออก" — ใบที่ส่งจากคลังนี้ (ทุกสถานะ)
//   • "รอรับเข้า"    — ใบ IN_TRANSIT ที่มีของเข้ามารอรับที่คลังนี้ (มี badge count + amber banner)
//   แต่ละแถว: รูปสินค้าแรก · เลขที่ · "จากไหน → ไปไหน" · สถานะ · วันที่ส่ง · #รายการ · ปุ่มปริ้น.
//   filter (วันที่ · ปลายทาง/ต้นทาง) อยู่บน URL → server กรองจริงใน DB (ค้นใบเก่ากว่า 100 ใบเจอ)
//   ไม่มีการเขียน/ขยับสต๊อกที่นี่ — กดใบแล้วไปรับที่หน้ารายละเอียด (/dc/transfers/[id]).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck, Inbox, ChevronDown, ChevronRight, ExternalLink, Printer, X } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { DcThumb } from "@/components/dc/product-image";
import { EmptyState } from "@/components/ui/empty-state";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import type { TransferListRow, TransferPartyOption } from "@/lib/dc/transfer-list-actions";
import { TransferExpandPanel } from "@/app/(admin)/dc/office/transfers/transfers-office-rows";

// tone ป้ายสถานะ — copy จาก office/transfers/page.tsx (~20-26)
const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  DISPATCHED: "info",
  IN_TRANSIT: "warning",
  CONFIRMED: "success",
  AUTO_UNVERIFIED: "danger",
  CANCELLED: "neutral",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

type Tab = "outgoing" | "incoming";

type Filters = { dateFrom: string; dateTo: string; dest: string; src: string };

// สไตล์ช่องกรอง (แถบ filter) — สูง 38px คุมงบพื้นที่
const ctrlStyle: React.CSSProperties = {
  height: 38,
  padding: "0 10px",
  borderRadius: 10,
  border: "1.5px solid var(--dc-line)",
  background: "var(--dc-paper)",
  color: "var(--dc-ink)",
  fontSize: 13.5,
  fontWeight: 600,
};

export function TransfersFloorView({
  outgoing,
  incoming,
  destOptions,
  srcOptions,
  incomingTotal,
  filters,
  initialTab,
}: {
  outgoing: TransferListRow[];
  incoming: TransferListRow[];
  destOptions: TransferPartyOption[];
  srcOptions: TransferPartyOption[];
  /** จำนวนรอรับเข้าจริงทั้งหมด (ไม่โดน filter) — badge/banner ใช้ตัวนี้ กัน filter บดบังงานค้าง */
  incomingTotal: number;
  filters: Filters;
  initialTab: Tab;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(null); // ใบที่กาง (ทีละใบ)
  // ค่าช่องกรอง (client state · sync ขึ้น URL ทุกครั้งที่เปลี่ยน)
  const [f, setF] = useState<Filters>(filters);
  const rows = tab === "incoming" ? incoming : outgoing;

  const buildQuery = (t: Tab, next: Filters): string => {
    const q = new URLSearchParams();
    q.set("tab", t === "incoming" ? "in" : "out");
    if (next.dateFrom) q.set("from", next.dateFrom);
    if (next.dateTo) q.set("to", next.dateTo);
    if (next.dest) q.set("dest", next.dest);
    if (next.src) q.set("src", next.src);
    return q.toString();
  };

  // เปลี่ยนแท็บ = client ล้วน (ข้อมูลสองแท็บโหลดมาแล้ว) — แค่จำลง URL เผื่อ refresh/แชร์
  const switchTab = (t: Tab) => {
    setTab(t);
    setOpenId(null);
    if (typeof window !== "undefined")
      window.history.replaceState(null, "", `/dc/transfers?${buildQuery(t, f)}`);
  };

  // เปลี่ยน filter = ให้ server กรองใหม่ (router.replace → query DB จริง)
  const applyFilters = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    setF(next);
    startTransition(() => {
      router.replace(`/dc/transfers?${buildQuery(tab, next)}`, { scroll: false });
    });
  };

  const partyValue = tab === "incoming" ? f.src : f.dest;
  const partyOptions = tab === "incoming" ? srcOptions : destOptions;
  const filterActive = Boolean(f.dateFrom || f.dateTo || partyValue);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* แถวเดียว: แท็บ (ซ้าย) + ช่องกรอง (ขวา) — wrap เองบนมือถือ */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div role="tablist" aria-label="ประเภทใบโอน" style={{ display: "flex", gap: 8 }}>
          <TabButton active={tab === "outgoing"} onClick={() => switchTab("outgoing")}>
            <Truck size={16} /> ที่ฉันส่งออก
          </TabButton>
          <TabButton active={tab === "incoming"} onClick={() => switchTab("incoming")}>
            <Inbox size={16} /> รอรับเข้า
            {incomingTotal > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  minWidth: 20,
                  height: 20,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "#f97316",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {incomingTotal}
              </span>
            )}
          </TabButton>
        </div>

        {/* ช่องกรอง: ช่วงวันที่ + ปลายทาง/ต้นทาง — server กรองจริง */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={f.dateFrom}
            max={f.dateTo || undefined}
            onChange={(e) => applyFilters({ dateFrom: e.target.value })}
            aria-label="ตั้งแต่วันที่"
            style={ctrlStyle}
          />
          <span style={{ color: "var(--dc-muted)", fontSize: 13 }}>–</span>
          <input
            type="date"
            value={f.dateTo}
            min={f.dateFrom || undefined}
            onChange={(e) => applyFilters({ dateTo: e.target.value })}
            aria-label="ถึงวันที่"
            style={ctrlStyle}
          />
          <select
            value={partyValue}
            onChange={(e) =>
              applyFilters(tab === "incoming" ? { src: e.target.value } : { dest: e.target.value })
            }
            aria-label={tab === "incoming" ? "กรองคลังต้นทาง" : "กรองปลายทาง"}
            style={{ ...ctrlStyle, maxWidth: 200 }}
          >
            <option value="">{tab === "incoming" ? "ต้นทาง: ทั้งหมด" : "ปลายทาง: ทั้งหมด"}</option>
            {partyOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {filterActive && (
            <button
              type="button"
              onClick={() => applyFilters({ dateFrom: "", dateTo: "", dest: "", src: "" })}
              title="ล้างตัวกรอง"
              style={{ ...ctrlStyle, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            >
              <X size={14} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {/* amber banner เฉพาะแท็บรอรับเข้าเมื่อมีของรอ — style เดียวกับ office/transfers/page.tsx (~94-109)
          ใช้ incomingTotal (ไม่กรอง) — filter วันที่ต้องไม่ทำให้งานค้างหายจากตา */}
      {tab === "incoming" && incomingTotal > 0 && (
        <div
          style={{
            background: "#fff7ed",
            color: "#9a3412",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          มี {incomingTotal} ใบรอรับเข้า — กดเปิดใบเพื่อยืนยันรับของเข้าคลัง
          {filterActive && incoming.length < incomingTotal && (
            <span style={{ fontWeight: 500 }}> (ตัวกรองซ่อนไว้ {incomingTotal - incoming.length} ใบ — กด “ล้าง” เพื่อดูครบ)</span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={tab === "incoming" ? <Inbox size={26} /> : <Truck size={26} />}
          title={
            filterActive
              ? "ไม่พบใบตามตัวกรอง"
              : tab === "incoming"
                ? "ยังไม่มีของรอรับเข้าคลังนี้"
                : "ยังไม่มีใบที่ส่งออกจากคลังนี้"
          }
          description={
            filterActive
              ? "ลองขยายช่วงวันที่ หรือกด “ล้าง” เพื่อดูทั้งหมด"
              : tab === "incoming"
                ? "เมื่อคลังอื่นส่งของมาที่คลังนี้ (ยังไม่ยืนยันรับ) จะมาโผล่ที่นี่ให้กดรับ"
                : "ส่งของจากหน้าคลัง (ส่ง / โอน) — เลือกปลายทาง แล้วส่งออก จะมาโผล่ที่นี่"
          }
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            opacity: isPending ? 0.55 : 1,
            transition: "opacity .15s",
          }}
        >
          {rows.map((r) => {
            const open = openId === r.id;
            return (
              <div
                key={r.id}
                className="dc-card"
                style={{
                  border: `1.5px solid ${open ? "var(--dc-ink)" : "var(--dc-line)"}`,
                  padding: 0,
                  overflow: "hidden",
                }}
              >
                {/* หัวแถว — กดที่ไหนก็กาง/ยุบ (ยกเว้นรูป+ปุ่มปริ้น+ลิงก์เปิดเต็มหน้า) */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(open ? null : r.id);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <span style={{ color: "var(--dc-muted)", flexShrink: 0, display: "inline-flex" }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                  <DcThumb url={r.firstImageUrl} alt={r.transferCode} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 15,
                          color: "var(--dc-ink)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {r.transferCode}
                      </span>
                      <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"} size="sm" dot>
                        {TRANSFER_STATUS_LABEL[r.status] ?? r.status}
                      </StatusPill>
                      {r.dispatchedByMe && (
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>ฉันส่งเอง</span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 13,
                        color: "var(--dc-muted)",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "2px 12px",
                      }}
                    >
                      {/* จากไหน → ไปไหน — โชว์ครบทั้งสองฝั่งทุกแถว (ปลายทางเน้นเข้ม) */}
                      <span>
                        {r.fromLabel}
                        <span aria-hidden style={{ margin: "0 5px" }}>→</span>
                        <span style={{ color: "var(--dc-ink)", fontWeight: 700 }}>{r.destLabel}</span>
                      </span>
                      <span>{fmtDate(r.dispatchedAt)}</span>
                      <span>{r.lineCount} รายการ</span>
                      {!r.dispatchedByMe && r.dispatchedByName && <span>ส่งโดย {r.dispatchedByName}</span>}
                    </div>
                  </div>
                  {/* ปริ้นใบโอน — เปิดหน้า print แท็บใหม่ (เด้ง print เอง) · หยุด bubble */}
                  <a
                    href={`/dc/office/transfers/${r.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="ปริ้นใบโอน"
                    aria-label={`ปริ้นใบโอน ${r.transferCode}`}
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 30,
                      borderRadius: 9,
                      border: "1px solid var(--dc-line)",
                      background: "var(--dc-paper)",
                      color: "var(--dc-ink)",
                    }}
                  >
                    <Printer size={15} />
                  </a>
                  {/* เปิดเต็มหน้า (รับ/ยืนยัน) — หยุด bubble ไม่ให้ toggle */}
                  <Link
                    href={`/dc/transfers/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="เปิดเต็มหน้า"
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 10px",
                      borderRadius: 9,
                      border: "1px solid var(--dc-line)",
                      background: "var(--dc-paper)",
                      color: "var(--dc-ink)",
                      fontSize: 12.5,
                      fontWeight: 700,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <ExternalLink size={14} /> เปิดเต็มหน้า
                  </Link>
                </div>

                {/* แผงบรรทัดสินค้า + ปุ่มพิมพ์ (โหลด lazy · reuse ตัวเดียวกับหลังบ้าน) */}
                {open && <TransferExpandPanel transferId={r.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 14px",
        borderRadius: 10,
        border: `1.5px solid ${active ? "var(--dc-ink)" : "var(--dc-line)"}`,
        background: active ? "var(--dc-ink)" : "var(--dc-paper)",
        color: active ? "#fff" : "var(--dc-ink)",
        fontWeight: 700,
        fontSize: 14,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

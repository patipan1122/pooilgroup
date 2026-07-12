"use client";

// DC · หน้าคลัง · ใบที่ฉันส่ง / รอรับเข้า (client) — สองแท็บ, presentational only.
//   • "ที่ฉันส่งออก" — ใบที่ส่งจากคลังนี้ (ทุกสถานะ)
//   • "รอรับเข้า"    — ใบ IN_TRANSIT ที่มีของเข้ามารอรับที่คลังนี้ (มี badge count + amber banner)
//   แต่ละแถว: รูปสินค้าแรก · เลขที่ · ปลายทาง/ต้นทาง · สถานะ · วันที่ส่ง · #รายการ → กดเข้าใบ.
//   ไม่มีการเขียน/ขยับสต๊อกที่นี่ — กดใบแล้วไปรับที่หน้ารายละเอียด (/dc/transfers/[id]).

import { useState } from "react";
import Link from "next/link";
import { Truck, Inbox, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { DcThumb } from "@/components/dc/product-image";
import { EmptyState } from "@/components/ui/empty-state";
import { TRANSFER_STATUS_LABEL } from "@/lib/dc/nav";
import type { TransferListRow } from "@/lib/dc/transfer-list-actions";
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

export function TransfersFloorView({
  outgoing,
  incoming,
}: {
  outgoing: TransferListRow[];
  incoming: TransferListRow[];
}) {
  const [tab, setTab] = useState<Tab>(incoming.length > 0 ? "incoming" : "outgoing");
  const [openId, setOpenId] = useState<string | null>(null); // ใบที่กาง (ทีละใบ)
  const rows = tab === "incoming" ? incoming : outgoing;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* แท็บ */}
      <div role="tablist" aria-label="ประเภทใบโอน" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton active={tab === "outgoing"} onClick={() => setTab("outgoing")}>
          <Truck size={16} /> ที่ฉันส่งออก
        </TabButton>
        <TabButton active={tab === "incoming"} onClick={() => setTab("incoming")}>
          <Inbox size={16} /> รอรับเข้า
          {incoming.length > 0 && (
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
              {incoming.length}
            </span>
          )}
        </TabButton>
      </div>

      {/* amber banner เฉพาะแท็บรอรับเข้าเมื่อมีของรอ — style เดียวกับ office/transfers/page.tsx (~94-109) */}
      {tab === "incoming" && incoming.length > 0 && (
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
          มี {incoming.length} ใบรอรับเข้า — กดเปิดใบเพื่อยืนยันรับของเข้าคลัง
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={tab === "incoming" ? <Inbox size={26} /> : <Truck size={26} />}
          title={tab === "incoming" ? "ยังไม่มีของรอรับเข้าคลังนี้" : "ยังไม่มีใบที่ส่งออกจากคลังนี้"}
          description={
            tab === "incoming"
              ? "เมื่อคลังอื่นส่งของมาที่คลังนี้ (ยังไม่ยืนยันรับ) จะมาโผล่ที่นี่ให้กดรับ"
              : "ส่งของจากหน้าคลัง (ส่ง / โอน) — เลือกปลายทาง แล้วส่งออก จะมาโผล่ที่นี่"
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                {/* หัวแถว — กดที่ไหนก็กาง/ยุบ (ยกเว้นรูป+ลิงก์เปิดเต็มหน้า) */}
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
                      {tab === "outgoing" && r.dispatchedByMe && (
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
                      <span>{tab === "incoming" ? `จาก: ${r.fromLabel}` : `ไป: ${r.destLabel}`}</span>
                      <span>{fmtDate(r.dispatchedAt)}</span>
                      <span>{r.lineCount} รายการ</span>
                    </div>
                  </div>
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

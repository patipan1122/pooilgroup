"use client";

/**
 * ตู้คีบ OS — surface-existing (Wave 2E2) · ไส้ในตู้ + ประวัติรายสินค้า + ลิงก์จัดการสาขา
 *  - MachinesLoadoutTab: ลิสต์ตู้ในสโคป → กดตู้ → เห็นโหลดเอาต์ปัจจุบัน (สินค้า+รูป+ราคา/ครั้ง)
 *  - ProductMovementsModal: กดสินค้าในโหลดเอาต์ → โหลดประวัติการเคลื่อนไหวรายสินค้า (lazy · ใหม่→เก่า)
 *  - BranchMgmtLink: ปุ่มไปหน้า "จัดการสาขา" (เปลี่ยนชื่อ/ลบสาขา) ที่ CEO หาไม่เจอ
 * ทุกอย่าง read-only (display) — ข้อมูลจริงจาก getMachineLoadout / loadCfProductMovements.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Boxes, Cpu, ImageOff, Settings2, ChevronRight, ArrowRight, History } from "lucide-react";
import { Card, Modal, Pill, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { num, thDate } from "@/components/clawfleet/os/format";
import { loadCfProductMovements, type CfProductMovementDisplayRow } from "@/lib/clawfleet/stock-actions";

/* ── seed types (จาก server · stock/page.tsx) ── */
export type MachineSeed = {
  id: string;
  code: string;
  nickname: string | null;
  branchName: string;
  kind: string; // CLAW | EXCHANGER
  isActive: boolean;
};
export type LoadoutItemSeed = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  pricePerPlayCoins: number;
  setAtISO: string;
};

/* ── ป้ายชนิดการเคลื่อนไหว (ไทย) + สี ── */
const MOVE_TH: Record<string, { label: string; tone: "green" | "red" | "brand" | "amber" | "neutral" }> = {
  RECEIVE: { label: "รับเข้าคลัง", tone: "green" },
  RECEIPT_IN: { label: "รับเข้า (ใบรับ)", tone: "green" },
  LOAD_TO_MACHINE: { label: "เติมเข้าตู้", tone: "brand" },
  COUNT_SNAPSHOT: { label: "บันทึกยอดนับ", tone: "neutral" },
  COUNT_ADJUST: { label: "ปรับยอดนับ", tone: "amber" },
  ADJUST: { label: "ปรับยอด", tone: "amber" },
  TRANSFER_OUT: { label: "โอนออก", tone: "red" },
  TRANSFER_IN: { label: "โอนเข้า", tone: "green" },
  WITHDRAW: { label: "เบิกออก", tone: "red" },
  LOSS_ADJUST: { label: "ตัดของเสีย", tone: "red" },
};
function moveMeta(type: string) {
  return MOVE_TH[type] ?? { label: type, tone: "neutral" as const };
}
function fmtISO(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : thDate(d);
}

/* ─────────────────────────────────────────────────────────────────────────
 * ปุ่ม/ลิงก์ไป "จัดการสาขา" (surface-existing #1) — เปลี่ยนชื่อ/ลบสาขาอยู่หน้านั้น
 * ───────────────────────────────────────────────────────────────────────── */
export function BranchMgmtLink() {
  return (
    <Link
      href="/clawfleet/os/branches"
      className="co-tap"
      style={{
        textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7,
        border: "1px solid #E3E6EA", background: "#fff", color: "#454B54",
        fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 10, whiteSpace: "nowrap",
      }}
    >
      <Settings2 size={15} style={{ color: "#4F46E5" }} />
      จัดการสาขา (เปลี่ยนชื่อ · ลบ)
      <ArrowRight size={14} style={{ color: "#9AA1AB" }} />
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * แท็บ "ไส้ในตู้" — ลิสต์ตู้ → กดดูโหลดเอาต์ (surface-existing #2 + #3)
 * ───────────────────────────────────────────────────────────────────────── */
export function MachinesLoadoutTab({
  machines,
  loadoutByMachine,
}: {
  machines: MachineSeed[];
  // โหลดเอาต์ปัจจุบันของแต่ละตู้ (key = machineId) — โหลดมาแล้วจาก server (เล็ก)
  loadoutByMachine: Record<string, LoadoutItemSeed[]>;
}) {
  const [openMachine, setOpenMachine] = useState<MachineSeed | null>(null);
  const [movProduct, setMovProduct] = useState<{ id: string; name: string } | null>(null);

  if (machines.length === 0) {
    return (
      <Card title="ไส้ในตู้ (โหลดเอาต์)" sub="ดูว่าตู้แต่ละเครื่องมีสินค้าอะไร · ราคา/ครั้งเท่าไหร่">
        <EmptyState
          icon={<Cpu size={30} />}
          title="ยังไม่มีตู้ในระบบ"
          sub="เมื่อแอดมินลงทะเบียนตู้จริง จะเห็นรายชื่อตู้และไส้ในตู้ที่นี่"
        />
      </Card>
    );
  }

  const openLoadout = openMachine ? loadoutByMachine[openMachine.id] ?? [] : [];

  return (
    <div>
      <Card
        title="ไส้ในตู้ (โหลดเอาต์ปัจจุบัน)"
        sub="กดตู้เพื่อดูสินค้าที่อยู่ในตู้ตอนนี้ · ราคา/ครั้ง · และประวัติการเคลื่อนไหวรายสินค้า"
        pad={false}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 520 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 0.8fr 0.9fr 0.3fr", padding: "10px 20px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
              <span>รหัสตู้</span><span>สาขา</span><span>ชนิด</span><span style={{ textAlign: "right" }}>สินค้าในตู้</span><span />
            </div>
            {machines.map((m) => {
              const loadout = loadoutByMachine[m.id] ?? [];
              return (
                <div
                  key={m.id}
                  className="co-rowlink"
                  onClick={() => setOpenMachine(m)}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 0.8fr 0.9fr 0.3fr", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, cursor: "pointer" }}
                >
                  <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <IconBox bg="#F1F2F7" color="#4F46E5" size={30} radius={8}><span className="num" style={{ fontSize: 10.5, fontWeight: 700 }}>{m.code}</span></IconBox>
                    {m.nickname && <span style={{ fontWeight: 500, color: "#6B7280", fontSize: 12 }}>{m.nickname}</span>}
                  </span>
                  <span style={{ color: "#454B54" }}>{m.branchName}</span>
                  <span style={{ color: "#6B7280", fontSize: 12 }}>{m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}{!m.isActive && <span style={{ color: "#B45309", marginLeft: 6, fontSize: 11 }}>· ปิดใช้งาน</span>}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600, color: loadout.length > 0 ? "#1A1D21" : "#C2C7CF" }}>{loadout.length > 0 ? `${num(loadout.length)} รายการ` : "—"}</span>
                  <span style={{ textAlign: "right", color: "#C2C7CF", display: "flex", justifyContent: "flex-end" }}><ChevronRight size={16} /></span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* modal โหลดเอาต์ตู้ */}
      <Modal
        open={openMachine != null}
        onClose={() => setOpenMachine(null)}
        width={560}
        title={openMachine ? `ไส้ในตู้ ${openMachine.code}` : ""}
        sub={openMachine ? `${openMachine.branchName} · ${openMachine.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}` : undefined}
      >
        {openMachine && (
          <div style={{ padding: "16px 20px" }}>
            {openLoadout.length === 0 ? (
              <EmptyState
                icon={<Boxes size={28} />}
                title="ยังไม่ได้ตั้งสินค้าในตู้นี้"
                sub="เมื่อเติมสินค้าเข้าตู้ (โหลดเอาต์) จะเห็นสินค้า · ราคา/ครั้ง ที่นี่"
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11.5, color: "#9AA1AB", marginBottom: 2 }}>สินค้าที่อยู่ในตู้ตอนนี้ ({openLoadout.length} รายการ) · กดสินค้าเพื่อดูประวัติการเคลื่อนไหว</div>
                {openLoadout.map((it) => (
                  <button
                    key={it.productId}
                    type="button"
                    onClick={() => setMovProduct({ id: it.productId, name: it.productName })}
                    style={{ display: "flex", alignItems: "center", gap: 13, background: "#F8F9FB", border: "1px solid #EEF0F3", borderRadius: 12, padding: "11px 13px", cursor: "pointer", textAlign: "left", width: "100%" }}
                  >
                    <ProductThumb url={it.imageUrl} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.productName}</div>
                      <div style={{ fontSize: 11, color: "#9AA1AB" }}>ตั้งไว้เมื่อ {fmtISO(it.setAtISO)}</div>
                    </div>
                    <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                      <div className="num" style={{ fontSize: 14, fontWeight: 700, color: "#4F46E5" }}>{num(it.pricePerPlayCoins)} เหรียญ</div>
                      <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>ต่อการเล่น 1 ครั้ง</div>
                    </div>
                    <History size={16} style={{ color: "#C2C7CF", flex: "0 0 auto" }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* modal ประวัติรายสินค้า (lazy) */}
      <ProductMovementsModal product={movProduct} onClose={() => setMovProduct(null)} />
    </div>
  );
}

/* รูปสินค้า — null → placeholder (ยังเรนเดอร์เสมอ) */
function ProductThumb({ url }: { url: string | null }) {
  const box: React.CSSProperties = { width: 44, height: 44, borderRadius: 10, flex: "0 0 44px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" };
  if (!url) {
    return <div style={{ ...box, background: "#EEF0F3", color: "#C2C7CF" }}><ImageOff size={18} /></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" style={{ ...box, objectFit: "cover", background: "#EEF0F3" }} />;
}

/* ─────────────────────────────────────────────────────────────────────────
 * ประวัติการเคลื่อนไหวรายสินค้า (surface-existing #3) — lazy load เมื่อเปิด modal
 * ───────────────────────────────────────────────────────────────────────── */
function ProductMovementsModal({
  product,
  onClose,
}: {
  product: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CfProductMovementDisplayRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // เปิด modal ครั้งใหม่ (productId เปลี่ยน) → โหลดใหม่ครั้งเดียว
  if (product && product.id !== loadedFor && !pending) {
    setLoadedFor(product.id);
    setRows(null);
    setError(null);
    startTransition(async () => {
      const res = await loadCfProductMovements(product.id);
      if (res.ok) setRows(res.data);
      else setError(res.error);
    });
  }

  return (
    <Modal
      open={product != null}
      onClose={onClose}
      width={600}
      title={product ? `ประวัติสินค้า · ${product.name}` : ""}
      sub="การเคลื่อนไหวทั้งหมดของสินค้านี้ (ในสาขาที่คุณเห็น) · ใหม่สุดก่อน"
    >
      {product && (
        <div style={{ padding: "16px 20px" }}>
          {pending && <div style={{ textAlign: "center", padding: "36px 0", color: "#9AA1AB", fontSize: 13 }}>กำลังโหลดประวัติ…</div>}
          {!pending && error && (
            <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 10, padding: "12px 14px", fontSize: 12.5, color: "#B42318" }}>{error}</div>
          )}
          {!pending && !error && rows && rows.length === 0 && (
            <EmptyState icon={<History size={28} />} title="ยังไม่มีประวัติ" sub="สินค้านี้ยังไม่มีการเคลื่อนไหวในสาขาที่คุณดูแล" />
          )}
          {!pending && !error && rows && rows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 460, overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 0.7fr 0.8fr", padding: "8px 4px", fontSize: 10.5, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F0F1F4", position: "sticky", top: 0, background: "#fff" }}>
                <span>รายการ</span><span>สาขา · ตู้</span><span style={{ textAlign: "right" }}>จำนวน</span><span style={{ textAlign: "right" }}>วันที่</span>
              </div>
              {rows.map((m) => {
                const meta = moveMeta(m.type);
                const positive = m.qty >= 0;
                return (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 0.7fr 0.8fr", padding: "11px 4px", alignItems: "center", borderBottom: "1px solid #F6F7F9", fontSize: 12.5 }}>
                    <span><Pill tone={meta.tone}>{meta.label}</Pill></span>
                    <span style={{ color: "#6B7280", fontSize: 11.5 }}>
                      {m.branchName}{m.machineCode ? <span style={{ color: "#9AA1AB" }}> · {m.machineCode}</span> : ""}
                    </span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 700, color: positive ? "#15803D" : "#B42318" }}>
                      {positive ? "+" : ""}{num(m.qty)}
                    </span>
                    <span className="num" style={{ textAlign: "right", fontSize: 11.5, color: "#6B7280" }}>{fmtISO(m.occurredAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

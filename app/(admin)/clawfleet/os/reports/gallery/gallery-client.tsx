"use client";

/**
 * ตู้คีบ OS — แกลเลอรีตู้ · client
 * เลือกสาขา (dropdown บนสุด · เปลี่ยน → เปลี่ยน ?branch= ผ่าน router) →
 *   grid การ์ดตู้ (รูป + รหัส/ชื่อเล่น + ราคาเล่น + ปุ่ม "ดูสินค้าในตู้" กางตาราง SKU).
 *   คลิกรูป → lightbox (reuse pattern จาก manage-client · plain <img> + R2 url).
 * ข้อมูลจริงมาจาก page.tsx (อ่านอย่างเดียว). ว่าง → EmptyState.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ImageOff,
  PackageSearch,
  Store,
  Tag,
  Boxes,
  X,
} from "lucide-react";
import { Card, EmptyState } from "@/components/clawfleet/os/kit";
import { baht, bahtN, num } from "@/components/clawfleet/os/format";
import type {
  GalleryBranchOption,
  GalleryBranch,
  GalleryMachine,
  GallerySku,
} from "@/lib/clawfleet/gallery-queries";

/* ── ราคาเล่น: "฿20 · 2 เหรียญ/ครั้ง" ── */
function playPriceLabel(m: GalleryMachine): string {
  if (m.playPriceBaht == null || m.playPriceCoins == null) return "ยังไม่ตั้งราคา";
  return `${bahtN(m.playPriceBaht)}/ครั้ง`;
}

/* ═══════════════════════ SKU table (กางในการ์ด) ═══════════════════════ */
function SkuRow({ s, last }: { s: GallerySku; last: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.7fr 0.7fr 0.8fr 0.9fr",
        alignItems: "center",
        gap: 8,
        padding: "9px 0",
        borderBottom: last ? "none" : "1px solid #F4F5F7",
        fontSize: 12.5,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <SkuThumb url={s.imageUrl} name={s.name} />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontWeight: 600,
              color: "#1A1D21",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.name}
          </span>
          <span className="num" style={{ fontSize: 11, color: "#9AA1AB" }}>
            {s.sku}
          </span>
        </span>
      </span>
      <span className="num" style={{ textAlign: "right", fontWeight: 600, color: "#454B54" }}>
        {num(s.qtyInMachine)} ตัว
      </span>
      <span className="num" style={{ textAlign: "right", color: "#6B7280" }}>
        {s.unitCostCents > 0 ? baht(s.unitCostCents) : "—"}
      </span>
      <span className="num" style={{ textAlign: "right", fontWeight: 700, color: "#1A1D21" }}>
        {s.unitCostCents > 0 ? baht(s.lineCostCents) : "—"}
      </span>
    </div>
  );
}

/* thumbnail สินค้าเล็ก ๆ ในตาราง SKU */
function SkuThumb({ url, name }: { url: string | null; name: string }) {
  return (
    <span
      style={{
        width: 34,
        height: 34,
        flex: "0 0 34px",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #E8EAED",
        background: url ? "#EAECF1" : "#F1F2F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9AA1AB",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <ImageOff size={14} />
      )}
    </span>
  );
}

/* ═══════════════════════ machine card ═══════════════════════ */
function MachineCard({
  m,
  onOpenPhoto,
}: {
  m: GalleryMachine;
  onOpenPhoto: (m: GalleryMachine) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasPhoto = !!m.photoUrl;
  const hasLoadout = m.skus.length > 0;

  return (
    <div
      className="co-card"
      style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      {/* ── รูปตู้ (คลิกเปิด lightbox) ── */}
      <button
        type="button"
        onClick={() => hasPhoto && onOpenPhoto(m)}
        className={hasPhoto ? "co-tap" : undefined}
        title={hasPhoto ? "ดูรูปใหญ่" : "ยังไม่มีรูปตู้"}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          border: "none",
          padding: 0,
          background: hasPhoto ? "#EAECF1" : "#F5F6F8",
          cursor: hasPhoto ? "zoom-in" : "default",
          display: "block",
          overflow: "hidden",
        }}
      >
        {hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.photoUrl!}
            alt={`รูปตู้ ${m.code}`}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              height: "100%",
              color: "#B6BBC4",
            }}
          >
            <ImageOff size={30} />
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>ยังไม่มีรูปตู้</span>
          </span>
        )}
        {/* ป้ายชนิดตู้ มุมบนซ้าย */}
        <span
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.3,
            color: m.kind === "EXCHANGER" ? "#7A5510" : "#4F46E5",
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(0,0,0,0.05)",
            borderRadius: 20,
            padding: "3px 9px",
          }}
        >
          {m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}
        </span>
      </button>

      {/* ── หัวการ์ด: รหัส/ชื่อเล่น + ราคาเล่น ── */}
      <div style={{ padding: "13px 15px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="num"
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#1A1D21",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {m.code}
          </div>
          {m.nickname && (
            <div
              style={{
                fontSize: 12,
                color: "#9AA1AB",
                marginTop: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {m.nickname}
            </div>
          )}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flex: "0 0 auto",
            fontSize: 12.5,
            fontWeight: 700,
            color: m.playPriceBaht == null ? "#9AA1AB" : "#15803D",
            background: m.playPriceBaht == null ? "#F1F2F7" : "#E7F4EC",
            border: `1px solid ${m.playPriceBaht == null ? "#E3E6EA" : "#CDE9D7"}`,
            borderRadius: 8,
            padding: "5px 9px",
            whiteSpace: "nowrap",
          }}
          title="ราคาเล่นที่ตั้งในตู้"
        >
          <Tag size={12} /> {playPriceLabel(m)}
        </span>
      </div>

      {/* ── ปุ่มกาง "ดูสินค้าในตู้" ── */}
      <button
        type="button"
        onClick={() => hasLoadout && setOpen((v) => !v)}
        disabled={!hasLoadout}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "10px 15px",
          background: open ? "#F8F9FB" : "#fff",
          border: "none",
          borderTop: "1px solid #F0F1F4",
          cursor: hasLoadout ? "pointer" : "default",
          fontSize: 12.5,
          fontWeight: 600,
          color: hasLoadout ? "#4F46E5" : "#B6BBC4",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Boxes size={14} />
          {hasLoadout ? `ดูสินค้าในตู้ · ${num(m.skuCount)} SKU` : "ยังไม่ได้ตั้งค่าสินค้า"}
        </span>
        {hasLoadout &&
          (open ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
      </button>

      {/* ── ตาราง SKU (กาง) ── */}
      {open && hasLoadout && (
        <div style={{ padding: "4px 15px 12px", background: "#F8F9FB" }}>
          <div
            className="co-eyebrow"
            style={{
              display: "grid",
              gridTemplateColumns: "1.7fr 0.7fr 0.8fr 0.9fr",
              gap: 8,
              padding: "7px 0 6px",
              borderBottom: "1px solid #EEF0F3",
            }}
          >
            <span>สินค้า</span>
            <span style={{ textAlign: "right" }}>เหลือ</span>
            <span style={{ textAlign: "right" }}>ทุน/ตัว</span>
            <span style={{ textAlign: "right" }}>รวม</span>
          </div>
          {m.skus.map((s, i) => (
            <SkuRow key={s.productId} s={s} last={i === m.skus.length - 1} />
          ))}
          {/* footer: รวมทุนในตู้ */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 8,
              padding: "10px 12px",
              background: "#EEF0FE",
              borderRadius: 10,
              fontSize: 12.5,
            }}
          >
            <span style={{ color: "#4F46E5", fontWeight: 600 }}>
              รวมทุนในตู้
            </span>
            <span className="num" style={{ color: "#1A1D21", fontWeight: 700 }}>
              {baht(m.totalCostCents)}
              <span style={{ color: "#9AA1AB", fontWeight: 500 }}>
                {" · "}
                {num(m.skuCount)} SKU · {num(m.totalUnits)} ตัว
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ lightbox (รูปตู้ใหญ่) ═══════════════════════ */
function PhotoLightbox({ m, onClose }: { m: GalleryMachine; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(20,22,28,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        cursor: "zoom-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          cursor: "default",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid #EEF0F3",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>
              {m.code}
              {m.nickname ? (
                <span style={{ fontWeight: 500, color: "#9AA1AB" }}> · {m.nickname}</span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: "#9AA1AB" }}>
              {m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"} · รูปสต็อกหลังเติมล่าสุด
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "#F1F2F5",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#454B54",
            }}
          >
            <X size={16} />
          </button>
        </div>
        {m.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.photoUrl}
            alt={`รูปตู้ ${m.code}`}
            style={{
              width: "100%",
              height: "auto",
              maxHeight: "78vh",
              objectFit: "contain",
              background: "#F8F9FB",
              display: "block",
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════ branch selector ═══════════════════════ */
function BranchSelect({
  options,
  currentId,
  onChange,
}: {
  options: GalleryBranchOption[];
  currentId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ position: "relative", minWidth: 220 }}>
      <Store
        size={15}
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: "#9AA1AB",
          pointerEvents: "none",
        }}
      />
      <select
        value={currentId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          fontSize: 13,
          fontWeight: 600,
          color: "#1A1D21",
          background: "#fff",
          border: "1px solid #E3E6EA",
          borderRadius: 10,
          padding: "10px 34px 10px 34px",
          cursor: "pointer",
        }}
      >
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {b.code} ({b.machineCount} ตู้)
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: "#9AA1AB",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* ═══════════════════════ main ═══════════════════════ */
export function GalleryClient({
  branchOptions,
  branch,
}: {
  branchOptions: GalleryBranchOption[];
  branch: GalleryBranch | null;
}) {
  const router = useRouter();
  const [lightbox, setLightbox] = useState<GalleryMachine | null>(null);
  const [switching, setSwitching] = useState(false);

  // เปลี่ยนสาขา → เปลี่ยน ?branch= (server โหลดใหม่)
  const changeBranch = useCallback(
    (id: string) => {
      if (branch && id === branch.id) return;
      setSwitching(true);
      router.push(`/clawfleet/os/reports/gallery?branch=${encodeURIComponent(id)}`);
    },
    [branch, router],
  );

  const openPhoto = useCallback((m: GalleryMachine) => setLightbox(m), []);

  // ไม่มีสาขาตู้คีบเลย
  if (branchOptions.length === 0) {
    return (
      <div>
        <BackBar />
        <Card>
          <EmptyState
            icon={<Store size={30} />}
            title="ยังไม่มีสาขาตู้คีบ"
            sub="เมื่อเพิ่มสาขาตู้คีบและตู้แล้ว จะเห็นตู้ทุกตู้เป็นการ์ดพร้อมรูปที่นี่"
          />
        </Card>
      </div>
    );
  }

  const machines = branch?.machines ?? [];

  return (
    <div style={{ opacity: switching ? 0.6 : 1, transition: "opacity .15s" }}>
      <BackBar />

      {/* ── แถบเลือกสาขา ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <BranchSelect
          options={branchOptions}
          currentId={branch?.id ?? null}
          onChange={changeBranch}
        />
        {branch && (
          <span style={{ fontSize: 12.5, color: "#9AA1AB" }}>
            {machines.length > 0 ? (
              <>
                <b className="num" style={{ color: "#454B54" }}>
                  {num(machines.length)}
                </b>{" "}
                ตู้ในสาขานี้ · กดที่ตู้เพื่อดูสินค้าและทุน
              </>
            ) : (
              "สาขานี้ยังไม่มีตู้"
            )}
          </span>
        )}
      </div>

      {/* ── grid การ์ดตู้ ── */}
      {machines.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PackageSearch size={28} />}
            title="สาขานี้ยังไม่มีตู้"
            sub="เพิ่มตู้ในเมนู “จัดการ” แล้วกลับมาดูที่นี่"
          />
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))",
            gap: 16,
          }}
        >
          {machines.map((m) => (
            <MachineCard key={m.id} m={m} onOpenPhoto={openPhoto} />
          ))}
        </div>
      )}

      {lightbox && <PhotoLightbox m={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ปุ่มกลับ + ป้ายหน้า (header หลักคือ "รายงาน" จาก chrome) */
function BackBar() {
  return (
    <div style={{ marginBottom: 14 }}>
      <Link
        href="/clawfleet/os/reports"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#6B7280",
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={15} /> กลับไปหน้ารายงาน
      </Link>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            width: 32,
            height: 32,
            flex: "0 0 32px",
            borderRadius: 9,
            background: "#EEF0FE",
            color: "#4F46E5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Store size={17} />
        </span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1A1D21" }}>แกลเลอรีตู้</div>
          <div style={{ fontSize: 12, color: "#9AA1AB" }}>
            เลือกสาขา → ดูตู้ทุกตู้พร้อมรูป · สินค้าในตู้ · ราคาเล่น · ทุนรวม
          </div>
        </div>
      </div>
    </div>
  );
}

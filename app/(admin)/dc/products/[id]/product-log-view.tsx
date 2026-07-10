"use client";

// DC · log รายสินค้า — client (READ-ONLY timeline)
//   หัว: รูป + ชื่อ + SKU + คงเหลือรวม
//   ไทม์ไลน์: แต่ละรายการ = [ชนิด (label ไทย)] [qty ± สี] [เหลือ] [วันที่/เวลา] [+คลัง/หมายเหตุ]
//   qty > 0 เขียว (เข้า) · qty < 0 แดง (ออก) · qty = 0 เทา (ย้ายที่).

import type {
  ProductStockLogEntry,
} from "@/lib/dc/count-actions";
import { ImageIcon, PackageSearch } from "lucide-react";

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ProductLogView({
  product,
  onHand,
  entries,
}: {
  product: { id: string; name: string; sku: string; unit: string | null; imageUrl: string | null };
  onHand: number;
  entries: ProductStockLogEntry[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ---- หัวสินค้า ---- */}
      <div className="dc-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Thumb url={product.imageUrl} size={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "var(--dc-ink)", lineHeight: 1.3 }}>{product.name}</div>
          <div style={{ fontSize: 13, color: "var(--dc-muted)", marginTop: 2 }}>{product.sku}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11.5, color: "var(--dc-muted)", fontWeight: 700 }}>คงเหลือรวม</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--dc-ink)", lineHeight: 1.1 }}>
            {onHand}
            {product.unit ? <span style={{ fontSize: 13, color: "var(--dc-muted)", fontWeight: 500 }}> {product.unit}</span> : null}
          </div>
        </div>
      </div>

      {/* ---- ไทม์ไลน์การเคลื่อนไหว ---- */}
      <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--dc-line)", fontWeight: 700, fontSize: 14.5, color: "var(--dc-ink)" }}>
          การเคลื่อนไหวล่าสุด
        </div>
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--dc-muted)" }}>
            <PackageSearch size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>ยังไม่มีการเคลื่อนไหว</div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {entries.map((e, i) => (
              <LogRow key={i} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: ProductStockLogEntry }) {
  const qtyColor = entry.qty > 0 ? "#1f8a4c" : entry.qty < 0 ? "#c0392b" : "var(--dc-muted)";
  const qtyText = entry.qty === 0 ? "ย้ายที่" : `${entry.qty > 0 ? "+" : ""}${entry.qty}`;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--dc-line)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 14.5, color: "var(--dc-ink)" }}>{entry.kind}</span>
          {entry.warehouseName ? (
            <span style={{ fontSize: 12, color: "var(--dc-muted)" }}>· {entry.warehouseName}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--dc-muted)", marginTop: 2 }}>{fmtDateTime(entry.occurredAt)}</div>
        {entry.note ? (
          <div style={{ fontSize: 12.5, color: "var(--dc-subtle, #7a8598)", marginTop: 2 }}>{entry.note}</div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: qtyColor }}>{qtyText}</div>
        {entry.balanceAfter !== null ? (
          <div style={{ fontSize: 12, color: "var(--dc-muted)", marginTop: 1 }}>เหลือ {entry.balanceAfter}</div>
        ) : null}
      </div>
    </li>
  );
}

function Thumb({ url, size = 64 }: { url?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--dc-canvas, #f1f4f9)",
        border: "1px solid var(--dc-line)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <ImageIcon size={Math.round(size * 0.42)} color="var(--dc-subtle, #9aa4b2)" />
      )}
    </span>
  );
}

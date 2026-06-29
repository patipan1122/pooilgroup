"use client";

/**
 * ClawOS — shared UI primitives (client).
 * แปลจาก design (claude.ai) เป็น React component กลาง เพื่อให้ทุกหน้าหน้าตาตรงกัน.
 * นำเข้าจาก @/components/clawfleet/os/kit
 */

import { type ReactNode } from "react";
import { TONE, type Tone } from "./format";

/* ── status pill ────────────────────────────────────────────────────────── */
export function Pill({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={"co-pill num " + className}
      style={{ background: t.bg, color: t.text }}
    >
      {children}
    </span>
  );
}

/* ── colored icon square ────────────────────────────────────────────────── */
export function IconBox({
  tone = "brand",
  size = 30,
  radius = 8,
  bg,
  color,
  children,
}: {
  tone?: Tone;
  size?: number;
  radius?: number;
  bg?: string;
  color?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg ?? t.bg,
        color: color ?? t.text,
      }}
    >
      {children}
    </span>
  );
}

/* ── KPI card ───────────────────────────────────────────────────────────── */
export function Kpi({
  icon,
  label,
  value,
  delta,
  deltaColor = "#15803D",
  valueColor = "#1A1D21",
  iconTone = "brand",
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaColor?: string;
  valueColor?: string;
  iconTone?: Tone;
}) {
  return (
    <div className="co-card" style={{ padding: "16px 17px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {icon && <IconBox tone={iconTone}>{icon}</IconBox>}
        <span style={{ fontSize: 12.5, color: "#6B7280", fontWeight: 500, lineHeight: 1.2 }}>{label}</span>
      </div>
      <div className="num" style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-0.5px", color: valueColor }}>
        {value}
      </div>
      {delta != null && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: deltaColor, fontWeight: 500 }}>{delta}</div>
      )}
    </div>
  );
}

/* ── section card with header ───────────────────────────────────────────── */
export function Card({
  title,
  sub,
  right,
  children,
  pad = true,
  className = "",
  style,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={"co-card " + className} style={{ overflow: "hidden", ...style }}>
      {(title || right) && (
        <div
          style={{
            padding: "16px 20px 13px",
            borderBottom: "1px solid #F0F1F4",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>}
            {sub && <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 1 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div style={pad ? { padding: "18px 20px" } : undefined}>{children}</div>
    </section>
  );
}

/* ── modal ──────────────────────────────────────────────────────────────── */
export function Modal({
  open,
  onClose,
  title,
  sub,
  badge,
  width = 580,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(20,22,28,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          width,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "1px solid #EEF0F3" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 1 }}>{sub}</div>}
          </div>
          {badge}
          <span
            className="co-tap"
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 10, background: "#F1F2F5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#454B54" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </span>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ borderTop: "1px solid #EEF0F3" }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ── toggle switch ──────────────────────────────────────────────────────── */
export function Toggle({ on, onChange }: { on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!on)}
      style={{
        width: 42,
        height: 24,
        flex: "0 0 42px",
        borderRadius: 20,
        border: "none",
        cursor: "pointer",
        background: on ? "#4F46E5" : "#D5D9E0",
        position: "relative",
        transition: "background .15s",
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

/* ── progress bar ───────────────────────────────────────────────────────── */
export function ProgressBar({ pct, color = "#4F46E5", track = "#EDEFF2", height = 7 }: { pct: number; color?: string; track?: string; height?: number }) {
  return (
    <div style={{ height, background: track, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 6, transition: "width .2s" }} />
    </div>
  );
}

/* ── machine-config health bar (avg baht/doll) ─────────────────────────── */
export function AvgWinBar({ markerPct }: { markerPct: string }) {
  return (
    <>
      <div
        style={{
          position: "relative",
          height: 14,
          borderRadius: 8,
          background: "linear-gradient(90deg,#E8A33D 0%,#E8A33D 22%,#2FA866 38%,#2FA866 64%,#E8A33D 78%,#DB5040 100%)",
          marginBottom: 8,
        }}
      >
        <div style={{ position: "absolute", top: -7, width: 4, height: 28, borderRadius: 3, background: "#1A1D21", boxShadow: "0 0 0 3px #fff", left: markerPct }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#9AA1AB" }}>
        <span>฿60 · ออกง่ายไป</span>
        <span>฿180 · กำลังดี</span>
        <span>฿300 · ยากไป</span>
      </div>
    </>
  );
}

/* ── phone frame (for back-office mobile preview + real device render) ───── */
export function PhoneFrame({ children, time = "14:32" }: { children: ReactNode; time?: string }) {
  return (
    <div style={{ width: 392, flex: "0 0 392px", maxWidth: "100%", background: "#1B1E2A", borderRadius: 46, padding: 11, boxShadow: "0 30px 70px -20px rgba(27,30,42,0.55)" }}>
      <div style={{ position: "relative", width: "100%", height: 768, background: "#F5F6F8", borderRadius: 36, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 130, height: 26, background: "#1B1E2A", borderRadius: "0 0 16px 16px", zIndex: 20 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 26px 6px", fontSize: 12, fontWeight: 600, color: "#1A1D21", zIndex: 10 }}>
          <span className="num">{time}</span>
          <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <svg width="16" height="11" viewBox="0 0 18 12" fill="#1A1D21"><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="4.5" y="4.5" width="3" height="7.5" rx="1" /><rect x="9" y="2" width="3" height="10" rx="1" /><rect x="13.5" y="0" width="3" height="12" rx="1" /></svg>
            <svg width="22" height="12" viewBox="0 0 24 12" fill="none"><rect x="1" y="1" width="20" height="10" rx="2.5" stroke="#1A1D21" strokeWidth="1.2" /><rect x="2.5" y="2.5" width="15" height="7" rx="1.2" fill="#1A1D21" /><rect x="22" y="4" width="1.6" height="4" rx="0.8" fill="#1A1D21" /></svg>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── empty state ────────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "48px 20px", color: "#9AA1AB" }}>
      {icon && <div style={{ marginBottom: 12, opacity: 0.6 }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 700, color: "#5A6270" }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, marginTop: 4, maxWidth: 320 }}>{sub}</div>}
    </div>
  );
}

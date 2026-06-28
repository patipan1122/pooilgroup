// DC Redesign v2 · shell หลังบ้านเต็มจอ (ครีม/ฟ้า) — ตรงตาม prototype DC Redesign v2.dc.html
//
// ใช้แทน AdminShell บนหน้า DC ที่ปรับโฉมแล้ว (AdminShell early-return ให้ path เหล่านี้).
// server component — nav เป็น <Link> จริงไปหน้าที่มีอยู่ · active/badge/task-strip รับเป็น props.
import Link from "next/link";
import "./dc-redesign.css";

type SvgProps = { size?: number; sw?: number; stroke?: string; fill?: string; children: React.ReactNode };
function Svg({ size = 18, sw = 1.8, stroke = "currentColor", fill = "none", children }: SvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw}>
      {children}
    </svg>
  );
}

// ---- ไอคอน (คัดจาก prototype ตรง ๆ) ----
const IcCube = <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></>;
const IcGrid = <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>;
const IcCart = <><circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2 3h2.3l2.4 12.3a1.4 1.4 0 0 0 1.4 1.1h8.4a1.4 1.4 0 0 0 1.4-1.1L21 7H6.2" /></>;
const IcVendor = <><path d="M3 21h18" /><path d="M5 21V8l7-4 7 4v13" /><path d="M9 21v-6h6v6" /></>;
const IcShip = <><path d="M3 16l1.5-5h15L21 16" /><path d="M2 16h20l-1 4H3z" /><path d="M9 11V6h5l3 5" /></>;
const IcGrn = <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 12.5l2 2 4-4.5" /></>;
const IcWarehouse = <><path d="M3 21V9l9-5 9 5v12" /><rect x="7" y="13" width="10" height="8" /></>;
const IcTransfer = <><path d="M4 7h13l-3-3" /><path d="M20 17H7l3 3" /></>;
const IcCount = <><rect x="6" y="4" width="12" height="17" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M9 11h6M9 15h4" /></>;
const IcReport = <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>;
const IcRecon = <><path d="M12 3v18M5 7l-3 6h6zM19 7l-3 6h6z" /><path d="M5 21h14" /></>;
const IcBack = <><path d="M3 21V9l9-5 9 5v12" /><rect x="9" y="13" width="6" height="8" /></>;
const IcSearch = <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>;
const IcBell = <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>;
const IcChevDown = <path d="M6 9l6 6 6-6" />;
const IcBolt = <path d="M13 2L3 14h7l-1 8 10-12h-7z" />;

export type DcNavKey =
  | "dash" | "po" | "suppliers" | "ship" | "grn"
  | "products" | "warehouses" | "transfer" | "count" | "reports" | "recon";

type Badge = { color: string; bg: string; n: number };

export type DcOfficeShellProps = {
  active: DcNavKey;
  warehouseName: string;
  userName: string;
  userRole: string;
  badges?: { po?: number; ship?: number; grn?: number };
  taskStrip?: { tracking: number; grn: number; inTransit: number } | null;
  children: React.ReactNode;
};

function NavItem({
  href, label, icon, on, badge,
}: { href: string; label: string; icon: React.ReactNode; on?: boolean; badge?: Badge | null }) {
  return (
    <Link href={href} className={on ? "dcx-nav on" : "dcx-nav"}>
      <Svg>{icon}</Svg>
      <span>{label}</span>
      {badge && badge.n > 0 ? (
        <span className="num" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: badge.color, background: badge.bg, padding: "1px 7px", borderRadius: 20 }}>
          {badge.n}
        </span>
      ) : null}
    </Link>
  );
}

export function DcOfficeShell({ active, warehouseName, userName, userRole, badges, taskStrip, children }: DcOfficeShellProps) {
  const poBadge: Badge | null = badges?.po ? { color: "#5B53D8", bg: "#EDEAFB", n: badges.po } : null;
  const shipBadge: Badge | null = badges?.ship ? { color: "#2AA3A3", bg: "#D9F0EC", n: badges.ship } : null;
  const grnBadge: Badge | null = badges?.grn ? { color: "#B45309", bg: "#FEF1DE", n: badges.grn } : null;
  const arriving = taskStrip?.inTransit ?? 0;
  const showStrip = taskStrip && (taskStrip.tracking > 0 || taskStrip.grn > 0 || taskStrip.inTransit > 0);

  return (
    <div className="dcx">
      {/* ============ SIDEBAR ============ */}
      <aside style={{ width: 248, flexShrink: 0, background: "#fff", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16 }}>P</div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Pooilgroup</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Command Center</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surf2)" }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Svg size={15} sw={1.8} stroke="#B07A3C">{IcCube}</Svg>
            </div>
            <div style={{ lineHeight: 1.2, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{warehouseName}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>คลังกลาง + กระจายสินค้า</div>
            </div>
            <Svg size={14} sw={2} stroke="#9A9082">{IcChevDown}</Svg>
          </div>
        </div>

        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 12px 16px" }}>
          <NavItem href="/dc/office" label="ภาพรวม" icon={IcGrid} on={active === "dash"} />

          {/* #16 CEO: เมนูรก — ยุบ "ผู้ขาย" + "ขนส่ง/ชิปเมนต์" เข้าเป็นแท็บในหน้าสั่งซื้อ (เหลือ 9 เมนู) */}
          <div className="dcx-seclabel">จัดซื้อ &amp; นำเข้า</div>
          <NavItem href="/dc/office/purchasing" label="สั่งซื้อ / นำเข้า" icon={IcCart} on={active === "po" || active === "suppliers" || active === "ship"} badge={poBadge} />
          <NavItem href="/dc/office/receipts" label="ใบรับสินค้า (GRN)" icon={IcGrn} on={active === "grn"} badge={grnBadge} />

          <div className="dcx-seclabel">คลังสินค้า</div>
          <NavItem href="/dc/office/products" label="สินค้า" icon={IcCube} on={active === "products"} />
          <NavItem href="/dc/office/warehouses" label="โกดัง & ที่เก็บ" icon={IcWarehouse} on={active === "warehouses"} />
          <NavItem href="/dc/office/transfers" label="โอน / ย้ายที่" icon={IcTransfer} on={active === "transfer"} />
          <NavItem href="/dc/count" label="นับสต๊อก" icon={IcCount} on={active === "count"} />

          <div className="dcx-seclabel">วิเคราะห์</div>
          <NavItem href="/dc/office/reports" label="รายงาน" icon={IcReport} on={active === "reports"} />
          <NavItem href="/dc/office/reconcile" label="กระทบยอด" icon={IcRecon} on={active === "recon"} />
        </nav>

        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6D54C9,#8B5CD8)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>
            {(userName || "?").charAt(0).toUpperCase()}
          </div>
          <div style={{ lineHeight: 1.25, flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{userRole}</div>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* topbar */}
        <header style={{ height: 62, flexShrink: 0, background: "#fff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16, padding: "0 22px" }}>
          <div style={{ display: "flex", background: "var(--surf2)", borderRadius: 10, padding: 3, gap: 2 }}>
            <Link href="/dc" className="dcx-top off"><Svg size={15}>{IcCube}</Svg>หน้าคลัง</Link>
            <Link href="/dc/office" className="dcx-top on"><Svg size={15}>{IcBack}</Svg>หลังบ้าน</Link>
          </div>

          <div style={{ flex: 1, maxWidth: 420, display: "flex", alignItems: "center", gap: 9, background: "var(--surf2)", border: "1px solid transparent", borderRadius: 10, padding: "9px 13px" }}>
            <Svg size={16} stroke="#9A9082">{IcSearch}</Svg>
            <span style={{ color: "var(--muted)", fontSize: 13.5 }}>ค้นหาใบสั่งซื้อ, สินค้า, ผู้ขาย…</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "1px 6px" }}>⌘K</span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            {arriving > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#D9F0EC", color: "#147A7A", padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2AA3A3" }} />{arriving} ถึงวันนี้
              </div>
            ) : null}
            <div style={{ position: "relative", cursor: "pointer" }}>
              <Svg size={20} stroke="#5B6477">{IcBell}</Svg>
              <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: "50%", background: "#DC5B53", border: "1.5px solid #fff" }} />
            </div>
          </div>
        </header>

        {/* task strip */}
        {showStrip ? (
          <div style={{ flexShrink: 0, background: "linear-gradient(90deg,#EEF3FF,#F4EFE8)", borderBottom: "1px solid var(--border)", padding: "9px 22px", display: "flex", alignItems: "center", gap: 20, fontSize: 13 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, color: "var(--primary-d)" }}><Svg size={15} sw={2}>{IcBolt}</Svg>งานค้างวันนี้</span>
            <span style={{ color: "var(--ink2)" }}><b style={{ color: "var(--ink)" }}>{taskStrip!.tracking}</b> ใบสั่งแล้วรอใส่ Tracking</span>
            <span style={{ width: 1, height: 14, background: "var(--border-2)" }} />
            <span style={{ color: "var(--ink2)" }}><b style={{ color: "var(--ink)" }}>{taskStrip!.grn}</b> ใบรับเข้า (GRN)</span>
            <span style={{ width: 1, height: 14, background: "var(--border-2)" }} />
            <span style={{ color: "var(--ink2)" }}><b style={{ color: "var(--ink)" }}>{taskStrip!.inTransit}</b> ของระหว่างทางถึงวันนี้</span>
            <Link href="/dc/office/shipments" style={{ marginLeft: "auto", color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>ดูทั้งหมด →</Link>
          </div>
        ) : null}

        {/* scroll body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

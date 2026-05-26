"use client";

// Session Inspector · right pane when a session is selected from left list
// Shows everything the cashier needs to act on this person without leaving
// the workspace · check out · extend · charge POS to this session

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkOutSession, extendSession } from "@/lib/playland/actions";
import { fmtTime, fmtElapsed, thb, memberTypeLabel } from "@/lib/playland/format";
import { X, LogOut, Plus, ShoppingBasket, Clock, Award } from "lucide-react";

type PayMethod = "CASH" | "PROMPTPAY" | "STRIPE" | "CHARGE_TO_MEMBER";

interface Props {
  session: {
    id: string;
    memberName: string;
    memberType: string;
    memberCode: string | null;
    phone: string | null;
    photoR2Path: string | null;
    packageName: string;
    packageMinutes: number;
    packagePriceCents: number;
    checkInAt: string;
    expiresAt: string | null;
    status: string;
  };
  packages: Array<{ id: string; name: string; price: number; minutes: number }>;
  backHref: string;
}

export function SessionInspector({ session, packages, backHref }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [extendPkg, setExtendPkg] = useState<{ id: string; name: string; price: number; minutes: number } | null>(null);
  const [pay, setPay] = useState<PayMethod>("CASH");
  const s = session;

  const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : null;
  const remainMin = remainingMs !== null ? Math.max(0, Math.floor(remainingMs / 60000)) : null;
  const danger = remainMin !== null && remainMin <= 0;
  const warn = remainMin !== null && remainMin < 10;

  function doCheckout() {
    if (!confirm(`Check-out "${s.memberName}" ออกถาวร? · ห้าม refund ตามนโยบาย`)) return;
    start(async () => {
      const res = await checkOutSession(s.id);
      if (!res.ok) alert(res.error); else { router.push(backHref); router.refresh(); }
    });
  }

  function confirmExtend() {
    if (!extendPkg) return;
    start(async () => {
      const res = await extendSession({ sessionId: s.id, extraPackageId: extendPkg.id, paymentMethod: pay });
      if (!res.ok) { alert(res.error); return; }
      setExtendPkg(null);
      setPay("CASH");
      router.refresh();
    });
  }

  return (
    <>
      <div className="pl-pane-head">
        <div>
          <div className="pl-pane-title">Inspector</div>
          <div className="pl-pane-count">session detail</div>
        </div>
        <Link href={backHref} className="pl-btn pl-btn-ghost pl-btn-sm" aria-label="close">
          <X size={14} />
        </Link>
      </div>

      <div style={{ padding: 18 }}>
        {/* Hero: photo + name + countdown */}
        <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
          {s.photoR2Path ? (
            <img src={s.photoR2Path} alt="" style={{ width: 76, height: 76, borderRadius: 14, objectFit: "cover" }} />
          ) : (
            <div style={{
              width: 76, height: 76, borderRadius: 14,
              background: "linear-gradient(135deg, var(--pl-amber-100), var(--pl-amber-200))",
              display: "grid", placeItems: "center",
              fontFamily: "var(--pl-font-display)", fontSize: 32, fontWeight: 500,
              color: "var(--pl-amber-900)",
            }}>
              {s.memberName[0]}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.2rem", fontWeight: 500, letterSpacing: "-0.02em" }}>{s.memberName}</div>
            <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)", marginTop: 2 }}>
              {s.memberCode ?? "—"}
            </div>
            <span className="pl-chip pl-chip-brand" style={{ marginTop: 6 }}>{memberTypeLabel(s.memberType)}</span>
          </div>
        </div>

        {/* Countdown hero */}
        <div className="pl-card pl-card-accent" style={{ textAlign: "center", padding: "16px" }}>
          <div className="pl-stat-label" style={{ marginBottom: 4 }}>เหลือเวลา</div>
          <div className={`pl-countdown${danger ? " is-danger" : warn ? " is-warn" : ""}`} data-expires-at={s.expiresAt ?? ""} style={{ fontSize: "2.4rem" }}>
            {s.packageMinutes === 0 ? "∞ ทั้งวัน" : remainMin !== null ? `${remainMin} นาที` : "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 6 }}>
            {s.packageName} · เข้า {fmtTime(s.checkInAt)} ({fmtElapsed(s.checkInAt)})
          </div>
        </div>

        {/* Quick actions */}
        <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
          <Link href={`/playland/pos?session=${s.id}`} className="pl-btn pl-btn-lg" style={{ justifyContent: "flex-start" }}>
            <ShoppingBasket size={16} /> ขายของให้คนนี้ (charge to bill)
          </Link>
          <details>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <span className="pl-btn pl-btn-lg" style={{ justifyContent: "flex-start", width: "100%" }}>
                <Plus size={16} /> ต่อเวลา · เลือก package
              </span>
            </summary>
            <div style={{ marginTop: 6, padding: 10, background: "var(--pl-ink-50)", borderRadius: 10 }}>
              {packages.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  className="pl-btn pl-btn-sm"
                  style={{ width: "100%", justifyContent: "space-between", marginBottom: 4 }}
                  onClick={() => setExtendPkg(p)}
                  disabled={pending}
                >
                  <span>{p.name}</span>
                  <span className="pl-num">{thb(p.price)}</span>
                </button>
              ))}
            </div>
          </details>
          <button className="pl-btn pl-btn-danger pl-btn-lg" style={{ justifyContent: "flex-start" }} onClick={doCheckout} disabled={pending}>
            <LogOut size={16} /> Check-out (ปิด session)
          </button>
        </div>

        {/* Mini stats */}
        <div className="pl-divider" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="pl-stat">
            <span className="pl-stat-label"><Clock size={10} style={{ display: "inline", marginRight: 4 }} />ค่าเข้า</span>
            <span className="pl-stat-value" style={{ fontSize: "1.3rem" }}>{thb(s.packagePriceCents)}</span>
          </div>
          <div className="pl-stat">
            <span className="pl-stat-label"><Award size={10} style={{ display: "inline", marginRight: 4 }} />สถานะ</span>
            <span style={{ fontSize: "1rem", fontWeight: 600 }}>{s.status}</span>
          </div>
        </div>

        {s.phone && (
          <>
            <div className="pl-divider" />
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
              📞 {s.phone}
            </div>
          </>
        )}
      </div>

      {extendPkg && (
        <div
          onClick={() => !pending && setExtendPkg(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "grid", placeItems: "center", padding: 16, zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="pl-card"
            style={{ maxWidth: 420, width: "100%", display: "grid", gap: 12, padding: 18, background: "white" }}
          >
            <div>
              <div className="pl-eyebrow">ต่อเวลา</div>
              <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.3rem", fontWeight: 600 }}>{extendPkg.name}</div>
              <div style={{ fontSize: 13, color: "var(--pl-text-muted)" }}>
                +{extendPkg.minutes} นาที · {thb(extendPkg.price)}
              </div>
            </div>

            <div>
              <label className="pl-label">ชำระเงิน</label>
              <div className="pl-toggle-group">
                {(["CASH", "PROMPTPAY", "STRIPE", "CHARGE_TO_MEMBER"] as const).map((m) => (
                  <button type="button" key={m} className={pay === m ? "is-active" : ""} onClick={() => setPay(m)}>
                    {m === "CASH" ? "เงินสด" : m === "PROMPTPAY" ? "PromptPay" : m === "STRIPE" ? "บัตร" : "ใส่บิล"}
                  </button>
                ))}
              </div>
              {pay === "PROMPTPAY" && (
                <div style={{ marginTop: 10, padding: 12, background: "var(--pl-ink-50)", borderRadius: 10, border: "1px dashed var(--pl-amber-400)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginBottom: 6 }}>QR PromptPay (placeholder · API จริง v2)</div>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`promptpay://extend/${s.id}/${extendPkg.price}`)}&qzone=1`}
                    alt="QR PromptPay"
                    width={160} height={160}
                    style={{ width: 160, height: 160 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--pl-text-muted)", marginTop: 4 }}>
                    {thb(extendPkg.price)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button type="button" className="pl-btn" onClick={() => setExtendPkg(null)} disabled={pending} style={{ flex: 1 }}>
                ยกเลิก
              </button>
              <button type="button" className="pl-btn pl-btn-primary" onClick={confirmExtend} disabled={pending} style={{ flex: 2 }}>
                {pending ? "กำลังต่อ..." : `✅ ยืนยัน · +${extendPkg.minutes} นาที`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

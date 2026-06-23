/**
 * ClawFleet v2 — Preview / mode picker ("ดูได้ทั้งหน้าบ้าน·หลังบ้านในเว็บเดียว")
 *
 * CEO ask (2026-06-23): "preview หน้าบ้านมือถือได้ด้วย · แยกหน้าบ้าน/หลังบ้าน
 * แต่ดูได้ในเว็บทั้งหมด" — mirrors the prototype's ClawFleet Prototype.html picker.
 * Shows the EMPLOYEE mobile app (/liff/clawfleet) live inside a phone frame +
 * a card into the owner Hub. Both are real, in-browser, same auth session.
 * Additive route — does not change the role-based /clawfleet redirect.
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ClawfleetPreviewPage() {
  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">พรีวิว</div>
          <h1 className="cf-h1">
            หน้าบ้าน <span className="cf-h1-em">vs</span> หลังบ้าน
          </h1>
          <div className="cf-page-sub">
            ดูได้ทั้งสองโหมดในเว็บเดียว — แอปพนักงานบนมือถือ + Hub เจ้าของ
          </div>
        </div>
      </div>

      <div className="cf-preview-grid">
        {/* ── Employee mobile (front-of-house) in a phone frame ── */}
        <section className="cf-section">
          <div className="cf-section-head">
            <div>
              <h3 className="cf-section-title">แอปพนักงาน · มือถือ</h3>
              <div className="cf-section-sub">หน้างาน — เก็บรอบ · ถ่ายรูป · cross-check</div>
            </div>
            <a className="cf-btn cf-btn-ghost cf-btn-sm" href="/liff/clawfleet" target="_blank" rel="noopener">
              เปิดเต็มจอ ↗
            </a>
          </div>
          <div className="cf-phone-frame">
            <iframe src="/liff/clawfleet" title="แอปพนักงาน (มือถือ)" className="cf-phone-screen" />
          </div>
        </section>

        {/* ── Owner Hub (back-of-house) ── */}
        <section className="cf-section">
          <div className="cf-section-head">
            <div>
              <h3 className="cf-section-title">Hub เจ้าของ · เดสก์ท็อป</h3>
              <div className="cf-section-sub">หลังบ้าน — ดู · ตรวจ · อนุมัติ</div>
            </div>
          </div>
          <div className="cf-preview-hub">
            <ul className="cf-preview-list">
              {[
                ["Hub", "ภาพรวมวันนี้ + รายการที่ต้องทำ", "/clawfleet/v2/hub"],
                ["Operations", "รอบเก็บที่กำลังเดิน", "/clawfleet/v2/operations"],
                ["Anomaly", "รายการที่ระบบ flag · cross-check", "/clawfleet/v2/anomalies"],
                ["Insights", "รายงาน + CSV", "/clawfleet/v2/insights"],
                ["Stock", "ของรางวัล · คลัง + ในตู้", "/clawfleet/v2/stock"],
              ].map(([title, gloss, href]) => (
                <li key={href}>
                  <Link href={href} className="cf-preview-row">
                    <div className="cf-preview-row-text">
                      <div className="cf-preview-row-title">{title}</div>
                      <div className="cf-preview-row-gloss">{gloss}</div>
                    </div>
                    <span className="cf-preview-row-go">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

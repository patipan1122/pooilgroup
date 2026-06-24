/**
 * ClawFleet v2 — จัดการ ("เพิ่มสาขา/ตู้"). Management overview: every branch +
 * its machine count, with real links into stock/overview + settings for config.
 * Reuses loadBranches — no dead UI, no fake CRUD.
 */
import Link from "next/link";
import { loadBranches } from "@/lib/clawfleet/v2-loaders";
import { Pill } from "@/components/clawfleet/v2/chrome";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const branches = await loadBranches();
  const totalMachines = branches.reduce((s, b) => s + b.machines, 0);

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">จัดการ</div>
          <h1 className="cf-h1">สาขา &amp; ตู้</h1>
          <div className="cf-page-sub">
            {branches.length} สาขา · {totalMachines} ตู้ทั้งหมด
          </div>
        </div>
        <Link href="/clawfleet/v2/settings" className="cf-btn cf-btn-primary">
          ตั้งค่าระบบ →
        </Link>
      </div>

      <div className="cf-manage-grid">
        {branches.map((b) => (
          <div key={b.id} className="cf-manage-card">
            <div className="cf-manage-card-head">
              <div className={`cf-branch-flag cf-branch-flag-${b.tone}`}>{b.avatar}</div>
              <div className="cf-fleet-card-id">
                <div className="cf-fleet-card-name">{b.name}</div>
                <div className="cf-fleet-card-meta">
                  {b.area} · {b.code}
                </div>
              </div>
              <Pill color="slate" size="sm">
                {b.machines} ตู้
              </Pill>
            </div>
            <div className="cf-manage-card-actions">
              <Link href={`/clawfleet/v2/stock?branch=${b.id}`} className="cf-btn cf-btn-ghost cf-btn-sm">
                สต็อก
              </Link>
              <Link href={`/clawfleet/v2/hub?branch=${b.id}`} className="cf-btn cf-btn-ghost cf-btn-sm">
                ภาพรวม
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="cf-section cf-manage-note">
        <div className="cf-section-sub">
          ➕ เพิ่ม/แก้สาขาและตู้ + threshold ตั้งค่าได้ที่หน้า{" "}
          <Link href="/clawfleet/v2/settings" className="cf-manage-note-link">
            ตั้งค่า
          </Link>
        </div>
      </div>
    </div>
  );
}

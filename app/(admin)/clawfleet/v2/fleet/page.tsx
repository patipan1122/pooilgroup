/**
 * ClawFleet v2 — Fleet ("10 สาขา · สถานะ"). Matches the prototype hub.html Fleet
 * view: a card grid of every branch with today's revenue + anomaly + machine count.
 * Reuses the existing loaders (loadBranches + loadHubData branchPerf) — no new data.
 */
import { loadBranches, loadHubData } from "@/lib/clawfleet/v2-loaders";
import { Pill } from "@/components/clawfleet/v2/chrome";

export const dynamic = "force-dynamic";

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const branch = (await searchParams).branch ?? "all";
  const [branches, hub] = await Promise.all([loadBranches(), loadHubData(branch)]);
  const perf = new Map(hub.branchPerf.map((b) => [b.id, b]));

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Fleet</div>
          <h1 className="cf-h1">{branches.length} สาขา · สถานะวันนี้</h1>
          <div className="cf-page-sub">ภาพรวมทุกสาขา — รายได้ · anomaly · จำนวนตู้ (คลิกเพื่อเข้าสาขา)</div>
        </div>
      </div>

      <div className="cf-fleet-grid">
        {branches.map((b) => {
          const p = perf.get(b.id);
          const rev = p?.revenue ?? 0;
          const anomaly = p?.anomaly ?? 0;
          return (
            <a
              key={b.id}
              href={`/clawfleet/v2/hub/${b.id}`}
              className={`cf-fleet-card ${anomaly > 0 ? "is-attention" : ""}`}
            >
              <div className="cf-fleet-card-head">
                <div className={`cf-branch-flag cf-branch-flag-${b.tone}`}>{b.avatar}</div>
                <div className="cf-fleet-card-id">
                  <div className="cf-fleet-card-name">{b.name}</div>
                  <div className="cf-fleet-card-meta">
                    {b.area} · {b.machines} ตู้
                  </div>
                </div>
              </div>
              <div className="cf-fleet-card-foot">
                {anomaly > 0 ? (
                  <Pill color="red" size="sm" dot>
                    {anomaly} anomaly
                  </Pill>
                ) : (
                  <Pill color="emerald" size="sm" dot>
                    ปกติ
                  </Pill>
                )}
                <span className="cf-fleet-card-rev">฿{rev.toLocaleString("th-TH")}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

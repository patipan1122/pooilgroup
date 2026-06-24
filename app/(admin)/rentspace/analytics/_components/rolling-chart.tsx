"use client";

import { formatBaht } from "@/lib/rentspace/format";

type RevenueMonth = {
  period: string;
  label: string;
  billed: number;
  collected: number;
};

const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** สั้น ๆ บนแกน: "ม.ค.\n68" (ปี พ.ศ. 2 หลัก) */
function shortLabel(period: string): { mon: string; yr: string } {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return { mon: period, yr: "" };
  return { mon: TH_MONTHS_SHORT[m - 1], yr: String((y + 543) % 100).padStart(2, "0") };
}

/** ฿1.2K / ฿1.2M — ย่อให้อ่านง่ายบนหัวแท่ง */
function compactBaht(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `฿${v >= 10 ? Math.round(v) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `฿${v >= 10 ? Math.round(v) : v.toFixed(1)}K`;
  }
  return `฿${Math.round(n)}`;
}

export default function RollingChart({ rolling12 }: { rolling12: RevenueMonth[] }) {
  const max = Math.max(1, ...rolling12.map((m) => Math.max(m.billed, m.collected)));
  // gridlines ที่ 25/50/75/100%
  const gridPct = [100, 75, 50, 25];

  return (
    <div className="rs-rev-chart">
      {/* legend */}
      <div className="rs-rev-legend">
        <span className="rs-rev-li">
          <span className="rs-rev-sw" style={{ background: "var(--rs-info)" }} /> ออกบิล
        </span>
        <span className="rs-rev-li">
          <span className="rs-rev-sw" style={{ background: "var(--rs-ok)" }} /> เก็บได้
        </span>
      </div>

      <div className="rs-rev-scroll">
        <div className="rs-rev-plot">
          {/* gridlines */}
          <div className="rs-rev-grid">
            {gridPct.map((p) => (
              <div key={p} className="rs-rev-gridline" style={{ bottom: `${p}%` }}>
                <span className="rs-rev-gridval">{compactBaht((max * p) / 100)}</span>
              </div>
            ))}
            <div className="rs-rev-gridline rs-rev-baseline" style={{ bottom: 0 }} />
          </div>

          {/* bars */}
          <div className="rs-rev-bars">
            {rolling12.map((m) => {
              const billedH = Math.max(0, (m.billed / max) * 100);
              const collectedH = Math.max(0, (m.collected / max) * 100);
              const lab = shortLabel(m.period);
              const title = `${m.label} · ออกบิล ${formatBaht(m.billed)} · เก็บได้ ${formatBaht(m.collected)}`;
              return (
                <div key={m.period} className="rs-rev-col" title={title}>
                  <div className="rs-rev-pair">
                    <div className="rs-rev-bar-wrap">
                      {m.billed > 0 && <span className="rs-rev-caption">{compactBaht(m.billed)}</span>}
                      <div
                        className="rs-rev-bar"
                        style={{ height: `${billedH}%`, background: "var(--rs-info)" }}
                      />
                    </div>
                    <div className="rs-rev-bar-wrap">
                      {m.collected > 0 && <span className="rs-rev-caption">{compactBaht(m.collected)}</span>}
                      <div
                        className="rs-rev-bar"
                        style={{ height: `${collectedH}%`, background: "var(--rs-ok)" }}
                      />
                    </div>
                  </div>
                  <div className="rs-rev-xlabel">
                    <span className="rs-rev-mon">{lab.mon}</span>
                    <span className="rs-rev-yr">{lab.yr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style jsx>{`
        .rs-rev-chart {
          padding: 12px 16px 18px;
          font-variant-numeric: tabular-nums;
        }
        .rs-rev-legend {
          display: flex;
          gap: 16px;
          justify-content: flex-end;
          margin-bottom: 10px;
        }
        .rs-rev-li {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--rs-text-2);
        }
        .rs-rev-sw {
          width: 11px;
          height: 11px;
          border-radius: 3px;
          display: inline-block;
        }
        .rs-rev-scroll {
          overflow-x: auto;
          padding-left: 44px; /* room for gridline value labels */
        }
        .rs-rev-plot {
          position: relative;
          width: 100%;
          height: 220px;
        }
        .rs-rev-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .rs-rev-gridline {
          position: absolute;
          left: 0;
          right: 0;
          height: 0;
          border-top: 1px dashed var(--rs-border);
        }
        .rs-rev-baseline {
          border-top: 1px solid var(--rs-text-3);
        }
        .rs-rev-gridval {
          position: absolute;
          left: -44px;
          top: -8px;
          width: 38px;
          text-align: right;
          font-size: 10px;
          color: var(--rs-text-3);
        }
        .rs-rev-bars {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: flex-end;
          gap: 1px;
        }
        .rs-rev-col {
          flex: 1 1 0;
          min-width: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .rs-rev-pair {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 2px;
          height: 100%;
        }
        .rs-rev-bar-wrap {
          position: relative;
          flex: 1 1 0;
          min-width: 0;
          max-width: 13px;
          height: 100%;
          display: flex;
          align-items: flex-end;
        }
        @media (min-width: 640px) {
          .rs-rev-bar-wrap {
            flex: 0 0 auto;
            width: 13px;
          }
          .rs-rev-bars {
            gap: 2px;
          }
          .rs-rev-pair {
            gap: 3px;
          }
        }
        .rs-rev-bar {
          width: 100%;
          min-height: 2px;
          border-radius: 4px 4px 0 0;
          transition: filter 0.15s;
        }
        .rs-rev-col:hover .rs-rev-bar {
          filter: brightness(1.08) saturate(1.1);
        }
        .rs-rev-caption {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 3px;
          font-size: 9px;
          font-weight: 600;
          color: var(--rs-text-3);
          white-space: nowrap;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .rs-rev-col:hover .rs-rev-caption {
          opacity: 1;
        }
        .rs-rev-xlabel {
          margin-top: 8px;
          text-align: center;
          line-height: 1.15;
        }
        .rs-rev-mon {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--rs-text-2);
        }
        .rs-rev-yr {
          display: block;
          font-size: 11px;
          color: var(--rs-text-3);
        }
      `}</style>
    </div>
  );
}

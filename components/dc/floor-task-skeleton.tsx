// Shared skeleton for DC floor task screens (receive-po / receive / issue /
// transfer / count) — head + a card with a big scan-box block + a few lines.
// Pure server component; each route still needs its own loading.tsx file.
export function DcFloorTaskSkeleton() {
  return (
    <div className="dc-page" aria-busy="true" aria-label="กำลังโหลด">
      <div className="dc-head">
        <div style={{ flex: 1 }}>
          <div className="dc-skel dc-skel--title" />
          <div className="dc-skel dc-skel--line" style={{ width: "45%", marginTop: 10 }} />
        </div>
      </div>
      <div className="dc-card">
        <div className="dc-skel dc-skel--card" style={{ marginBottom: 16 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="dc-skel dc-skel--line" style={{ width: `${88 - i * 10}%` }} />
        ))}
      </div>
    </div>
  );
}

// DC · floor landing skeleton — mirrors the big-tile launcher while it loads.
// Covers /dc + any floor child that lacks its own loading.tsx.
export default function DcFloorLoading() {
  return (
    <div className="dc-page" aria-busy="true" aria-label="กำลังโหลด">
      <div className="dc-head">
        <div style={{ flex: 1 }}>
          <div className="dc-skel dc-skel--title" />
          <div className="dc-skel dc-skel--line" style={{ width: "55%", marginTop: 10 }} />
        </div>
      </div>
      <div className="dc-floor-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="dc-skel dc-skel--tile" />
        ))}
      </div>
    </div>
  );
}

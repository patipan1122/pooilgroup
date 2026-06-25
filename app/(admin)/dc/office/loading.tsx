// DC · back-office hub skeleton — mirrors the card grid.
// Covers /dc/office + every office child without its own loading.tsx.
export default function DcOfficeLoading() {
  return (
    <div className="dc-page dc-page--wide" aria-busy="true" aria-label="กำลังโหลด">
      <div className="dc-head">
        <div style={{ flex: 1 }}>
          <div className="dc-skel dc-skel--title" />
          <div className="dc-skel dc-skel--line" style={{ width: "45%", marginTop: 10 }} />
        </div>
      </div>
      <div className="dc-floor-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="dc-skel dc-skel--card" />
        ))}
      </div>
    </div>
  );
}

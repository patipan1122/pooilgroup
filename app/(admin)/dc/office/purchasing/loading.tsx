// DC · purchasing list skeleton — head + status-filter chips + a card of table rows.
export default function DcPurchasingLoading() {
  return (
    <div className="dc-page dc-page--wide" aria-busy="true" aria-label="กำลังโหลด">
      <div className="dc-head">
        <div style={{ flex: 1 }}>
          <div className="dc-skel dc-skel--title" />
          <div className="dc-skel dc-skel--line" style={{ width: "60%", marginTop: 10 }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="dc-skel" style={{ height: 32, width: 92, borderRadius: 999 }} />
        ))}
      </div>
      <div className="dc-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="dc-skel dc-skel--line" style={{ width: `${92 - i * 6}%` }} />
        ))}
      </div>
    </div>
  );
}

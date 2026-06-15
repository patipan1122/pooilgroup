// CashHub — feature flags.
//
// Read at call time (not module load) so a Vercel env flip takes effect on the
// next request without a rebuild. With a flag OFF the runtime is byte-equivalent
// to today (every new migration is additive).
//
//   CASHHUB_FUEL_V1 — ⛽ ปั๊มน้ำมัน (ปั๊ม 62 หัวทะเล · วายเอ็มพลัส) source:
//                     pull the gas-station daily sales + cash/bank reconciliation
//                     Google Sheet (.xlsx public link) → cashhub_fuel_daily →
//                     management page that catches the bookkeeper's entry errors.
//                     OFF = the card stays "เร็ว ๆ นี้" and the routes notFound().

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "on";
}

export function cashhubFuelV1(): boolean {
  return flagOn("CASHHUB_FUEL_V1");
}

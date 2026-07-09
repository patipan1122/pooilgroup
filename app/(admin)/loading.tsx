import { PageSkeleton } from "@/components/ui/skeleton";

// Group-root fallback skeleton for every CORE (admin) page that doesn't ship
// its own loading.tsx — home / programs / users / audit / companies / profile /
// settings / branches / bugs / clawhub / costctrl / docuflow / hotelbook /
// pinpoint / repairs. Prevents the blank-white flash while the RSC data fetch
// (layout Promise.all + page queries) is in flight.
//
// Module sub-trees (ledger / chairops / cashhub / fuelos / dc / recruit) each
// ship their own tailored loading.tsx which takes precedence over this one via
// route-group inheritance — so this only fills the core-hub gap.
export default function AdminLoading() {
  return <PageSkeleton />;
}

// Group-level fallback for ALL CashHub pages that don't ship their own
// loading.tsx (reports, leaderboard, my-branches, quick-fill, notes, settings,
// import, compare, …). Renders instantly on navigation so the body area shows
// a shape instead of a white screen during the data fetch. The .ch-scope
// wrapper + chrome come from cashhub/layout.tsx, which stays mounted here.
import { PageSkeleton } from "@/components/ui/skeleton";

export default function CashHubLoading() {
  return <PageSkeleton />;
}

// ChairOps Wave-1 kit · barrel export.
// All 8 ChairOps-specific primitives consumed by /chairops workspace pages.
// Pool primitives (Button · Card · Badge · Input · KpiTile · StatusPill · Section)
// must be imported directly from `@/components/ui/*` — do NOT re-export here.
//
// Spec: AUDIT_chairops_2026-05-25 §6 + /tmp/claude-design_chairops_plan.md §3.

export {
  ShortageDriftCell,
  type ShortageDriftCellProps,
  type EscalationTier,
} from "./shortage-drift-cell";

export {
  DiffBucketPills,
  type DiffBucketPillsProps,
  type DiffBucket,
  type DiffBucketCounts,
} from "./diff-bucket-pills";

export {
  PhotoProofPanel,
  type PhotoProofPanelProps,
  type PhotoProof,
} from "./photo-proof-panel";

export {
  MasterDetailShell,
  stickyTheadClass,
  type MasterDetailShellProps,
} from "./master-detail-shell";

export {
  ChairopsKpiTile,
  type ChairopsKpiTileProps,
  type KpiTone,
  type DeltaDirection,
} from "./kpi-tile";

export {
  MakerCheckerBadge,
  type MakerCheckerBadgeProps,
  type MakerCheckerActor,
} from "./maker-checker-badge";

export {
  LineNotifyToggle,
  type LineNotifyToggleProps,
} from "./line-notify-toggle";

export {
  ChairCodeChip,
  type ChairCodeChipProps,
  type ChairStatus,
} from "./chair-code-chip";

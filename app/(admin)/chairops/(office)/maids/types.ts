// Type-only module · separated from actions.ts because Next.js requires
// "use server" files to export ONLY async functions. Per
// [[feedback-use-server-only-async-2026-06-02]] consts/types live here.

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// BF1 MAID-04 — same numeric thresholds used on client (deposit form) and
// server (anti-fraud server action). Keeping the constants here means the
// LIFF deposit form can mirror them without pulling in actions.ts.
export const DEPOSIT_NOTES_GATE_BAHT = 100;
export const DEPOSIT_REVIEW_GATE_BAHT = 500;
export const DEPOSIT_NOTES_MIN_LEN = 10;

export type MaidRosterStatus =
  | "working" // active maid · assigned branch · no day-off today
  | "on_leave" // active maid · day-off marked for today
  | "no_slot" // active branch but no maid assigned
  | "disabled"; // user.isActive === false

export interface MaidRosterRow {
  userId: string;
  displayName: string;
  phone: string | null;
  branchId: string | null;
  branchName: string | null;
  status: MaidRosterStatus;
  todayDayOffReason: string | null;
  thisMonthPaid: number; // sum of MaidDailyPay for current month
  daysOffThisMonth: number;
  branchCount: number; // active branches this maid manages (multi-branch · 2026-07-08)
  // Contract readiness (F4b · CEO 2026-08-02) — surfaced as columns in ?view=maid.
  hasBankAccount: boolean; // salary bank account number is on file
  hasContract: boolean; // an online contract exists (DRAFT/SIGNED) or a legacy file is attached
  contractSigned: boolean; // an online contract has been e-signed by the maid
}

// ── Branch-first roster (CEO 2026-07-12) — "ดูตามสาขา" ────────────────────
// Full today-status per maid so the office can see, per branch, WHO is there
// and WHAT they have done today (collected / deposited / cleaned).
export interface MaidTodayActivity {
  onLeave: boolean;
  leaveReason: string | null;
  collectedCount: number; // # cash-collection rounds today (deletedAt null)
  collectedLastAt: string | null; // ISO ts of latest collection today
  deposited: boolean; // any bank deposit today
  cleaned: boolean; // any cleanliness report filed today
}

export interface MaidInBranch extends MaidTodayActivity {
  userId: string;
  displayName: string;
  phone: string | null;
  isPrimary: boolean; // this branch is the maid's home (primaryBranchId)
  otherBranchCount: number; // # OTHER active branches this maid also covers
}

export interface BranchRosterGroup {
  branchId: string;
  branchName: string;
  tabName: string;
  maids: MaidInBranch[]; // empty ⇒ render "ไม่มีแม่บ้าน"
}

export interface BranchRosterView {
  branches: BranchRosterGroup[];
  // active maids with NO branch assignment at all (so nothing is hidden)
  unassignedMaids: { userId: string; displayName: string; phone: string | null }[];
  branchesWithoutMaid: number;
  onLeaveToday: number;
}

// Maid activity table (CEO 2026-08-23) — replaces the branch-card grid on
// ?view=branch with one row PER BRANCH (not per maid×branch — a branch
// covered by several maids, or a maid covering several branches, used to
// print the branch name once per maid and looked like duplicate rows; CEO
// caught this 2026-08-23). Clicking the branch name opens a popup listing
// every maid who covers it, with her stats and the resign action.
export interface MaidStatsForBranch {
  userId: string;
  displayName: string;
  isPrimary: boolean; // this branch is her primaryBranchId — tags non-primary entries "(สาขาเสริม)"
  hasBankAccount: boolean;
  daysWorking: number | null; // days since first-ever deposit anywhere (= start-of-work proxy) · null = never deposited
  lastCollectedAt: string | null; // ISO, latest collection AT THIS BRANCH · null = never here
  avgDepositGapDays: number | null; // avg days between deposits AT THIS BRANCH, last 180d · null = <2 in window
  typicalTimes: string[]; // up to 2 "HH:MM" — her most common collect/deposit time clusters overall, last 180d
}

export interface BranchWithMaidsRow {
  kind: "branch_with_maids";
  branchId: string;
  branchName: string;
  maids: MaidStatsForBranch[]; // sorted primary-first-then-name, length >= 1
}

export interface NoMaidRow {
  kind: "no_maid";
  branchId: string;
  branchName: string;
}

// CEO 2026-08-23: branches marked closed via the new "ปิดสาขา" action sink to
// the bottom instead of alarmingly showing as "ไม่มีแม่บ้าน — ต้องหาคน".
export interface ClosedBranchRow {
  kind: "closed_branch";
  branchId: string;
  branchName: string;
}

// CEO 2026-08-23: maids deactivated (isActive: false, via the existing
// chairops/users deactivate flow) sink to the bottom instead of just
// vanishing — so the office sees WHY a branch suddenly shows no coverage.
export interface ResignedMaidRow {
  kind: "resigned_maid";
  userId: string;
  displayName: string;
  lastBranchName: string | null; // her primary branch at the time, for context
}

export type MaidActivityTableRow = BranchWithMaidsRow | NoMaidRow | ClosedBranchRow | ResignedMaidRow;

export interface MissedMaidVariantRow {
  branchId: string;
  branchName: string;
  // ALWAYS one of working / on_leave / no_slot / missed_actual
  // (missed_actual = working maid who hasn't deposited yet)
  variant: "missed_actual" | "on_leave" | "no_slot";
  maidName: string | null;
  maidPhone: string | null;
  maidLineUserId: string | null;
  dayOffReason: string | null;
  posToday: number;
  status: "ok" | "warn" | "critical" | "missed";
}

export interface LeaveHistoryRow {
  id: string;
  date: string; // ISO YYYY-MM-DD
  reason: string | null;
  createdByName: string;
  createdAt: string; // ISO timestamp
}

export interface PayHistoryRow {
  id: string;
  date: string; // ISO YYYY-MM-DD
  amount: number;
  note: string | null;
  paidByName: string;
  paidAt: string; // ISO timestamp
}

export interface AssignmentHistoryRow {
  id: string;
  branchId: string;
  branchName: string;
  startedAt: string; // ISO
  endedAt: string | null;
  isActive: boolean;
}

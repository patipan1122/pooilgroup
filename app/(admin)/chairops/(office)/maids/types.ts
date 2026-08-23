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
// ?view=branch with one row per maid, showing deposit-behavior stats derived
// from real collection/deposit history (no manual data entry required).
export interface MaidActivityRow {
  kind: "maid";
  userId: string;
  displayName: string;
  branchId: string;
  branchName: string;
  branchExtraCount: number; // # OTHER active branches this maid also covers
  hasBankAccount: boolean;
  daysWorking: number | null; // days since first-ever deposit (= start-of-work proxy) · null = never deposited
  lastCollectedAt: string | null; // ISO, latest collection ever (any day)
  avgDepositGapDays: number | null; // avg days between deposits, last 180d · null = <2 deposits in window
  typicalTimes: string[]; // up to 2 "HH:MM" — most common collect/deposit time clusters, last 180d
}

export interface NoMaidRow {
  kind: "no_maid";
  branchId: string;
  branchName: string;
}

export type MaidActivityTableRow = MaidActivityRow | NoMaidRow;

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

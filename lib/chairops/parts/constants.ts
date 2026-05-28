// Shared ChairOps parts constants (no "use server" — plain module so non-async
// values can be exported and imported from both server actions and office UI).
//
// Extracted from `actions.ts` because Next.js forbids non-async exports in a
// "use server" file (build error: "Only async functions are allowed to be
// exported in a 'use server' file").

/** Marker prefix stored in ChairopsSparePartMovement.reason for maid requests. */
export const MAID_PART_REQUEST_PREFIX = "maid-request:PENDING";

// Single source of truth for "what is this expense's TRCloud state?".
//
// trcloudDocId is an overloaded column: it holds a real TRCloud doc id when sent,
// but also two STRING SENTINELS used purely as locks:
//   • "pending" — an in-flight push has atomically claimed the row (anti-double-push)
//   • "error"   — the last push FAILED; kept non-null on purpose so a concurrent push
//                 can't re-claim it (see recordPushResult). doc_no stays null.
//
// BUG CLASS (2026-06-15): every "is it sent?" check used `!!trcloudDocId` or
// `!= null`, so the "error" sentinel read as SENT — failed bills showed the blue
// "ส่ง TRCloud แล้ว" chip, were counted in the ส่งแล้ว tab, hidden from ยังไม่ส่ง,
// ranked as done, and locked the detail pane (no retry). This classifier exists so
// display + filters + rank + retry can never drift again: ask the state, don't poke
// the raw string. Same family as the 2026-06-07 false-sent fix (HTTP 200 ≠ success).
export type TrcloudState = "none" | "pending" | "error" | "sent";

/** Classify a raw trcloudDocId into its real state. */
export function trcloudState(docId: string | null | undefined): TrcloudState {
  if (docId == null || docId === "") return "none";
  if (docId === "pending") return "pending";
  if (docId === "error") return "error";
  return "sent";
}

/** True ONLY when the expense really reached TRCloud (real doc id, not a sentinel). */
export function isTrcloudSent(docId: string | null | undefined): boolean {
  return trcloudState(docId) === "sent";
}

/** True when the expense can be (re-)sent: never pushed, or a prior push failed.
 *  An "error" row created no TRCloud doc (doc_no is null) and the push dedups by
 *  reference, so re-sending can't create a duplicate AP/PO. */
export function isTrcloudSendable(docId: string | null | undefined): boolean {
  const s = trcloudState(docId);
  return s === "none" || s === "error";
}

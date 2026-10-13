// Signer role labels — SINGLE SOURCE for the "owner/employee/counterparty/
// other" signer-role taxonomy used across DocuFlow's e-signature flow.
// ────────────────────────────────────────────────────────────────────
// Previously this value/label/emoji list only existed inline inside
// signature-placement-editor.tsx (the admin editor). Extracted 2026-10-13
// so app/sign/[placementId]/page.tsx can reuse the EXACT same role→label
// mapping when redacting other signers' real names for an external signer
// viewer (see [[feedback-one-rule-two-copies-drifts-2026-09-23]] — a
// copy-pasted lookup table drifts; one exported source both sides import).
// signature-placement-editor.tsx re-exports `SignerRole` + keeps its local
// `ROLE_OPTIONS` name bound to `SIGNER_ROLE_OPTIONS` from here so its own
// render code is untouched.
// ────────────────────────────────────────────────────────────────────

export type SignerRole = "owner" | "employee" | "counterparty" | "other";

export const SIGNER_ROLE_OPTIONS: {
  value: SignerRole;
  label: string;
  emoji: string;
}[] = [
  { value: "owner", label: "เจ้าของ", emoji: "👑" },
  { value: "employee", label: "พนักงาน", emoji: "👤" },
  { value: "counterparty", label: "คู่ค้า", emoji: "🤝" },
  { value: "other", label: "อื่น ๆ", emoji: "✍️" },
];

/** Plain label only ("เจ้าของ") — matches the admin editor's existing
 *  `roleLabel()` helper. Accepts a loose string since `signerRole` is
 *  stored as a plain text column, not a DB enum. */
export function signerRoleLabel(role: string): string {
  return SIGNER_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

/** Emoji + label ("👑 เจ้าของ") — used as the role-only placeholder shown
 *  to an external/invited signer in place of another signer's real name
 *  (privacy fix, 2026-10-13). Falls back to a generic "ผู้เซ็นอื่น" for an
 *  unrecognized role string rather than leaking the raw value. */
export function signerRoleEmojiLabel(role: string): string {
  const opt = SIGNER_ROLE_OPTIONS.find((r) => r.value === role);
  return opt ? `${opt.emoji} ${opt.label}` : "ผู้เซ็นอื่น";
}

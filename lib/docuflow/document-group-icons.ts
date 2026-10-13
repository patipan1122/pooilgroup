// FOLDER ICON PICKER — pure, client-safe constants (CEO Pinpoint item #13,
// 2026-10-13).
// ────────────────────────────────────────────────────────────────────
// Deliberately NOT in lib/docuflow/document-groups.ts, which imports the
// Prisma client (@/lib/prisma → `pg`, a Node-only driver using `fs`/`net`/
// `tls`/`dns`). A "use client" component importing ANYTHING from a module
// pulls that module's entire static import graph into the browser bundle
// (webpack resolves imports at the whole-file level before any
// tree-shaking) — confirmed live during this batch's scoped build:
// `document-group-drilldown.tsx` importing the icon constants from
// document-groups.ts made `next build --webpack` fail with
// "Module not found: Can't resolve 'fs'/'net'/'tls'/'dns'" via the
// pg → prisma import chain.
//
// Client components (document-group-drilldown.tsx, folder-icon-picker.tsx,
// quick-create-document-group-dialog.tsx) must import these from HERE.
// document-groups.ts (server-only data layer) also imports from here for
// its own validation — this file is the single source of truth either
// side can safely reach.
// ────────────────────────────────────────────────────────────────────

export const DOCUMENT_GROUP_ICONS = ["folder", "star", "lock"] as const;
export type DocumentGroupIconKey = (typeof DOCUMENT_GROUP_ICONS)[number];

/** Unknown/invalid/omitted → null ("use the default folder icon"), never
 *  an error — the icon is a cosmetic choice, not something worth failing a
 *  folder-creation request over. */
export function normalizeDocumentGroupIcon(
  icon: string | null | undefined,
): DocumentGroupIconKey | null {
  if (icon && (DOCUMENT_GROUP_ICONS as readonly string[]).includes(icon)) {
    return icon as DocumentGroupIconKey;
  }
  return null;
}

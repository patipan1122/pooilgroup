"use client";

// DocumentGroupRefreshContext — cross-sibling "a folder was created
// elsewhere, please refresh" signal (verification follow-up, 2026-10-14).
//
// On /docuflow/documents (ตามบริษัท view), the top-level "สร้างกลุ่มเอกสาร"
// button (quick-create-document-group-button.tsx) and the open
// DocumentGroupDrillDown tree view (mounted per-company in tree-browser.tsx)
// are SIBLINGS, not parent/child — the button creates the folder correctly
// via the same company-scoped server action the tree's own inline
// "create folder here" uses (confirmed right in the DB), but
// DocumentGroupDrillDown's fetch effect only reruns when its `companyId`
// prop changes, so an already-open tree never saw the new folder without a
// manual page reload. That reads EXACTLY like the original CEO complaint
// this whole project started from ("สร้างโฟลเดอร์แล้วมันหายไป") even though
// the cause here is display staleness, not an orphan-creation bug — worth
// closing before it gets reported as a repeat of the old bug.
//
// Fix: a tiny counter lifted to the nearest common ancestor (the page
// itself, via <DocumentGroupRefreshProvider> wrapping its whole return).
// The button bumps it after a successful create; DocumentGroupDrillDown
// watches it and reloads its CURRENT folder in place — the same "reload
// after create" DocumentGroupDrillDown already does for its own inline
// create (handleCreate → load(parentId)), just reachable from a sibling.
//
// No provider mounted above a given DocumentGroupDrillDown (e.g. inside
// DocumentGroupPicker's Dialog, which already refreshes itself directly by
// calling its own load() — Pinpoint verification confirmed that path works)
// → context falls back to a stable refreshKey of 0 / no-op bump, so that
// usage is completely unaffected by this change.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface DocumentGroupRefreshValue {
  /** Bumps whenever a folder is created from OUTSIDE the tree view itself
   *  (today: the top-level quick-create button). */
  refreshKey: number;
  /** Call after successfully creating a folder from outside the tree view. */
  bump: () => void;
}

const DEFAULT_VALUE: DocumentGroupRefreshValue = {
  refreshKey: 0,
  bump: () => {},
};

const DocumentGroupRefreshContext =
  createContext<DocumentGroupRefreshValue>(DEFAULT_VALUE);

export function useDocumentGroupRefresh(): DocumentGroupRefreshValue {
  return useContext(DocumentGroupRefreshContext);
}

export function DocumentGroupRefreshProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const value = useMemo(() => ({ refreshKey, bump }), [refreshKey, bump]);
  return (
    <DocumentGroupRefreshContext.Provider value={value}>
      {children}
    </DocumentGroupRefreshContext.Provider>
  );
}

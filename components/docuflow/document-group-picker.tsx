"use client";

// DocumentGroupPicker — compact "pick a document group" control for the
// upload form (CEO Pinpoint item #4, 2026-10-13). Replaces the old flat
// `<select id="documentGroupId">` (which showed every nested folder as a
// bare name with zero path context — two companies' same-named folders
// were indistinguishable, per the UX persona's finding).
//
// Per the UX persona's explicit recommendation: mounts the EXISTING
// DocumentGroupDrillDown itself in "picker" mode behind a trigger button
// (Dialog = the project's already-proven "compact/popover" container —
// same primitive MoveDocumentButton/QuickCreateDocGroupDialog already use,
// so this doesn't invent a 4th picker pattern or a new floating-popover
// mechanism). Reuses the existing GET /api/docuflow/document-groups/tree
// API as-is — no new data-fetching path.
//
// A folder's companyId is required (nested folders are always scoped to
// one company), so this also doubles as the fix for upload-form's own
// "+ สร้างใหม่" orphan-group bug (CEO Pinpoint item #1, second instance) —
// creation now only ever happens through DocumentGroupDrillDown's own
// company-scoped "create folder here", never the legacy flat path.
// ────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { FolderTree, ChevronDown, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { DocumentGroupDrillDown } from "./document-group-drilldown";

export interface DocumentGroupSelection {
  id: string;
  /** Full breadcrumb label ("บริษัท X / ก่อสร้าง / ผู้รับเหมา") — the UX
   *  persona's fix for "two same-named folders in different companies are
   *  indistinguishable" (the old flat select showed only the bare name). */
  label: string;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface Props {
  companies: CompanyOption[];
  defaultCompanyId?: string;
  value: DocumentGroupSelection | null;
  onChange: (value: DocumentGroupSelection | null) => void;
  disabled?: boolean;
}

export function DocumentGroupPicker({
  companies,
  defaultCompanyId,
  value,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeCompanyId, setActiveCompanyId] = useState(
    defaultCompanyId || companies[0]?.id || "",
  );
  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">
        ยังไม่มีบริษัทในระบบ
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveCompanyId(defaultCompanyId || companies[0]?.id || "");
            setOpen(true);
          }}
          disabled={disabled}
          className="flex-1 min-w-0 flex items-center gap-2 rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm bg-white hover:border-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FolderTree className="size-4 text-zinc-400 shrink-0" />
          <span className={value ? "truncate text-zinc-800" : "truncate text-zinc-400"}>
            {value ? value.label : "— ไม่ระบุ —"}
          </span>
          <ChevronDown className="size-4 text-zinc-400 shrink-0 ml-auto" />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="ล้างกลุ่มเอกสาร"
            className="shrink-0 p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="เลือกกลุ่มเอกสาร">
        <div className="space-y-3">
          {companies.length > 1 && (
            <div className="space-y-1">
              <label htmlFor="docgroup-picker-company" className="text-xs font-medium text-zinc-600">
                บริษัท
              </label>
              <select
                id="docgroup-picker-company"
                value={activeCompanyId}
                onChange={(e) => setActiveCompanyId(e.target.value)}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeCompanyId && activeCompany && (
            <DocumentGroupDrillDown
              key={activeCompanyId}
              companyId={activeCompanyId}
              companyName={activeCompany.name}
              canManage
              mode="picker"
              showSearch
              selectedGroupId={value?.id ?? null}
              onPick={(picked) => {
                const label = [activeCompany.name, ...picked.path, picked.name]
                  .filter(Boolean)
                  .join(" / ");
                onChange({ id: picked.id, label });
                setOpen(false);
              }}
            />
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:underline"
            >
              ไม่ระบุกลุ่มเอกสาร
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

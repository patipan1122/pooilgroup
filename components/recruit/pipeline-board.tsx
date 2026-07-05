"use client";

import { useState, useCallback } from "react";
import { PipelineColumn } from "@/components/recruit/pipeline-column";
import { BulkActionBar } from "@/components/recruit/bulk-action-bar";
import { type ApplicationStatus } from "@/lib/recruit/types";

interface AppCard {
  id: string;
  applicantName: string;
  phone: string;
  posting: string;
  aiScore: number | null;
  starRating: number | null;
  flagged: boolean;
  refId: string;
  tags?: string[];
  updatedAt?: string | null;
}

interface Props {
  /** Ordered statuses to render as columns */
  showStatuses: ApplicationStatus[];
  /** Cards already grouped + serialized per status (from the server page) */
  grouped: Record<ApplicationStatus, AppCard[]>;
  canWrite: boolean;
  /** Base href params so a card click still opens the slide-in detail */
  selectHrefBase: { posting?: string; company?: string };
}

/**
 * Client wrapper that owns the cross-column multi-select state (Wave 3).
 * The columns are otherwise independent islands, so selection MUST live at the
 * level that renders ALL of them — here. Renders the sticky BulkActionBar when
 * ≥1 card is selected.
 */
export function PipelineBoard({ showStatuses, grouped, canWrite, selectHrefBase }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  function buildSelectHref(id: string) {
    const sp = new URLSearchParams();
    if (selectHrefBase.posting) sp.set("posting", selectHrefBase.posting);
    if (selectHrefBase.company) sp.set("company", selectHrefBase.company);
    sp.set("selected", id);
    return `/recruit/pipeline?${sp.toString()}`;
  }

  return (
    <>
      <div className="flex gap-3 min-w-max snap-x snap-mandatory lg:min-w-0 lg:snap-none lg:grid lg:grid-cols-3 xl:grid-cols-6">
        {showStatuses.map((s) => (
          <PipelineColumn
            key={s}
            status={s}
            applications={grouped[s]}
            canWrite={canWrite}
            selectHref={buildSelectHref}
            selectedIds={canWrite ? selectedIds : undefined}
            onToggleSelect={canWrite ? toggleSelect : undefined}
          />
        ))}
      </div>

      {canWrite && (
        <BulkActionBar selectedIds={Array.from(selectedIds)} onClear={clearSelection} />
      )}
    </>
  );
}

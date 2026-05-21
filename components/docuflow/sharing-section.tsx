// SharingSection — server component shown on document detail page.
// ────────────────────────────────────────────────────────────────────
// Capability E · Cross-branch Document Sharing UI
//   - Lists current shared branches grouped by ประเภทธุรกิจ
//   - Admin tier sees inline remove (×) on each chip + "+ เพิ่มสาขา"
//   - Empty state nudges admin to start sharing
// ────────────────────────────────────────────────────────────────────

import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  RemoveShareButton,
  SharingAddButton,
} from "./sharing-modal";
import type { BranchOption } from "@/components/users/branch-picker";

export interface SharedBranchItem {
  id: string;
  code: string;
  name: string;
  businessType: string;
}

interface Props {
  documentId: string;
  /** Branches currently sharing this document. */
  sharedBranches: SharedBranchItem[];
  /** Full org branch list — handed to the picker for "+ เพิ่มสาขา". */
  allBranches: BranchOption[];
  /** Section number in the page layout (e.g. "05"). */
  number?: string;
  /** Whether the viewer can mutate (POST/DELETE). */
  canEdit: boolean;
}

export function SharingSection({
  documentId,
  sharedBranches,
  allBranches,
  number = "05",
  canEdit,
}: Props) {
  // Group by business type — sort groups by branch count (desc)
  const groups = new Map<string, SharedBranchItem[]>();
  for (const b of sharedBranches) {
    const key = b.businessType ?? "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  const sortedGroups = Array.from(groups.entries())
    .map(([type, list]) => {
      list.sort((a, b) => a.code.localeCompare(b.code));
      return [type, list] as const;
    })
    .sort((a, b) => b[1].length - a[1].length);

  const total = sharedBranches.length;
  const alreadySharedIds = sharedBranches.map((b) => b.id);

  return (
    <Section
      number={number}
      label="SHARING"
      title={
        total > 0
          ? `ใช้กับ ${total} สาขา`
          : "แชร์ข้ามสาขา"
      }
      description={
        total > 0
          ? "เอกสารนี้ใช้ร่วมกันในสาขาต่อไปนี้"
          : "ยังไม่ได้กำหนดสาขาที่ใช้เอกสารนี้"
      }
      action={
        canEdit ? (
          <SharingAddButton
            documentId={documentId}
            allBranches={allBranches}
            alreadySharedIds={alreadySharedIds}
          />
        ) : undefined
      }
      className="animate-fade-up delay-300"
    >
      <Card>
        <CardBody>
          {total === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/40 p-6 text-center text-sm text-zinc-500">
              {canEdit
                ? 'กด "+ เพิ่มสาขา" เพื่อกำหนดสาขาที่ใช้เอกสารนี้'
                : "ยังไม่มีสาขาที่ใช้เอกสารนี้"}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedGroups.map(([type, list]) => {
                const cfg = BUSINESS_TYPES[type];
                return (
                  <div key={type} className="space-y-1.5">
                    <p className="text-xs font-bold text-zinc-500">
                      <span className="mr-1">{cfg?.emoji ?? "📋"}</span>
                      {cfg?.label ?? type}
                      <span className="ml-1.5 tabular-nums text-zinc-400 font-normal">
                        ({list.length})
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((b) => (
                        <Badge
                          key={b.id}
                          tone="brand"
                          className="pr-1"
                        >
                          <span className="font-extrabold tabular-nums">
                            {b.code}
                          </span>
                          <span className="text-zinc-300 mx-0.5">·</span>
                          <span className="truncate max-w-[160px]">
                            {b.name}
                          </span>
                          {canEdit && (
                            <RemoveShareButton
                              documentId={documentId}
                              branchId={b.id}
                              branchLabel={`${b.code} · ${b.name}`}
                            />
                          )}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}

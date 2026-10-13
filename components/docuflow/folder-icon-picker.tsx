"use client";

// FolderIconPicker — CEO Pinpoint item #13 (2026-10-13): 3 icon choices for
// a folder, "for visual priority/sorting". Reuses the Lucide icon set
// already used everywhere else in DocuFlow (DfDocIcon/.df-docico) — not a
// new icon library, just a small fixed pick list from it.
//
// Kept as ONE shared file imported by both folder-creation UIs (the
// in-drilldown "create folder here" form AND the top-level quick-create
// dialog) so the icon → component mapping can't drift into two
// independently-maintained copies (postmortem class:
// feedback-one-rule-two-copies-drifts-2026-09-23).
// ────────────────────────────────────────────────────────────────────

import { Folder, Star, Lock, type LucideIcon } from "lucide-react";
import {
  DOCUMENT_GROUP_ICONS,
  type DocumentGroupIconKey,
} from "@/lib/docuflow/document-group-icons";

export const FOLDER_ICON_COMPONENTS: Record<DocumentGroupIconKey, LucideIcon> = {
  folder: Folder,
  star: Star,
  lock: Lock,
};

const FOLDER_ICON_LABELS: Record<DocumentGroupIconKey, string> = {
  folder: "ปกติ",
  star: "สำคัญ",
  lock: "จำกัดการเข้าถึง",
};

/** Renders the chosen icon (or the default Folder glyph for null/unknown
 *  values) — used anywhere a folder's icon needs to be displayed, e.g. the
 *  drilldown's node list. */
export function FolderIconGlyph({
  icon,
  size = 18,
  style,
}: {
  icon: string | null | undefined;
  size?: number;
  style?: React.CSSProperties;
}) {
  const key: DocumentGroupIconKey =
    icon && (DOCUMENT_GROUP_ICONS as readonly string[]).includes(icon)
      ? (icon as DocumentGroupIconKey)
      : "folder";
  const Icon = FOLDER_ICON_COMPONENTS[key];
  return <Icon size={size} style={style} />;
}

/** The 3-choice picker row, mounted inside a folder-creation form. */
export function FolderIconPicker({
  value,
  onChange,
  disabled,
}: {
  value: DocumentGroupIconKey;
  onChange: (icon: DocumentGroupIconKey) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {DOCUMENT_GROUP_ICONS.map((key) => {
        const Icon = FOLDER_ICON_COMPONENTS[key];
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            disabled={disabled}
            title={FOLDER_ICON_LABELS[key]}
            aria-label={`ไอคอน: ${FOLDER_ICON_LABELS[key]}`}
            aria-pressed={selected}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: 10,
              border: selected
                ? "2px solid var(--df-brand)"
                : "1px solid var(--df-line)",
              background: selected ? "var(--df-brand-soft)" : "var(--df-surface)",
              color: selected ? "var(--df-brand)" : "var(--df-muted)",
              cursor: disabled ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

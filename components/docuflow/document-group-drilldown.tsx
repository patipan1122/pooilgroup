"use client";

// DocumentGroupDrillDown — unlimited-depth folder browser (CEO feedback
// 2026-10-11): "สร้างลึกลงลึกลงไปได้เรื่อยๆ...เหมือน folder ซ้อน folder
// แต่ดูเป็นแนวตั้ง" — a vertical drill-down (one level's folders shown as
// a list, tap to go deeper, breadcrumb + back to go up), NOT a
// side-indented sidebar tree. Mounted per-company in TreeBrowser, replacing
// the old derived "ประเภทธุรกิจ" bucket list for that company.
//
// Reads via GET /api/docuflow/document-groups/tree (one screen per
// request); writes via the admin-gated server actions in
// lib/docuflow/document-group-tree-actions.ts. Documents are placed into
// these folders with the existing MoveDocumentButton (Phase 2,
// 2026-10-11) from a document's own detail/list-row — this component only
// manages the folder structure itself.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FolderPlus,
  ChevronRight,
  Loader2,
  Trash2,
  Check,
  Search,
  X,
  FileText,
} from "lucide-react";
import {
  createDocumentGroupFolder,
  deleteDocumentGroupFolder,
} from "@/lib/docuflow/document-group-tree-actions";
import { DOCUMENT_GROUP_ICONS, type DocumentGroupIconKey } from "@/lib/docuflow/document-group-icons";
import { FolderIconGlyph, FolderIconPicker } from "./folder-icon-picker";

interface Node {
  id: string;
  name: string;
  description: string | null;
  companyId: string | null;
  parentGroupId: string | null;
  icon: string | null;
  childCount: number;
  documentCount: number;
}

interface Breadcrumb {
  id: string;
  name: string;
}

interface DocLite {
  id: string;
  name: string;
}

/** What a "pick this folder" callback hands back — enough for the caller
 *  to build a full breadcrumb label without a second fetch. */
export interface PickedFolder {
  id: string;
  name: string;
  /** Names of every ancestor folder, root first (company itself not
   *  included — the caller already knows which company this is). */
  path: string[];
}

interface Props {
  companyId: string;
  companyName: string;
  /** Whether the current user can create/delete folders here. */
  canManage: boolean;
  /** "manage" (default) = today's TreeBrowser behavior, unchanged.
   *  "picker" = CEO Pinpoint item #4 (2026-10-13): mounted inside a compact
   *  folder picker (upload form) — hides delete actions, adds a per-row +
   *  per-current-folder "select" affordance via onPick instead. */
  mode?: "manage" | "picker";
  /** Currently-selected folder id (picker mode) — highlights the matching
   *  row/breadcrumb action so the admin can see what's already chosen. */
  selectedGroupId?: string | null;
  /** Fires when the admin picks a folder (picker mode only). */
  onPick?: (picked: PickedFolder) => void;
  /** Adds a search box that filters the CURRENTLY LOADED level's folders
   *  + documents by substring — client-side only, no new fetch (the tree
   *  API stays a one-level-per-request read, per the SA persona's note
   *  that it has no cross-tree search param). Off by default so
   *  TreeBrowser's existing per-company mount is visually unchanged. */
  showSearch?: boolean;
}

export function DocumentGroupDrillDown({
  companyId,
  companyName,
  canManage,
  mode = "manage",
  selectedGroupId = null,
  onPick,
  showSearch = false,
}: Props) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [children, setChildren] = useState<Node[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([]);
  // CEO Pinpoint item #12a (2026-10-13) — how many documents sit DIRECTLY
  // in the folder currently being viewed (not inside its sub-folders).
  // Drives the empty-state copy below: "no sub-folders" is misleading
  // when the folder actually holds documents.
  const [currentDocumentCount, setCurrentDocumentCount] = useState(0);
  // CEO Pinpoint item #12b (2026-10-13) — the actual documents (not just
  // the count above), so they can be listed/linked, not just counted.
  const [currentDocuments, setCurrentDocuments] = useState<DocLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState<DocumentGroupIconKey>(DOCUMENT_GROUP_ICONS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  async function load(nextParentId: string | null) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ companyId });
      if (nextParentId) qs.set("parentGroupId", nextParentId);
      const res = await fetch(`/api/docuflow/document-groups/tree?${qs}`);
      if (!res.ok) throw new Error("โหลดโฟลเดอร์ไม่สำเร็จ");
      const data = await res.json();
      setChildren(data.children ?? []);
      setBreadcrumb(data.breadcrumb ?? []);
      setCurrentDocumentCount(data.currentDocumentCount ?? 0);
      setCurrentDocuments(data.currentDocuments ?? []);
      setParentId(nextParentId);
      setSearch("");
    } catch {
      toast.error("โหลดโฟลเดอร์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch on mount (and if companyId ever changes) — an inline
  // async IIFE with a cancelled-guard, same pattern as
  // risk-analysis-panel.tsx, rather than calling the shared `load`
  // function reference directly (which the react-compiler lint rule
  // flags as an indirect setState-in-effect). Navigation afterwards goes
  // through load() directly from click handlers, not this effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ companyId });
        const res = await fetch(`/api/docuflow/document-groups/tree?${qs}`);
        if (!res.ok) throw new Error("โหลดโฟลเดอร์ไม่สำเร็จ");
        const data = await res.json();
        if (cancelled) return;
        setChildren(data.children ?? []);
        setBreadcrumb(data.breadcrumb ?? []);
        setCurrentDocumentCount(data.currentDocumentCount ?? 0);
        setCurrentDocuments(data.currentDocuments ?? []);
        setParentId(null);
      } catch {
        if (!cancelled) toast.error("โหลดโฟลเดอร์ไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("กรุณาใส่ชื่อโฟลเดอร์");
      return;
    }
    setCreating(true);
    try {
      const res = await createDocumentGroupFolder({
        companyId,
        parentGroupId: parentId,
        name,
        icon: newIcon,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`สร้างโฟลเดอร์ "${res.group.name}" แล้ว`);
      setNewName("");
      setNewIcon(DOCUMENT_GROUP_ICONS[0]);
      setShowCreate(false);
      await load(parentId);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(node: Node, e: React.MouseEvent) {
    e.stopPropagation();
    if (node.childCount > 0) {
      toast.error("ต้องลบ/ย้ายโฟลเดอร์ย่อยข้างในออกก่อน");
      return;
    }
    if (node.documentCount > 0) {
      toast.error("ต้องย้าย/ลบเอกสารในโฟลเดอร์นี้ออกก่อน");
      return;
    }
    if (!confirm(`ลบโฟลเดอร์ "${node.name}" ใช่ไหม?`)) return;
    const res = await deleteDocumentGroupFolder(node.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("ลบโฟลเดอร์แล้ว");
    await load(parentId);
  }

  const filteredChildren = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return children;
    return children.filter((c) => c.name.toLowerCase().includes(q));
  }, [children, search]);

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currentDocuments;
    return currentDocuments.filter((d) => d.name.toLowerCase().includes(q));
  }, [currentDocuments, search]);

  const currentFolderName =
    breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].name : null;
  const isCurrentFolderSelected =
    parentId !== null && selectedGroupId === parentId;

  return (
    <div>
      {showSearch && (
        <div style={{ position: "relative", marginBottom: 10 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--df-muted-2)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาโฟลเดอร์/เอกสารในนี้..."
            style={{
              width: "100%",
              height: 38,
              borderRadius: 10,
              border: "1px solid var(--df-line)",
              padding: "0 32px 0 32px",
              fontSize: 13,
              background: "var(--df-surface)",
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="ล้างคำค้นหา"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--df-muted-2)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 4,
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <button
          type="button"
          onClick={() => load(null)}
          disabled={loading}
          style={{
            color: parentId === null ? "var(--df-ink)" : "var(--df-brand)",
            fontWeight: parentId === null ? 700 : 600,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {companyName}
        </button>
        {breadcrumb.map((b, i) => (
          <span key={b.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronRight size={13} style={{ color: "var(--df-muted-2)" }} />
            <button
              type="button"
              onClick={() => load(b.id)}
              disabled={loading}
              style={{
                color:
                  i === breadcrumb.length - 1
                    ? "var(--df-ink)"
                    : "var(--df-brand)",
                fontWeight: i === breadcrumb.length - 1 ? 700 : 600,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {b.name}
            </button>
          </span>
        ))}
        {mode === "picker" && onPick && currentFolderName && (
          <button
            type="button"
            onClick={() =>
              onPick({
                id: parentId as string,
                name: currentFolderName,
                path: breadcrumb.slice(0, -1).map((b) => b.name),
              })
            }
            disabled={loading}
            style={{
              marginLeft: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 999,
              border: "none",
              background: isCurrentFolderSelected
                ? "var(--df-brand)"
                : "var(--df-brand-soft)",
              color: isCurrentFolderSelected ? "#fff" : "var(--df-brand)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Check size={12} />
            {isCurrentFolderSelected ? "เลือกโฟลเดอร์นี้แล้ว" : "เลือกโฟลเดอร์นี้"}
          </button>
        )}
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--df-muted)" }} />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {children.length === 0 && canManage && mode === "manage" && !showCreate ? (
            // CEO Pinpoint item #2 (2026-10-13) — the "create folder here"
            // action already existed (see the dashed pill below) but read
            // as a minor, easy-to-miss afterthought when a company/folder
            // has zero folders yet. A first-time admin landing here should
            // see an obvious "create the first one" prompt, not a quiet
            // empty-state sentence + a small outlined button elsewhere.
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "28px 16px",
                borderRadius: 12,
                border: "1px dashed var(--df-line)",
                background: "var(--df-bg-warm)",
                textAlign: "center",
              }}
            >
              <FolderPlus size={28} style={{ color: "var(--df-brand)" }} />
              <p style={{ fontSize: 13, color: "var(--df-ink-2)", margin: 0 }}>
                {breadcrumb.length > 0
                  ? "ยังไม่มีโฟลเดอร์ย่อยในนี้"
                  : "ยังไม่มีโฟลเดอร์ในบริษัทนี้"}
              </p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 16px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--df-brand)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <FolderPlus size={15} />
                {breadcrumb.length > 0 ? "สร้างโฟลเดอร์ย่อยแรก" : "สร้างโฟลเดอร์แรก"}
              </button>
            </div>
          ) : (
            children.length === 0 &&
            !showCreate && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--df-muted)",
                  padding: "16px 4px",
                  textAlign: "center",
                }}
              >
                {/* CEO Pinpoint item #12a (2026-10-13): previously always said
                    "ยังไม่มีโฟลเดอร์ในนี้" (no sub-folder here) even when the
                    folder has documents placed directly in it — reads as
                    "this folder is empty," which is wrong. */}
                {search
                  ? "ไม่พบโฟลเดอร์ที่ค้นหา"
                  : currentDocumentCount > 0
                    ? `ไม่มีโฟลเดอร์ย่อย — มีเอกสาร ${currentDocumentCount} รายการ`
                    : "ยังไม่มีโฟลเดอร์ในนี้"}
              </p>
            )
          )}
          {filteredChildren.map((node) => {
            const nodeSelected = mode === "picker" && selectedGroupId === node.id;
            return (
              <div
                key={node.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 10,
                  border: nodeSelected
                    ? "1px solid var(--df-brand)"
                    : "1px solid var(--df-line)",
                  background: nodeSelected ? "var(--df-brand-soft)" : "var(--df-surface)",
                }}
              >
                <button
                  type="button"
                  onClick={() => load(node.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flex: 1,
                    minWidth: 0,
                    padding: "11px 12px",
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <FolderIconGlyph
                    icon={node.icon}
                    size={18}
                    style={{ color: "var(--df-accent)", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--df-ink)" }}>
                      {node.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--df-muted)", marginTop: 2 }}>
                      {node.childCount > 0 && `${node.childCount} โฟลเดอร์ย่อย`}
                      {node.childCount > 0 && node.documentCount > 0 && " · "}
                      {node.documentCount > 0 && `${node.documentCount} เอกสาร`}
                      {node.childCount === 0 && node.documentCount === 0 && "ว่างเปล่า"}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--df-muted-2)", flexShrink: 0 }} />
                </button>
                {mode === "picker" && onPick ? (
                  <button
                    type="button"
                    onClick={() =>
                      onPick({
                        id: node.id,
                        name: node.name,
                        path: [...breadcrumb.map((b) => b.name)],
                      })
                    }
                    title="เลือกโฟลเดอร์นี้"
                    aria-label={`เลือกโฟลเดอร์ ${node.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 10px",
                      marginRight: 8,
                      borderRadius: 999,
                      border: "none",
                      background: nodeSelected ? "var(--df-brand)" : "var(--df-brand-soft)",
                      color: nodeSelected ? "#fff" : "var(--df-brand)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <Check size={12} />
                    เลือก
                  </button>
                ) : (
                  canManage && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleDelete(node, e)}
                      title="ลบโฟลเดอร์"
                      style={{
                        padding: 6,
                        marginRight: 8,
                        borderRadius: 999,
                        color: "var(--df-muted-2)",
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={15} />
                    </span>
                  )
                )}
              </div>
            );
          })}

          {/* CEO Pinpoint item #12b (2026-10-13) — documents placed DIRECTLY
              in the folder currently being viewed (not its sub-folders).
              Root level (breadcrumb empty) isn't a real DocumentGroup row,
              so it has no "documents in this folder" concept — that's the
              pre-existing "ของบริษัท" bucket shown elsewhere. */}
          {breadcrumb.length > 0 && filteredDocuments.length > 0 && (
            <div style={{ marginTop: children.length > 0 ? 10 : 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.3,
                  padding: "4px 4px 6px",
                }}
              >
                เอกสารในโฟลเดอร์นี้ ({filteredDocuments.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredDocuments.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/docuflow/documents/${doc.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--df-line)",
                      background: "var(--df-surface)",
                      textDecoration: "none",
                    }}
                  >
                    <FileText size={16} style={{ color: "var(--df-muted-2)", flexShrink: 0 }} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--df-ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {canManage && (
        <div style={{ marginTop: 12 }}>
          {showCreate ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/* CEO Pinpoint item #13 (2026-10-13) — folder icon picker. */}
                <FolderIconPicker value={newIcon} onChange={setNewIcon} disabled={creating} />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreate();
                    }
                  }}
                  placeholder="ชื่อโฟลเดอร์ใหม่..."
                  autoFocus
                  disabled={creating}
                  maxLength={255}
                  style={{
                    flex: 1,
                    minWidth: 160,
                    height: 38,
                    borderRadius: 10,
                    border: "1px solid var(--df-line)",
                    padding: "0 12px",
                    fontSize: 13,
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  style={{
                    height: 38,
                    padding: "0 14px",
                    borderRadius: 10,
                    background: "var(--df-brand)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "none",
                    cursor: creating ? "default" : "pointer",
                    opacity: creating ? 0.7 : 1,
                  }}
                >
                  {creating ? "กำลังสร้าง..." : "สร้าง"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                    setNewIcon(DOCUMENT_GROUP_ICONS[0]);
                  }}
                  disabled={creating}
                  style={{
                    height: 38,
                    padding: "0 12px",
                    borderRadius: 10,
                    background: "transparent",
                    border: "1px solid var(--df-line)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            // CEO Pinpoint item #2 — when the folder is empty, the big CTA
            // card above already covers "open the create form", so this
            // smaller dashed trigger would be a confusing second copy of
            // the same action right next to it. Only shown once there's
            // already at least one folder/document here (or we're in
            // picker mode, which never shows the big CTA at all).
            !(children.length === 0 && mode === "manage") && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "9px 14px",
                  borderRadius: 999,
                  border: "1px dashed var(--df-line)",
                  background: "transparent",
                  color: "var(--df-brand)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <FolderPlus size={15} />
                สร้างโฟลเดอร์
                {breadcrumb.length > 0 ? "ย่อยในนี้" : ""}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

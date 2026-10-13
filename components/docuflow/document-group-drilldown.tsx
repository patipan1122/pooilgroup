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

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Folder, FolderPlus, ChevronRight, Loader2, Trash2 } from "lucide-react";
import {
  createDocumentGroupFolder,
  deleteDocumentGroupFolder,
} from "@/lib/docuflow/document-group-tree-actions";

interface Node {
  id: string;
  name: string;
  description: string | null;
  companyId: string | null;
  parentGroupId: string | null;
  childCount: number;
  documentCount: number;
}

interface Breadcrumb {
  id: string;
  name: string;
}

interface Props {
  companyId: string;
  companyName: string;
  /** Whether the current user can create/delete folders here. */
  canManage: boolean;
}

export function DocumentGroupDrillDown({
  companyId,
  companyName,
  canManage,
}: Props) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [children, setChildren] = useState<Node[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([]);
  // CEO Pinpoint item #12a (2026-10-13) — how many documents sit DIRECTLY
  // in the folder currently being viewed (not inside its sub-folders).
  // Drives the empty-state copy below: "no sub-folders" is misleading
  // when the folder actually holds documents.
  const [currentDocumentCount, setCurrentDocumentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

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
      setParentId(nextParentId);
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
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`สร้างโฟลเดอร์ "${res.group.name}" แล้ว`);
      setNewName("");
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

  return (
    <div>
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
          {children.length === 0 && (
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
                  "this folder is empty," which is wrong. Full document
                  browsing inside the drill-down is Batch 2's #12b — this
                  only fixes the misleading copy. */}
              {currentDocumentCount > 0
                ? `ไม่มีโฟลเดอร์ย่อย — มีเอกสาร ${currentDocumentCount} รายการ`
                : "ยังไม่มีโฟลเดอร์ในนี้"}
            </p>
          )}
          {children.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => load(node.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 12px",
                borderRadius: 10,
                border: "1px solid var(--df-line)",
                background: "var(--df-surface)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <Folder size={18} style={{ color: "var(--df-accent)", flexShrink: 0 }} />
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
              {canManage && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(node, e)}
                  title="ลบโฟลเดอร์"
                  style={{
                    padding: 6,
                    borderRadius: 999,
                    color: "var(--df-muted-2)",
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={15} />
                </span>
              )}
              <ChevronRight size={16} style={{ color: "var(--df-muted-2)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ marginTop: 12 }}>
          {showCreate ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
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
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}

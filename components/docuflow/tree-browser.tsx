"use client";

// TreeBrowser — Finder-style nested document browser for /docuflow/browse
// ────────────────────────────────────────────────────────────────────
// Client component — manages collapse state for tree nodes via useState.
// Renders companies → biz types → branches → docs hierarchically.
// Top-level: ทั้งกลุ่ม, บริษัท (each), บุคคล.
// ────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Globe2,
  Building2,
  Store,
  UserCircle,
  Search,
  AlertTriangle,
  Clock,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type {
  DocumentTree,
  DocLite,
  CompanyNode,
  BizTypeNode,
  BranchNode,
  PersonNode,
} from "@/lib/docuflow/tree";

export function TreeBrowser({ tree }: { tree: DocumentTree }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Default-expand top level
    const s = new Set<string>();
    if (tree.groupDocs.length > 0) s.add("group");
    for (const c of tree.companies) s.add(`company:${c.id}`);
    return s;
  });

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const q = query.trim().toLowerCase();

  // Filter docs by name when query active; if a node has no matching docs it
  // collapses to count "0" but stays visible (so admins know where docs would be).
  function matchDoc(d: DocLite): boolean {
    if (!q) return true;
    return d.name.toLowerCase().includes(q);
  }

  // For search mode, auto-expand everything that has matches
  const matchExpanded = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    s.add("group");
    for (const c of tree.companies) {
      s.add(`company:${c.id}`);
      for (const bt of c.bizTypes) {
        s.add(`biz:${c.id}:${bt.type}`);
        for (const b of bt.branches) {
          s.add(`branch:${b.id}`);
        }
      }
    }
    s.add("persons");
    for (const p of tree.persons) s.add(`person:${p.id}`);
    return s;
  }, [q, tree]);

  const isOpen = (key: string): boolean =>
    matchExpanded ? matchExpanded.has(key) : expanded.has(key);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="size-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อเอกสาร ทั่วทั้งระบบ"
          className="pl-10 pr-10"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
            aria-label="ล้าง"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden">
        {/* ───── ทั้งกลุ่ม ───── */}
        <TreeNode
          icon={<Globe2 className="size-4" />}
          label="ทั้งกลุ่ม"
          sublabel={`${tree.groupDocs.filter(matchDoc).length} เอกสาร`}
          open={isOpen("group")}
          onToggle={() => toggle("group")}
          depth={0}
          empty={tree.groupDocs.length === 0}
        >
          <DocList docs={tree.groupDocs.filter(matchDoc)} depth={1} />
        </TreeNode>

        {/* ───── บริษัท → ธุรกิจ → สาขา → docs ───── */}
        {tree.companies.map((c) => (
          <CompanyBranch
            key={c.id}
            company={c}
            isOpen={isOpen}
            toggle={toggle}
            matchDoc={matchDoc}
          />
        ))}

        {/* ───── บุคคล ───── */}
        {tree.persons.length > 0 && (
          <TreeNode
            icon={<UserCircle className="size-4" />}
            label="เอกสารบุคลากร"
            sublabel={`${tree.persons.length} คน · ${tree.persons.reduce((s, p) => s + p.docs.filter(matchDoc).length, 0)} เอกสาร`}
            open={isOpen("persons")}
            onToggle={() => toggle("persons")}
            depth={0}
          >
            {tree.persons.map((p) => (
              <PersonBranchNode
                key={p.id}
                person={p}
                isOpen={isOpen}
                toggle={toggle}
                matchDoc={matchDoc}
              />
            ))}
          </TreeNode>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Company subtree
   ============================================================ */

function CompanyBranch({
  company,
  isOpen,
  toggle,
  matchDoc,
}: {
  company: CompanyNode;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  matchDoc: (d: DocLite) => boolean;
}) {
  const expiringBadge = company.expiringCount > 0 && (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-1.5 py-0.5">
      <AlertTriangle className="size-3" />
      {company.expiringCount}
    </span>
  );

  return (
    <TreeNode
      icon={<Building2 className="size-4" />}
      label={company.name}
      sublabel={`${company.totalDocCount} เอกสาร`}
      right={expiringBadge}
      open={isOpen(`company:${company.id}`)}
      onToggle={() => toggle(`company:${company.id}`)}
      depth={0}
    >
      {company.directDocs.filter(matchDoc).length > 0 && (
        <FolderRow
          icon={<FileText className="size-4" />}
          label="ของบริษัท"
          count={company.directDocs.filter(matchDoc).length}
          depth={1}
          docs={company.directDocs.filter(matchDoc)}
        />
      )}
      {company.bizTypes.map((bt) => (
        <BizTypeSubtree
          key={`${company.id}-${bt.type}`}
          companyId={company.id}
          bizType={bt}
          isOpen={isOpen}
          toggle={toggle}
          matchDoc={matchDoc}
        />
      ))}
    </TreeNode>
  );
}

function BizTypeSubtree({
  companyId,
  bizType,
  isOpen,
  toggle,
  matchDoc,
}: {
  companyId: string;
  bizType: BizTypeNode;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  matchDoc: (d: DocLite) => boolean;
}) {
  const key = `biz:${companyId}:${bizType.type}`;
  const expiringBadge = bizType.expiringCount > 0 && (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-1.5 py-0.5">
      <AlertTriangle className="size-3" />
      {bizType.expiringCount}
    </span>
  );

  return (
    <TreeNode
      icon={<span className="text-base leading-none">{bizType.emoji}</span>}
      label={bizType.label}
      sublabel={`${bizType.totalDocCount} เอกสาร · ${bizType.branches.length} สาขา`}
      right={expiringBadge}
      open={isOpen(key)}
      onToggle={() => toggle(key)}
      depth={1}
    >
      {bizType.directDocs.filter(matchDoc).length > 0 && (
        <FolderRow
          icon={<FileText className="size-4" />}
          label="ของประเภทธุรกิจ"
          count={bizType.directDocs.filter(matchDoc).length}
          depth={2}
          docs={bizType.directDocs.filter(matchDoc)}
        />
      )}
      {bizType.branches.map((br) => (
        <BranchSubtree
          key={br.id}
          branch={br}
          isOpen={isOpen}
          toggle={toggle}
          matchDoc={matchDoc}
        />
      ))}
    </TreeNode>
  );
}

function BranchSubtree({
  branch,
  isOpen,
  toggle,
  matchDoc,
}: {
  branch: BranchNode;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  matchDoc: (d: DocLite) => boolean;
}) {
  const filtered = branch.docs.filter(matchDoc);
  const key = `branch:${branch.id}`;
  return (
    <TreeNode
      icon={<Store className="size-4" />}
      label={`${branch.code} · ${branch.name}`}
      sublabel={`${filtered.length} เอกสาร`}
      open={isOpen(key)}
      onToggle={() => toggle(key)}
      depth={2}
      empty={branch.docs.length === 0}
    >
      <DocList docs={filtered} depth={3} />
    </TreeNode>
  );
}

function PersonBranchNode({
  person,
  isOpen,
  toggle,
  matchDoc,
}: {
  person: PersonNode;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  matchDoc: (d: DocLite) => boolean;
}) {
  const filtered = person.docs.filter(matchDoc);
  const key = `person:${person.id}`;
  return (
    <TreeNode
      icon={<UserCircle className="size-4" />}
      label={person.name}
      sublabel={`${filtered.length} เอกสาร`}
      open={isOpen(key)}
      onToggle={() => toggle(key)}
      depth={1}
    >
      <DocList docs={filtered} depth={2} />
    </TreeNode>
  );
}

/* ============================================================
   Pieces
   ============================================================ */

function TreeNode({
  icon,
  label,
  sublabel,
  right,
  open,
  onToggle,
  depth,
  empty,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  depth: number;
  empty?: boolean;
  children?: React.ReactNode;
}) {
  const padLeft = depth * 24 + 12;
  return (
    <div className="border-b border-zinc-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={empty}
        className={cn(
          "w-full flex items-center gap-2 py-2.5 text-left transition-colors",
          empty ? "cursor-default" : "hover:bg-zinc-50",
          depth === 0 ? "bg-zinc-50/40" : "",
        )}
        style={{ paddingLeft: padLeft, paddingRight: 12 }}
      >
        <ChevronRight
          className={cn(
            "size-4 text-zinc-400 transition-transform shrink-0",
            open && "rotate-90",
            empty && "opacity-30",
          )}
        />
        <span className="size-6 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-700 shrink-0">
          {icon}
        </span>
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span
            className={cn(
              "truncate",
              depth === 0
                ? "font-bold text-zinc-900"
                : "font-semibold text-zinc-800 text-sm",
            )}
          >
            {label}
          </span>
          {sublabel && (
            <span className="text-xs text-zinc-500 truncate">{sublabel}</span>
          )}
        </span>
        {right}
      </button>
      {open && children}
    </div>
  );
}

function FolderRow({
  icon,
  label,
  count,
  depth,
  docs,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  depth: number;
  docs: DocLite[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <TreeNode
      icon={icon}
      label={label}
      sublabel={`${count} เอกสาร`}
      open={open}
      onToggle={() => setOpen(!open)}
      depth={depth}
    >
      <DocList docs={docs} depth={depth + 1} />
    </TreeNode>
  );
}

function DocList({ docs, depth }: { docs: DocLite[]; depth: number }) {
  if (docs.length === 0) {
    return (
      <p
        className="text-xs text-zinc-400 py-2"
        style={{ paddingLeft: depth * 24 + 42 }}
      >
        ไม่มีเอกสาร
      </p>
    );
  }
  return (
    <ul>
      {docs.map((d) => (
        <li key={d.id} className="border-b border-zinc-50 last:border-b-0">
          <Link
            href={`/docuflow/documents/${d.id}`}
            className="flex items-center gap-2 py-2 hover:bg-zinc-50 transition-colors text-sm"
            style={{ paddingLeft: depth * 24 + 12, paddingRight: 12 }}
          >
            <span className="w-4 shrink-0" />
            <FileText className="size-3.5 text-zinc-400 shrink-0" />
            <span className="flex-1 truncate text-zinc-700 hover:text-[var(--color-brand-700)] transition-colors">
              {d.name}
            </span>
            <ExpiryBadgeMini status={d.expiryStatus} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ExpiryBadgeMini({ status }: { status: DocLite["expiryStatus"] }) {
  if (status === "none") return null;
  if (status === "ok")
    return (
      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0">
        ปกติ
      </span>
    );
  if (status === "watch")
    return (
      <span className="text-[10px] font-bold text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">
        <Clock className="size-3" />
        เฝ้าระวัง
      </span>
    );
  if (status === "critical")
    return (
      <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">
        <Clock className="size-3" />
        ใกล้หมด
      </span>
    );
  if (status === "expired")
    return (
      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">
        <AlertTriangle className="size-3" />
        หมดแล้ว
      </span>
    );
  return null;
}

"use client";

// PanelStructure — 3 sub-sections: machines · groups · products.
// Reuses existing forms (NewMachineForm · CreateGroupForm · CreateProductForm)
// inside slide-down accordion. CSV import button is stub (importMachinesCsv).

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Layers,
  PackageOpen,
  Plus,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { NewMachineForm } from "@/components/clawfleet/new-machine-form";
import { CreateGroupForm } from "@/components/clawfleet/create-group-form";
import { CreateProductForm } from "@/components/clawfleet/create-product-form";

type Branch = { id: string; name: string; code: string };
type Group = {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  machineCount: number;
  sessionCount: number;
  toleranceBps: number;
  exchangerCode: string | null;
};
type Machine = {
  id: string;
  code: string;
  kind: "CLAW" | "EXCHANGER";
  branchName: string;
  isActive: boolean;
};
type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  defaultPriceCoins: number;
};

export interface PanelStructureProps {
  branches: Branch[];
  groups: Group[];
  machines: Machine[];
  products: Product[];
}

const CATEGORY_LABEL: Record<string, string> = {
  PLUSH: "ตุ๊กตา",
  TOY: "ของเล่น",
  UTILITY: "ของใช้",
  MYSTERY_BOX: "กล่องสุ่ม",
  MODEL: "โมเดล",
  KEYCHAIN: "พวงกุญแจ",
  SNACK: "ขนม",
  OTHER: "อื่นๆ",
};

export function PanelStructure({
  branches,
  groups,
  machines,
  products,
}: PanelStructureProps) {
  const [openSec, setOpenSec] = useState<"machines" | "groups" | "products" | null>(
    "machines",
  );
  const [addMachine, setAddMachine] = useState(false);

  // Unattached exchangers — needed by CreateGroupForm.
  // (Pulled from the loaded machine list — kind=EXCHANGER without group means
  // candidate for assignment. We don't have groupId here so list all active
  // EXCHANGER · the form is forgiving on dup-pick.)
  const exchangerCandidates = machines
    .filter((m) => m.kind === "EXCHANGER" && m.isActive)
    .map((m) => {
      const branch = branches.find((b) => b.name === m.branchName);
      return { id: m.id, code: m.code, branchId: branch?.id ?? "" };
    })
    .filter((m) => m.branchId);

  const groupsForForm = groups.map((g) => ({
    id: g.id,
    name: g.name,
    branchId: g.branchId,
  }));

  return (
    <div className="space-y-4">
      {/* ── MACHINES ─────────────────────────────────────────── */}
      <Accordion
        icon={<Gamepad2 className="size-5 text-blue-600" />}
        title="ตู้"
        count={machines.length}
        subtitle="ตู้คีบ + ตู้แลกเหรียญ · เพิ่มทีละตู้หรือ import CSV"
        open={openSec === "machines"}
        onToggle={() =>
          setOpenSec(openSec === "machines" ? null : "machines")
        }
        actions={
          <div className="flex gap-2">
            <Link
              href="?tab=import"
              scroll={false}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <Upload className="size-3.5" /> นำเข้า CSV →
            </Link>
            <button
              type="button"
              onClick={() => setAddMachine((v) => !v)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="size-3.5" /> เพิ่มตู้
            </button>
          </div>
        }
      >
        {addMachine && (
          <div className="mb-4">
            <NewMachineForm branches={branches} groups={groupsForForm} />
          </div>
        )}
        {machines.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-500">
            ยังไม่มีตู้ · กด “เพิ่มตู้” ด้านบน
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left text-xs text-zinc-500">
                  <th className="px-3 py-2 font-medium">รหัส</th>
                  <th className="px-3 py-2 font-medium">ชนิด</th>
                  <th className="px-3 py-2 font-medium">สาขา</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {machines.slice(0, 50).map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-900">
                      {m.code}
                    </td>
                    <td className="px-3 py-2">
                      {m.kind === "CLAW" ? (
                        <Badge tone="info">ตู้คีบ</Badge>
                      ) : (
                        <Badge tone="warning">ตู้แลก</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{m.branchName}</td>
                    <td className="px-3 py-2">
                      {m.isActive ? (
                        <StatusPill tone="success" dot size="xs">
                          ใช้งาน
                        </StatusPill>
                      ) : (
                        <StatusPill tone="neutral" dot size="xs">
                          ปิด
                        </StatusPill>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/clawfleet/machines/${m.code}`}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        จัดการ →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {machines.length > 50 && (
              <div className="border-t border-zinc-100 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500">
                แสดง 50 จาก {machines.length} ·{" "}
                <Link
                  href="/clawfleet/machines"
                  className="font-semibold text-blue-600 hover:underline"
                >
                  ไปหน้าตู้ทั้งหมด →
                </Link>
              </div>
            )}
          </div>
        )}
      </Accordion>

      {/* ── GROUPS ──────────────────────────────────────────── */}
      <Accordion
        icon={<Layers className="size-5 text-indigo-600" />}
        title="กลุ่ม"
        count={groups.length}
        subtitle="ตู้คีบที่จับคู่กับตู้แลกเหรียญ 1 ตัว · ใช้ cross-check"
        open={openSec === "groups"}
        onToggle={() => setOpenSec(openSec === "groups" ? null : "groups")}
        actions={
          <CreateGroupForm
            branches={branches}
            unattachedExchangers={exchangerCandidates}
          />
        }
      >
        {groups.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-500">
            ยังไม่มีกลุ่ม · กด “+ สร้างกลุ่ม” ด้านบน
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-zinc-900">{g.name}</p>
                    <span className="text-xs text-zinc-500">· {g.branchName}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{g.machineCount} ตู้คีบ</span>
                    {g.exchangerCode && (
                      <span>· แลก {g.exchangerCode}</span>
                    )}
                    <span>· tolerance {(g.toleranceBps / 100).toFixed(1)}%</span>
                    <span>· {g.sessionCount} sessions</span>
                  </div>
                </div>
                <Link
                  href={`/clawfleet/groups/${g.id}`}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  จัดการ →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ── PRODUCTS ────────────────────────────────────────── */}
      <Accordion
        icon={<PackageOpen className="size-5 text-emerald-600" />}
        title="สินค้า (ตุ๊กตา + ขนม)"
        count={products.length}
        subtitle="catalog ที่ใช้ใน loadout ตู้คีบ + นับสต๊อก"
        open={openSec === "products"}
        onToggle={() =>
          setOpenSec(openSec === "products" ? null : "products")
        }
        actions={<CreateProductForm />}
      >
        {products.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-500">
            ยังไม่มีสินค้า · กด “+ เพิ่มสินค้า” ด้านบน
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left text-xs text-zinc-500">
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">ชื่อ</th>
                  <th className="px-3 py-2 font-medium">หมวด</th>
                  <th className="px-3 py-2 text-right font-medium">ราคา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono text-xs text-zinc-900">
                      {p.sku}
                    </td>
                    <td className="px-3 py-2 text-zinc-900">{p.name}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {CATEGORY_LABEL[p.category] ?? p.category}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-900">
                      {p.defaultPriceCoins} เหรียญ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Accordion>
    </div>
  );
}

// ── local accordion section ─────────────────────────────────
interface AccordionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

function Accordion({
  icon,
  title,
  subtitle,
  count,
  open,
  onToggle,
  actions,
  children,
}: AccordionProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl bg-zinc-50 transition-transform",
              open ? "rotate-0" : "-rotate-0",
            )}
          >
            {icon}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
              {typeof count === "number" && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-600">
                  {count}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">{subtitle}</p>
          </div>
          {open ? (
            <ChevronDown className="size-5 text-zinc-400" />
          ) : (
            <ChevronRight className="size-5 text-zinc-400" />
          )}
        </button>
        {open && actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>
      {open && <div className="p-5">{children}</div>}
    </section>
  );
}

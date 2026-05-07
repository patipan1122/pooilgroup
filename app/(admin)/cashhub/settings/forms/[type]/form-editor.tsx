"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Lock,
  RotateCcw,
  Save,
  Sparkles,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Star,
  Copy,
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type {
  BusinessTypeConfig,
  BusinessTypeKey,
  FieldConfig,
  FieldGroup,
  FieldType,
} from "@/constants/business-types";
import type {
  BusinessTypeOverrides,
  FieldOverride,
} from "@/lib/cashhub/form-config";
import type {
  FormTemplate,
  CustomField,
} from "@/lib/cashhub/form-templates-types";
import { generateCustomFieldKey } from "@/lib/cashhub/form-templates-types";
import { BranchAssignmentPanel } from "./branch-assignment-panel";

interface BranchOption {
  id: string;
  code: string;
  name: string;
  province: string | null;
  form_template_id: string | null;
}

interface Props {
  businessType: BusinessTypeKey;
  label: string;
  emoji: string;
  defaults: BusinessTypeConfig;
  lockedFieldKeys: string[];
  branchCount: number;
  templates: FormTemplate[];
  activeTemplate: FormTemplate;
  activeTemplateBranchCount: number;
  branches: BranchOption[];
}

const GROUP_LABEL: Record<string, string> = {
  sales: "ยอดขาย",
  received: "ช่องทางรับเงิน",
  shortage: "เงินขาด",
  rental: "ค่าเช่า",
  training: "อบรม",
  notes: "หมายเหตุ",
};

function effectiveField(
  field: FieldConfig,
  override: FieldOverride | undefined,
  locked: boolean,
): FieldConfig | null {
  const numericDefault = field.type === "currency" || field.type === "number";
  if (!override) return { ...field, numericOnly: numericDefault };
  if (override.hidden && !locked) return null;
  return {
    ...field,
    label: override.label?.trim() || field.label,
    placeholder: override.placeholder?.trim() || field.placeholder,
    hint: override.hint?.trim() ?? field.hint,
    required: locked
      ? field.required
      : override.required !== undefined
        ? override.required
        : field.required,
    numericOnly:
      override.numericOnly !== undefined
        ? override.numericOnly
        : numericDefault,
  };
}

export function FormEditor({
  businessType,
  label,
  emoji,
  defaults,
  lockedFieldKeys,
  branchCount,
  templates,
  activeTemplate,
  activeTemplateBranchCount,
  branches,
}: Props) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<BusinessTypeOverrides>(
    activeTemplate.overrides,
  );
  const [customFields, setCustomFields] = useState<CustomField[]>(
    activeTemplate.custom_fields,
  );
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [versionPending, startVersionTransition] = useTransition();
  const [editingCustomKey, setEditingCustomKey] = useState<string | null>(null);

  const lockedSet = useMemo(() => new Set(lockedFieldKeys), [lockedFieldKeys]);
  const isLocked = (key: string) => lockedSet.has(key);

  const dirty = useMemo(
    () =>
      JSON.stringify(overrides) !==
        JSON.stringify(activeTemplate.overrides) ||
      JSON.stringify(customFields) !==
        JSON.stringify(activeTemplate.custom_fields),
    [overrides, customFields, activeTemplate],
  );

  function patch(fieldKey: string, change: Partial<FieldOverride>) {
    setOverrides((prev) => {
      const cur = prev[fieldKey] ?? {};
      const next: FieldOverride = { ...cur, ...change };
      // strip empty entries to keep payload tidy
      const cleaned: FieldOverride = {};
      if (next.label !== undefined && next.label !== "") cleaned.label = next.label;
      if (next.placeholder !== undefined && next.placeholder !== "")
        cleaned.placeholder = next.placeholder;
      if (next.hint !== undefined && next.hint !== "") cleaned.hint = next.hint;
      if (next.required !== undefined) cleaned.required = next.required;
      if (next.hidden !== undefined) cleaned.hidden = next.hidden;

      const out = { ...prev };
      if (Object.keys(cleaned).length === 0) {
        delete out[fieldKey];
      } else {
        out[fieldKey] = cleaned;
      }
      return out;
    });
  }

  function resetField(fieldKey: string) {
    setOverrides((prev) => {
      const out = { ...prev };
      delete out[fieldKey];
      return out;
    });
  }

  function resetAll() {
    if (!confirm("รีเซ็ตทุกช่องเป็นค่าเริ่มต้น? การปรับแต่งจะหายหมด")) return;
    setOverrides({});
    setCustomFields([]);
  }

  function save() {
    startTransition(async () => {
      const res = await fetch(
        `/api/admin/cashhub/form-templates/${activeTemplate.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overrides,
            custom_fields: customFields,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกฟอร์มแล้ว", {
        description: activeTemplate.is_default
          ? `${branchCount} สาขา (default) จะเห็นฟอร์มใหม่ทันที`
          : `${activeTemplateBranchCount} สาขาที่ใช้เวอร์ชั่นนี้จะเห็นฟอร์มใหม่ทันที`,
      });
      setConfirmOpen(false);
      router.refresh();
    });
  }

  /* ============================================================
     Version management
     ============================================================ */
  function switchVersion(templateId: string) {
    if (templateId === activeTemplate.id) return;
    if (dirty && !confirm("ยังไม่ได้บันทึก เปลี่ยนเวอร์ชั่นจะทิ้งการแก้ไข?"))
      return;
    router.push(`/cashhub/settings/forms/${businessType}?v=${templateId}`);
  }

  function createNewVersion() {
    const name = prompt(
      "ตั้งชื่อเวอร์ชั่นใหม่ (เช่น 'มีคาร์แคร์', 'สาขาเล็ก'):",
      `เวอร์ชั่น ${templates.length + 1}`,
    );
    if (!name) return;
    startVersionTransition(async () => {
      const res = await fetch("/api/admin/cashhub/form-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType,
          name,
          cloneFromId: activeTemplate.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "สร้างไม่สำเร็จ");
        return;
      }
      toast.success(`สร้าง "${name}" แล้ว — ก๊อบจาก ${activeTemplate.name}`);
      router.push(
        `/cashhub/settings/forms/${businessType}?v=${json.template.id}`,
      );
    });
  }

  function renameVersion() {
    const newName = prompt("ตั้งชื่อใหม่:", activeTemplate.name);
    if (!newName || newName === activeTemplate.name) return;
    startVersionTransition(async () => {
      const res = await fetch(
        `/api/admin/cashhub/form-templates/${activeTemplate.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "เปลี่ยนชื่อไม่สำเร็จ");
        return;
      }
      toast.success("เปลี่ยนชื่อแล้ว");
      router.refresh();
    });
  }

  function deleteVersion() {
    if (activeTemplate.is_default) {
      toast.error("ลบเวอร์ชั่น default ไม่ได้");
      return;
    }
    if (!confirm(`ลบเวอร์ชั่น "${activeTemplate.name}"? ลบแล้วกู้ไม่ได้`))
      return;
    startVersionTransition(async () => {
      const res = await fetch(
        `/api/admin/cashhub/form-templates/${activeTemplate.id}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ลบไม่สำเร็จ");
        return;
      }
      toast.success("ลบเวอร์ชั่นแล้ว");
      const fallback = templates.find((t) => t.is_default);
      if (fallback) {
        router.push(`/cashhub/settings/forms/${businessType}?v=${fallback.id}`);
      } else {
        router.push(`/cashhub/settings/forms/${businessType}`);
      }
    });
  }

  /* ============================================================
     Custom field CRUD
     ============================================================ */
  function addCustomField() {
    const label = prompt("ชื่อช่อง (เช่น 'PromptPay', 'TrueMoney Wallet'):");
    if (!label) return;
    const newField: CustomField = {
      key: generateCustomFieldKey(label),
      label: label.trim(),
      type: "currency",
      group: "received",
      required: false,
      placeholder: "0",
      isPaymentChannel: true,
      sortOrder: customFields.length,
    };
    setCustomFields((prev) => [...prev, newField]);
    setEditingCustomKey(newField.key);
  }

  function patchCustomField(key: string, change: Partial<CustomField>) {
    setCustomFields((prev) =>
      prev.map((cf) => (cf.key === key ? { ...cf, ...change } : cf)),
    );
  }

  function deleteCustomField(key: string) {
    if (!confirm("ลบช่องนี้?")) return;
    setCustomFields((prev) => prev.filter((cf) => cf.key !== key));
  }

  // Group preview fields — built-in (with overrides) + custom fields appended
  const previewFields = useMemo(() => {
    const builtIn = defaults.fields
      .map((f) => effectiveField(f, overrides[f.key], isLocked(f.key)))
      .filter((f): f is FieldConfig => f !== null);
    const customSorted = [...customFields].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const customAsField: FieldConfig[] = customSorted.map((cf) => ({
      key: cf.key,
      label: cf.label,
      placeholder: cf.placeholder,
      type: cf.type,
      unit: cf.unit,
      group: cf.group,
      required: cf.required,
      hint: cf.hint,
      numericOnly:
        cf.numericOnly !== undefined
          ? cf.numericOnly
          : cf.type === "currency" || cf.type === "number",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      column: "_custom" as any,
    }));
    return [...builtIn, ...customAsField];
  }, [defaults.fields, overrides, customFields, lockedSet]);

  const hiddenCount = defaults.fields.length - previewFields.length + customFields.length;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-20 -left-20 size-96 rounded-full blur-3xl opacity-15 pointer-events-none animate-drift"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />

      <div className="relative p-3 sm:p-6 max-w-6xl mx-auto pb-40 sm:pb-32">
        {/* Back + header */}
        <div className="mb-3">
          <BackButton label="กลับ" fallbackHref="/cashhub/settings/forms" />
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="size-11 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center text-xl shrink-0">
            {emoji}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-brand-700)] font-bold">
              ฟอร์มกรอกยอด
            </p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-[-0.02em] font-display leading-tight">
              {label}
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {branchCount} สาขาทั้งหมด · เวอร์ชั่นนี้ใช้กับ{" "}
              <strong className="text-zinc-700 tabular-num">
                {activeTemplate.is_default
                  ? `default (${branchCount - templates.filter((t) => !t.is_default).reduce(() => 0, 0)} สาขา)`
                  : `${activeTemplateBranchCount} สาขา`}
              </strong>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetAll}
            disabled={
              Object.keys(overrides).length === 0 && customFields.length === 0
            }
          >
            <RotateCcw className="size-3.5" />
            รีเซ็ตทั้งหมด
          </Button>
        </div>

        {/* Version tabs */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5 p-1 rounded-2xl border border-zinc-200 bg-zinc-50">
          {templates.map((t) => {
            const isActive = t.id === activeTemplate.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchVersion(t.id)}
                disabled={versionPending}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-bold transition-colors",
                  isActive
                    ? "bg-white text-[var(--color-brand-700)] shadow-soft border border-[var(--color-brand-200)]"
                    : "text-zinc-600 hover:bg-white",
                )}
                title={t.name}
              >
                {t.is_default && <Star className="size-3 fill-current" />}
                <span className="tabular-num">v{t.version}</span>
                <span className="hidden sm:inline truncate max-w-[120px]">
                  {t.name}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={createNewVersion}
            disabled={versionPending}
            className="inline-flex items-center gap-1 px-3 h-9 rounded-xl text-sm font-bold text-[var(--color-brand-700)] hover:bg-white border border-dashed border-[var(--color-brand-300)]"
            title={`ก๊อบจาก ${activeTemplate.name} → สร้างเวอร์ชั่นใหม่`}
          >
            <Plus className="size-3.5" />
            เพิ่ม
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={renameVersion}
              disabled={versionPending}
              title="เปลี่ยนชื่อเวอร์ชั่นนี้"
              className="p-1.5 rounded-lg text-zinc-500 hover:bg-white hover:text-zinc-900"
            >
              <Pencil className="size-3.5" />
            </button>
            {!activeTemplate.is_default && (
              <button
                type="button"
                onClick={deleteVersion}
                disabled={versionPending}
                title="ลบเวอร์ชั่นนี้"
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Branch assignment — admin assigns which branches use this version */}
        <div className="mb-5">
          <BranchAssignmentPanel
            activeTemplateId={activeTemplate.id}
            isDefault={activeTemplate.is_default}
            branches={branches}
          />
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-5">
          {/* Editor column */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-0.5 px-0.5">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                ตั้งค่าช่อง ({defaults.fields.length} ช่อง)
              </h2>
            </div>
            {defaults.fields.map((f) => {
              const ov = overrides[f.key];
              const locked = isLocked(f.key);
              const isHidden = !!ov?.hidden && !locked;
              const customized = !!ov && Object.keys(ov).length > 0;

              return (
                <div
                  key={f.key}
                  className={cn(
                    "rounded-xl border bg-white transition-colors",
                    isHidden
                      ? "border-zinc-200 opacity-60"
                      : customized
                        ? "border-[var(--color-brand-300)] ring-1 ring-[var(--color-brand-100)]"
                        : "border-zinc-200",
                  )}
                >
                  <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-[13px] truncate">
                          {ov?.label || f.label}
                        </span>
                        {locked && (
                          <Badge tone="neutral" className="!px-1.5 !text-[10px]">
                            <Lock className="size-2.5" />
                            ล็อก
                          </Badge>
                        )}
                        {customized && !isHidden && (
                          <Badge tone="brand" className="!px-1.5 !text-[10px]">
                            ปรับแล้ว
                          </Badge>
                        )}
                        {isHidden && (
                          <Badge tone="neutral" className="!text-[10px]">ซ่อน</Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5 font-mono truncate">
                        {f.key} · {f.type}
                        {f.unit && <span> · {f.unit}</span>} ·{" "}
                        {GROUP_LABEL[f.group] ?? f.group}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => patch(f.key, { hidden: !isHidden })}
                          title={isHidden ? "แสดง" : "ซ่อน"}
                          className={cn(
                            "p-1.5 rounded-md transition-colors",
                            isHidden
                              ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700",
                          )}
                        >
                          {isHidden ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </button>
                      )}
                      {customized && (
                        <button
                          type="button"
                          onClick={() => resetField(f.key)}
                          title="รีเซ็ตช่องนี้"
                          className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {!isHidden && (
                    <div className="p-3 grid sm:grid-cols-2 gap-2.5">
                      <CompactField
                        label="ชื่อช่อง"
                        placeholder={f.label}
                        value={ov?.label ?? ""}
                        onChange={(v) => patch(f.key, { label: v })}
                        maxLength={80}
                      />
                      <CompactField
                        label="hint (เล็ก)"
                        placeholder={f.hint ?? "—"}
                        value={ov?.hint ?? ""}
                        onChange={(v) => patch(f.key, { hint: v })}
                        maxLength={200}
                      />
                      <CompactField
                        label="placeholder"
                        placeholder={f.placeholder}
                        value={ov?.placeholder ?? ""}
                        onChange={(v) => patch(f.key, { placeholder: v })}
                        maxLength={80}
                      />
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 h-[38px] sm:self-end">
                        <div className="text-[12px] min-w-0">
                          <span className="font-semibold">บังคับกรอก</span>
                          {locked && (
                            <span className="text-zinc-400 ml-1">(ล็อก)</span>
                          )}
                        </div>
                        <Toggle
                          checked={ov?.required ?? f.required}
                          disabled={locked}
                          onClick={() =>
                            patch(f.key, {
                              required:
                                ov?.required !== undefined
                                  ? !ov.required
                                  : !f.required,
                            })
                          }
                        />
                      </div>
                      {(() => {
                        const numericDefault =
                          f.type === "currency" || f.type === "number";
                        const numericIsCurrencyType = f.type === "currency";
                        const currentNumeric =
                          ov?.numericOnly !== undefined
                            ? ov.numericOnly
                            : numericDefault;
                        return (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 h-[38px] sm:self-end sm:col-span-2">
                            <div className="text-[12px] min-w-0">
                              <span className="font-semibold">
                                เฉพาะตัวเลข
                              </span>
                              <span className="text-zinc-400 ml-1.5 text-[11px]">
                                {numericIsCurrencyType
                                  ? "(currency = บังคับ)"
                                  : "(0-9 และ . เท่านั้น · บล็อก , ฿ ตัวอักษร)"}
                              </span>
                            </div>
                            <Toggle
                              checked={currentNumeric}
                              disabled={numericIsCurrencyType}
                              onClick={() =>
                                patch(f.key, {
                                  numericOnly: !currentNumeric,
                                })
                              }
                            />
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Custom fields section — admin can add new fields beyond built-in spec */}
            <div className="mt-6 pt-4 border-t-2 border-dashed border-zinc-200">
              <div className="flex items-center justify-between mb-2 px-0.5">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  ฟิลด์ที่เพิ่มเอง ({customFields.length})
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCustomField}
                >
                  <Plus className="size-3.5" />
                  เพิ่มช่องใหม่
                </Button>
              </div>
              {customFields.length === 0 ? (
                <p className="text-[12px] text-zinc-500 px-3 py-6 rounded-xl border border-dashed border-zinc-200 text-center">
                  ยังไม่มีช่องที่เพิ่มเอง · กด "เพิ่มช่องใหม่" เพื่อเพิ่ม
                  payment channel ใหม่ (เช่น PromptPay, e-wallet) ฟิลด์นี้จะถูก
                  save เข้า extra_fields ของ daily_reports
                </p>
              ) : (
                <div className="space-y-2">
                  {customFields.map((cf) => (
                    <CustomFieldRow
                      key={cf.key}
                      field={cf}
                      isEditing={editingCustomKey === cf.key}
                      onEdit={() => setEditingCustomKey(cf.key)}
                      onClose={() => setEditingCustomKey(null)}
                      onPatch={(change) => patchCustomField(cf.key, change)}
                      onDelete={() => deleteCustomField(cf.key)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Live preview column — phone frame */}
          <div>
            <div className="lg:sticky lg:top-4">
              <div className="flex items-center justify-between mb-2 px-0.5">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                  พนักงานจะเห็นแบบนี้
                </h2>
                <Badge tone="brand" className="!text-[10px]">
                  <Sparkles className="size-2.5" />
                  Live
                </Badge>
              </div>

              <PhoneFrame>
                {(() => {
                  // Sample preview data — แสดงให้ admin เห็นว่าหน้านี้คือใครกรอก
                  const SHIFT_LABEL: Record<string, string> = {
                    morning: "กะเช้า",
                    midday: "กะกลาง",
                    evening: "กะเย็น",
                    all: "ทั้งวัน",
                  };
                  const sampleShift =
                    SHIFT_LABEL[defaults.shifts[0] ?? "all"] ?? "ทั้งวัน";
                  const sampleBranch = "KKN-001 · ขอนแก่น 01";
                  const sampleStaff = "สมชาย ใจดี";
                  const now = new Date();
                  const sampleDate = now.toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                  });
                  const sampleTime = now.toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <>
                      {/* Status bar */}
                      <div className="h-6 flex items-center justify-between px-5 text-[10px] font-semibold text-zinc-900">
                        <span>{sampleTime}</span>
                        <span>•••</span>
                      </div>
                      {/* App header */}
                      <div className="bg-white border-b border-zinc-200 px-3 py-2 flex items-center gap-2">
                        <div className="text-lg">{emoji}</div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[12px] truncate font-display">
                            {label}
                          </div>
                          <div className="text-[9px] text-zinc-500 truncate">
                            {sampleBranch}
                          </div>
                        </div>
                        <span className="text-[9px] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] px-1.5 py-0.5 rounded-md font-semibold">
                          {sampleShift}
                        </span>
                      </div>
                      {/* Sample staff + datetime banner */}
                      <div className="px-3 py-1.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="size-4 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-700)] flex items-center justify-center text-[8px] font-bold shrink-0">
                            {sampleStaff.charAt(0)}
                          </span>
                          <span className="text-zinc-700 font-medium truncate">
                            {sampleStaff}
                          </span>
                        </div>
                        <span className="text-zinc-500 tabular-num shrink-0">
                          {sampleDate} · {sampleTime}
                        </span>
                      </div>
                    </>
                  );
                })()}

                {/* Form body — scrolls inside frame, fits viewport */}
                <div className="p-3 space-y-2.5 overflow-y-auto max-h-[calc(100dvh-16rem)]">
                  {previewFields.length === 0 && (
                    <div className="text-[11px] text-zinc-500 text-center py-12">
                      ทุกช่องถูกซ่อนหมด —<br />
                      พนักงานจะไม่มีอะไรกรอก
                    </div>
                  )}
                  {previewFields.map((f) => (
                    <PhoneField key={f.key} field={f} />
                  ))}
                  {previewFields.length > 0 && (
                    <button
                      type="button"
                      disabled
                      className="w-full mt-2 h-10 rounded-xl bg-[var(--color-brand-600)] text-white text-[13px] font-semibold disabled:opacity-90"
                    >
                      ส่งรายงาน
                    </button>
                  )}
                </div>
              </PhoneFrame>

              {hiddenCount > 0 && (
                <div className="text-[11px] text-zinc-500 text-center mt-2">
                  ซ่อนอยู่ {hiddenCount} ช่อง
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-zinc-200 px-4 py-3 safe-bottom">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="text-sm min-w-0">
            {dirty ? (
              <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
                <AlertTriangle className="size-4" />
                มีการเปลี่ยนแปลงที่ยังไม่บันทึก
              </span>
            ) : (
              <span className="text-zinc-500">
                ปรับแต่งเสร็จแล้วกดบันทึก — มีผลกับทุกสาขาทันที
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!dirty || pending}
            loading={pending}
          >
            <Save className="size-4" />
            บันทึก
          </Button>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/40 flex items-center justify-center p-4"
          onClick={() => !pending && setConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border-2 border-zinc-200 shadow-pop max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="size-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="size-5 text-amber-700" />
              </div>
              <div>
                <h3 className="font-bold text-lg font-display">
                  ยืนยันบันทึก
                </h3>
                <p className="text-xs text-zinc-500">
                  {branchCount} สาขาจะเห็นฟอร์มใหม่ทันที
                </p>
              </div>
            </div>
            <div className="text-sm text-zinc-700 mb-4 space-y-1">
              <div>
                · ช่องที่ปรับแต่ง:{" "}
                <strong>{Object.keys(overrides).length} ช่อง</strong>
              </div>
              <div>
                · ช่องที่ซ่อน:{" "}
                <strong>{hiddenCount} ช่อง</strong>
              </div>
              <div>
                · ช่องที่จะแสดง:{" "}
                <strong>{previewFields.length} ช่อง</strong>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
              >
                ยกเลิก
              </Button>
              <Button type="button" onClick={save} loading={pending}>
                ยืนยันบันทึก
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- helpers ----------------

function CompactField({
  label,
  placeholder,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="mt-0.5 w-full h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] placeholder:text-zinc-400"
      />
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center h-6 w-10 rounded-full p-0.5 transition-colors shrink-0",
        checked ? "bg-[var(--color-brand-600)]" : "bg-zinc-300",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "block size-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div className="rounded-[2rem] border-[8px] border-zinc-900 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="bg-zinc-50 rounded-[1.4rem] overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

function PhoneField({ field }: { field: FieldConfig }) {
  // Numeric override only worth showing on TEXT fields (currency/number is implicit)
  const showNumericChip =
    field.type === "text" && field.numericOnly === true;
  return (
    <div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-[11px] font-medium text-zinc-800">
          {field.label}
        </span>
        {field.required && (
          <span className="text-[var(--color-danger)] text-[11px]">*</span>
        )}
        {showNumericChip && (
          <span
            title="กรอกเฉพาะ 0-9 และ ."
            className="ml-auto text-[9px] font-bold text-[var(--color-brand-700)] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] px-1 py-0.5 rounded leading-none"
          >
            0-9 .
          </span>
        )}
      </div>
      {field.type === "text" && !field.numericOnly ? (
        <textarea
          rows={2}
          placeholder={field.placeholder}
          readOnly
          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] text-zinc-500 placeholder:text-zinc-400"
        />
      ) : (
        <div className="flex items-center h-9 rounded-lg border border-zinc-200 bg-white">
          {field.type === "currency" && (
            <span className="pl-2.5 pr-1 text-[11px] text-zinc-500 font-semibold">
              ฿
            </span>
          )}
          <span
            className={cn(
              "flex-1 text-[11px] text-zinc-400 truncate",
              field.type === "currency" ? "pl-0" : "pl-2.5",
            )}
          >
            {field.placeholder}
          </span>
          {field.unit && field.type !== "currency" && (
            <span className="px-2.5 text-[11px] text-zinc-500">
              {field.unit}
            </span>
          )}
        </div>
      )}
      {field.hint && (
        <p className="text-[10px] text-zinc-500 mt-0.5">{field.hint}</p>
      )}
    </div>
  );
}

/* ============================================================
   CustomFieldRow — editor for one admin-added field
   ============================================================ */
function CustomFieldRow({
  field,
  isEditing,
  onEdit,
  onClose,
  onPatch,
  onDelete,
}: {
  field: CustomField;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onPatch: (change: Partial<CustomField>) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white transition-colors",
        isEditing
          ? "border-[var(--color-brand-300)] ring-1 ring-[var(--color-brand-100)]"
          : "border-zinc-200",
      )}
    >
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[13px] truncate">
              {field.label}
            </span>
            <Badge tone="brand" className="!px-1.5 !text-[10px]">
              custom
            </Badge>
            {field.isPaymentChannel && (
              <Badge tone="success" className="!px-1.5 !text-[10px]">
                ช่องทางรับเงิน
              </Badge>
            )}
            {field.required && (
              <Badge tone="warning" className="!px-1.5 !text-[10px]">
                บังคับ
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {field.key} · {field.type} · {field.group}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={isEditing ? onClose : onEdit}
            className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            title={isEditing ? "ปิด" : "แก้"}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-700"
            title="ลบ"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {isEditing && (
        <div className="p-3 grid sm:grid-cols-2 gap-2.5">
          <CompactField
            label="ชื่อช่อง"
            placeholder="เช่น PromptPay"
            value={field.label}
            onChange={(v) => onPatch({ label: v })}
            maxLength={80}
          />
          <CompactField
            label="placeholder"
            placeholder="เช่น 0"
            value={field.placeholder}
            onChange={(v) => onPatch({ placeholder: v })}
            maxLength={80}
          />
          <CompactField
            label="hint (เล็ก)"
            placeholder="—"
            value={field.hint ?? ""}
            onChange={(v) => onPatch({ hint: v || undefined })}
            maxLength={200}
          />
          <CompactField
            label="หน่วย (เช่น ลิตร)"
            placeholder="—"
            value={field.unit ?? ""}
            onChange={(v) => onPatch({ unit: v || undefined })}
            maxLength={16}
          />
          <div className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium text-zinc-600">ประเภท</span>
            <select
              value={field.type}
              onChange={(e) =>
                onPatch({ type: e.target.value as FieldType })
              }
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-[13px] outline-none focus:border-[var(--color-brand-500)]"
            >
              <option value="currency">currency (เงิน ฿)</option>
              <option value="number">number (ตัวเลข)</option>
              <option value="text">text (ข้อความ)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 text-[12px]">
            <span className="font-medium text-zinc-600">กลุ่ม</span>
            <select
              value={field.group}
              onChange={(e) =>
                onPatch({ group: e.target.value as FieldGroup })
              }
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-[13px] outline-none focus:border-[var(--color-brand-500)]"
            >
              <option value="received">received (ช่องทางรับเงิน)</option>
              <option value="sales">sales (ยอดขาย)</option>
              <option value="shortage">shortage (เงินขาด)</option>
              <option value="rental">rental (ค่าเช่า)</option>
              <option value="training">training (อบรม)</option>
              <option value="notes">notes (หมายเหตุ)</option>
              <option value="custom">custom (อื่น ๆ)</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 h-[38px] sm:self-end">
            <span className="text-[12px] font-semibold">บังคับกรอก</span>
            <Toggle
              checked={field.required}
              onClick={() => onPatch({ required: !field.required })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 h-[38px] sm:self-end">
            <span className="text-[12px] font-semibold">เป็น payment channel</span>
            <Toggle
              checked={!!field.isPaymentChannel}
              onClick={() =>
                onPatch({ isPaymentChannel: !field.isPaymentChannel })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Sparkles,
  Eye,
  GripVertical,
} from "lucide-react";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  FIELD_TYPE_ICONS,
  type Field,
  type FieldType,
  type FormSchema,
  type FormSection,
} from "@/lib/recruit/types";
import { suggestFieldsAction } from "@/app/(admin)/recruit/_actions/ai";
import { PublicFormRenderer } from "./public-form-renderer";

interface Props {
  schema: FormSchema;
  onChange: (s: FormSchema) => void;
  jobTitle?: string;
  readonly?: boolean;
}

export function FormBuilder({ schema, onChange, jobTitle, readonly }: Props) {
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingAI, startAI] = useTransition();

  function uid(prefix = "f"): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function updateSection(sectionId: string, patch: Partial<FormSection>) {
    onChange({
      ...schema,
      sections: schema.sections.map((s) =>
        s.id === sectionId ? { ...s, ...patch } : s,
      ),
    });
  }

  function addSection() {
    onChange({
      ...schema,
      sections: [
        ...schema.sections,
        { id: uid("sec"), title: "ส่วนใหม่", fields: [] },
      ],
    });
  }

  function removeSection(sectionId: string) {
    if (schema.sections.length <= 1) {
      toast.error("ต้องมีอย่างน้อย 1 ส่วน");
      return;
    }
    onChange({
      ...schema,
      sections: schema.sections.filter((s) => s.id !== sectionId),
    });
  }

  function addField(sectionId: string, type: FieldType) {
    const defaults = makeDefaultField(type, uid());
    onChange({
      ...schema,
      sections: schema.sections.map((s) =>
        s.id === sectionId ? { ...s, fields: [...s.fields, defaults] } : s,
      ),
    });
    setSelectedFieldId(defaults.id);
  }

  function updateField(sectionId: string, fieldId: string, patch: Partial<Field>) {
    onChange({
      ...schema,
      sections: schema.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === fieldId ? { ...f, ...patch } : f,
              ),
            }
          : s,
      ),
    });
  }

  function removeField(sectionId: string, fieldId: string) {
    onChange({
      ...schema,
      sections: schema.sections.map((s) =>
        s.id === sectionId
          ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) }
          : s,
      ),
    });
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }

  function moveField(sectionId: string, fieldId: string, dir: -1 | 1) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const idx = section.fields.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= section.fields.length) return;
    const newFields = [...section.fields];
    [newFields[idx], newFields[next]] = [newFields[next], newFields[idx]];
    updateSection(sectionId, { fields: newFields });
  }

  function duplicateField(sectionId: string, fieldId: string) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const f = section.fields.find((x) => x.id === fieldId);
    if (!f) return;
    const idx = section.fields.findIndex((x) => x.id === fieldId);
    const copy: Field = { ...f, id: uid(), label: f.label + " (สำเนา)" };
    const newFields = [
      ...section.fields.slice(0, idx + 1),
      copy,
      ...section.fields.slice(idx + 1),
    ];
    updateSection(sectionId, { fields: newFields });
  }

  async function runAISuggest() {
    if (!jobTitle?.trim()) {
      toast.error("กรอกตำแหน่งก่อน");
      return;
    }
    startAI(async () => {
      try {
        const suggestions = await suggestFieldsAction({
          jobTitle: jobTitle ?? "",
        });
        if (suggestions.length === 0) {
          toast.error("AI ไม่สามารถแนะนำได้ในตอนนี้");
          return;
        }
        const newFields: Field[] = suggestions.map((s) => ({
          id: uid(),
          type: s.type,
          label: s.label,
          required: s.required ?? false,
          helpText: s.helpText,
          options: s.options,
        }));
        // Add to first section
        const firstSection = schema.sections[0];
        if (firstSection) {
          updateSection(firstSection.id, {
            fields: [...firstSection.fields, ...newFields],
          });
        }
        toast.success(`AI แนะนำมา ${newFields.length} field · ลบของที่ไม่เอาออกได้`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  if (showPreview) {
    return (
      <div className="rounded-3xl border-2 border-[var(--color-brand-200)] bg-white">
        <div className="flex items-center justify-between p-4 border-b border-zinc-100">
          <p className="font-bold text-zinc-900 text-sm">
            👁 Preview · ผู้สมัครจะเห็นแบบนี้
          </p>
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className="text-xs text-[var(--color-brand-700)] hover:underline"
          >
            ← กลับไปแก้ฟอร์ม
          </button>
        </div>
        <div className="p-5 max-w-2xl mx-auto">
          <PublicFormRenderer
            schema={schema}
            jobTitle={jobTitle ?? "ตัวอย่างตำแหน่ง"}
            companyName="Pooilgroup"
            onSubmit={() => {}}
            disabled
            preview
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-zinc-200 bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-100 flex-wrap">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
            ฟอร์มรับสมัคร
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {schema.sections.reduce((s, sec) => s + sec.fields.length, 0)} field ·
            ฟอร์มฝั่งซ้าย · เพิ่ม field ฝั่งขวา
          </p>
        </div>
        {!readonly && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={runAISuggest}
              disabled={pendingAI}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-brand-700)] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] px-3 py-2 rounded-lg hover:bg-[var(--color-brand-100)] disabled:opacity-40"
            >
              <Sparkles className="size-3.5" />
              {pendingAI ? "กำลังคิด..." : "AI แนะนำ field"}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 border border-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-50"
            >
              <Eye className="size-3.5" />
              Preview
            </button>
          </div>
        )}
      </div>

      {/* 2-pane: form canvas (left) | field palette (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px]">
        {/* CANVAS */}
        <div className="p-4 sm:p-5 space-y-5 lg:border-r border-zinc-100">
          {schema.sections.map((section, secIdx) => (
            <SectionEditor
              key={section.id}
              section={section}
              secIdx={secIdx}
              schema={schema}
              readonly={readonly}
              selectedFieldId={selectedFieldId}
              onSelectField={setSelectedFieldId}
              onUpdateSection={(p) => updateSection(section.id, p)}
              onRemoveSection={() => removeSection(section.id)}
              onAddField={(t) => addField(section.id, t)}
              onUpdateField={(fid, p) => updateField(section.id, fid, p)}
              onRemoveField={(fid) => removeField(section.id, fid)}
              onMoveField={(fid, dir) => moveField(section.id, fid, dir)}
              onDuplicateField={(fid) => duplicateField(section.id, fid)}
            />
          ))}
          {!readonly && (
            <button
              type="button"
              onClick={addSection}
              className="w-full rounded-2xl border-2 border-dashed border-zinc-300 px-4 py-3 text-sm font-bold text-zinc-500 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)] transition-colors"
            >
              + เพิ่มส่วน (section)
            </button>
          )}
        </div>

        {/* PALETTE */}
        {!readonly && (
          <aside className="p-3 bg-zinc-50/40 border-t lg:border-t-0 lg:border-l border-zinc-100">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold mb-2 px-1.5">
              ชนิด field
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5">
              {FIELD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const firstSec = schema.sections[0];
                    if (firstSec) addField(firstSec.id, t);
                  }}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-zinc-700 hover:bg-white hover:border-[var(--color-brand-400)] border border-transparent transition-colors text-left"
                  title={`เพิ่ม field ${FIELD_TYPE_LABELS[t]}`}
                >
                  <span className="text-base">{FIELD_TYPE_ICONS[t]}</span>
                  <span className="font-medium truncate">
                    {FIELD_TYPE_LABELS[t]}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400 mt-3 px-1.5 leading-relaxed">
              คลิกชนิดเพื่อเพิ่ม field เข้าส่วนแรก หรือกด + ในแต่ละ section
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

interface SectionEditorProps {
  section: FormSection;
  secIdx: number;
  schema: FormSchema;
  readonly?: boolean;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onUpdateSection: (p: Partial<FormSection>) => void;
  onRemoveSection: () => void;
  onAddField: (t: FieldType) => void;
  onUpdateField: (fid: string, p: Partial<Field>) => void;
  onRemoveField: (fid: string) => void;
  onMoveField: (fid: string, dir: -1 | 1) => void;
  onDuplicateField: (fid: string) => void;
}

function SectionEditor({
  section,
  secIdx,
  schema,
  readonly,
  selectedFieldId,
  onSelectField,
  onUpdateSection,
  onRemoveSection,
  onAddField,
  onUpdateField,
  onRemoveField,
  onMoveField,
  onDuplicateField,
}: SectionEditorProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/30">
      {/* Section header */}
      <div className="flex items-center gap-2 p-3 border-b border-zinc-200 bg-white rounded-t-2xl">
        <span className="text-xs text-zinc-400 font-bold tabular-num">
          {String(secIdx + 1).padStart(2, "0")} ·
        </span>
        <input
          type="text"
          value={section.title}
          onChange={(e) => onUpdateSection({ title: e.target.value })}
          disabled={readonly}
          className="flex-1 text-sm font-bold text-zinc-900 bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] rounded px-1"
          placeholder="ชื่อส่วน"
          maxLength={100}
        />
        {!readonly && schema.sections.length > 1 && (
          <button
            type="button"
            onClick={onRemoveSection}
            className="text-zinc-400 hover:text-red-600"
            title="ลบส่วนนี้"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {/* Fields */}
      <div className="p-3 space-y-2">
        {section.fields.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-400 border-2 border-dashed border-zinc-200 rounded-xl">
            ยังไม่มี field · กดปุ่มฝั่งขวา หรือเลือก type ด้านล่าง
          </div>
        ) : (
          section.fields.map((field, idx) => (
            <FieldRow
              key={field.id}
              field={field}
              isFirst={idx === 0}
              isLast={idx === section.fields.length - 1}
              selected={selectedFieldId === field.id}
              readonly={readonly}
              onSelect={() => onSelectField(field.id)}
              onUpdate={(p) => onUpdateField(field.id, p)}
              onRemove={() => onRemoveField(field.id)}
              onMove={(d) => onMoveField(field.id, d)}
              onDuplicate={() => onDuplicateField(field.id)}
            />
          ))
        )}
        {!readonly && (
          <FieldTypePicker onAdd={onAddField} />
        )}
      </div>
    </div>
  );
}

function FieldTypePicker({ onAdd }: { onAdd: (t: FieldType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-xs font-bold text-zinc-600 hover:text-[var(--color-brand-700)] border border-dashed border-zinc-300 hover:border-[var(--color-brand-400)] rounded-xl py-2 transition-colors"
      >
        + เพิ่ม field ในส่วนนี้
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-xl border border-zinc-200 bg-white shadow-lg p-1.5 grid grid-cols-2 gap-1">
          {FIELD_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onAdd(t);
                setOpen(false);
              }}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-zinc-700 hover:bg-[var(--color-brand-50)] text-left"
            >
              <span>{FIELD_TYPE_ICONS[t]}</span>
              <span>{FIELD_TYPE_LABELS[t]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FieldRowProps {
  field: Field;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  readonly?: boolean;
  onSelect: () => void;
  onUpdate: (p: Partial<Field>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
}

function FieldRow({
  field,
  isFirst,
  isLast,
  selected,
  readonly,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
  onDuplicate,
}: FieldRowProps) {
  return (
    <div
      className={`rounded-xl border bg-white p-3 transition-all ${
        selected
          ? "border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-200)]"
          : "border-zinc-200 hover:border-zinc-300"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <span className="text-zinc-400 mt-0.5 cursor-grab">
          <GripVertical className="size-4" />
        </span>
        <span className="text-lg shrink-0">
          {FIELD_TYPE_ICONS[field.type]}
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            disabled={readonly}
            className="w-full text-sm font-bold text-zinc-900 bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] rounded px-1"
            placeholder="ชื่อ field"
            onClick={(e) => e.stopPropagation()}
            maxLength={200}
          />

          {/* Inline editor when selected */}
          {selected && (
            <div className="space-y-2 mt-2 pt-2 border-t border-zinc-100">
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => onUpdate({ required: e.target.checked })}
                    disabled={readonly}
                    className="rounded"
                  />
                  <span className="text-zinc-600">บังคับ</span>
                </label>
                <span className="text-zinc-300">|</span>
                <span className="text-zinc-500">
                  {FIELD_TYPE_LABELS[field.type]}
                </span>
              </div>

              <input
                type="text"
                value={field.helpText ?? ""}
                onChange={(e) => onUpdate({ helpText: e.target.value })}
                disabled={readonly}
                placeholder="คำอธิบายใต้ field (เช่น 'กรอกตามบัตรประชาชน')"
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
                onClick={(e) => e.stopPropagation()}
                maxLength={500}
              />

              {/* Type-specific options */}
              {(field.type === "short_text" || field.type === "long_text") && (
                <select
                  value={field.format ?? ""}
                  onChange={(e) =>
                    onUpdate({
                      format: (e.target.value || undefined) as Field["format"],
                    })
                  }
                  disabled={readonly}
                  className="text-xs px-2 py-1.5 rounded-lg border border-zinc-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">— format ปกติ —</option>
                  <option value="phone">เบอร์โทร</option>
                  <option value="email">อีเมล</option>
                  <option value="thai_id">บัตรประชาชน</option>
                  <option value="url">URL</option>
                </select>
              )}

              {(field.type === "number" || field.type === "range") && (
                <div className="grid grid-cols-3 gap-1 text-xs">
                  <input
                    type="number"
                    placeholder="min"
                    value={field.min ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        min: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    disabled={readonly}
                    className="px-2 py-1.5 rounded-lg border border-zinc-200"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <input
                    type="number"
                    placeholder="max"
                    value={field.max ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        max: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    disabled={readonly}
                    className="px-2 py-1.5 rounded-lg border border-zinc-200"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <input
                    type="text"
                    placeholder="หน่วย (เช่น บาท)"
                    value={field.unit ?? ""}
                    onChange={(e) => onUpdate({ unit: e.target.value })}
                    disabled={readonly}
                    className="px-2 py-1.5 rounded-lg border border-zinc-200"
                    onClick={(e) => e.stopPropagation()}
                    maxLength={20}
                  />
                </div>
              )}

              {(field.type === "dropdown" ||
                field.type === "radio" ||
                field.type === "checkbox") && (
                <OptionsEditor
                  options={field.options ?? []}
                  onChange={(opts) => onUpdate({ options: opts })}
                  readonly={readonly}
                />
              )}
            </div>
          )}
        </div>

        {!readonly && (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove(-1);
              }}
              disabled={isFirst}
              className="text-zinc-400 hover:text-zinc-900 disabled:opacity-30"
              title="เลื่อนขึ้น"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove(1);
              }}
              disabled={isLast}
              className="text-zinc-400 hover:text-zinc-900 disabled:opacity-30"
              title="เลื่อนลง"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              className="text-zinc-400 hover:text-zinc-900"
              title="ทำสำเนา"
            >
              <Copy className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("ลบ field นี้?")) onRemove();
              }}
              className="text-zinc-400 hover:text-red-600"
              title="ลบ"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  readonly,
}: {
  options: Array<{ value: string; label: string }>;
  onChange: (opts: Array<{ value: string; label: string }>) => void;
  readonly?: boolean;
}) {
  const [input, setInput] = useState("");

  function addOption() {
    const t = input.trim();
    if (!t) return;
    onChange([...options, { value: t.toLowerCase().replace(/\s+/g, "_"), label: t }]);
    setInput("");
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold">
        ตัวเลือก
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">ยังไม่มีตัวเลือก</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {options.map((o, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
            >
              {o.label}
              {!readonly && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(options.filter((_, idx) => idx !== i));
                  }}
                  className="hover:text-red-700"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!readonly && (
        <div className="flex gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOption();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="พิมพ์ตัวเลือก + Enter"
            className="text-xs px-2 py-1 rounded-lg border border-zinc-200 flex-1 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            maxLength={100}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              addOption();
            }}
            className="text-xs px-2 py-1 rounded-lg bg-[var(--color-brand-100)] text-[var(--color-brand-800)] hover:bg-[var(--color-brand-200)]"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function makeDefaultField(type: FieldType, id: string): Field {
  const base: Field = {
    id,
    type,
    label: `${FIELD_TYPE_LABELS[type]} ข้อใหม่`,
    required: false,
  };
  if (type === "dropdown" || type === "radio" || type === "checkbox") {
    base.options = [
      { value: "opt1", label: "ตัวเลือก 1" },
      { value: "opt2", label: "ตัวเลือก 2" },
    ];
  }
  if (type === "range") {
    base.min = 0;
    base.max = 100;
    base.step = 1;
  }
  if (type === "file") {
    base.accept = ["pdf", "doc", "docx", "jpg", "png"];
    base.maxFiles = 3;
  }
  return base;
}

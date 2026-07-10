"use client";

// ProjectPicker — แท็บ "โครงการ" (job-costing · F2) แบบ 1 แตะ · เลือกได้/ล้างได้.
// เป็นเปลือกบาง ๆ ครอบ SearchableSelect (ชุด UI เดิม) — ไม่มี component family ใหม่.
// - optional เสมอ (มีตัวเลือก "ไม่ระบุโครงการ" = ล้างแท็ก · onChange(null))
// - searchable ในตัว (SearchableSelect มี 🔍 อยู่แล้ว)
// value = projectId ("" = ยังไม่ผูกโครงการ) · onChange คืน id หรือ null (เมื่อล้าง).

import { SearchableSelect } from "./SearchableSelect";

export interface ProjectOption {
  value: string;
  label: string;
}

// sentinel ของตัวเลือก "ล้างโครงการ" — ไม่ชนกับ uuid จริง.
const CLEAR = "__clear_project__";

export function ProjectPicker({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "— ไม่ระบุโครงการ —",
  className,
}: {
  /** projectId ปัจจุบัน ("" = ยังไม่ผูก). */
  value: string;
  options: ProjectOption[];
  /** คืน projectId ที่เลือก หรือ null เมื่อผู้ใช้เลือก "ไม่ระบุโครงการ". */
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  // แปลง option → รูป SelectOpt {id,name} + แทรก "＋ ไม่ระบุโครงการ" ไว้บนสุด (เฉพาะตอนมีค่าอยู่
  // = ให้ล้างได้). ถ้ายังไม่ผูก ตัว placeholder ของ select (value="") ทำหน้าที่ "ไม่ระบุ" อยู่แล้ว.
  const opts = [
    ...(value ? [{ id: CLEAR, name: "＋ ไม่ระบุโครงการ (ล้างแท็ก)" }] : []),
    ...options.map((o) => ({ id: o.value, name: o.label })),
  ];

  return (
    <SearchableSelect
      options={opts}
      value={value}
      onChange={(id) => onChange(id === CLEAR || id === "" ? null : id)}
      placeholder={placeholder}
      searchPlaceholder="ค้นหาโครงการ..."
      label="โครงการ"
      disabled={disabled}
      className={className}
    />
  );
}

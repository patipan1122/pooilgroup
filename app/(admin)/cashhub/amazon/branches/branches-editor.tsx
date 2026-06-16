"use client";

// หน้าจัดการสาขา Café Amazon — เพิ่ม/แก้/ลบ. หัวใจ = ดึงค่าตั้งบัญชีจาก TRCloud อัตโนมัติ.
// flow เพิ่มสาขา: พิมพ์ชื่อ → "ค้นจาก TRCloud" → เลือกสาขาที่เจอ (ระบบเติมบัญชีให้) → ปรับชื่อจับคู่ → บันทึก.
import { useState } from "react";
import { useRouter } from "next/navigation";

type UiBranch = {
  id: string | null;
  builtin: boolean;
  isActive: boolean;
  storeCode: string;
  nameMatch: string;
  aliases?: string[];
  label: string;
  type: string;
  project: string;
  department: string;
  contactId: string;
  groupCode: string;
  codeNumber: string;
  customerName: string;
  productId: string;
  productName: string;
  unit: string;
};

type ProbedBranch = {
  type: string;
  project: string;
  department: string;
  contactId: string;
  groupCode: string;
  codeNumber: string;
  customerName: string;
  branchField: string;
  suggestedNameMatch: string;
  lastIvNo: string;
  lastIvDate: string;
  ivCount: number;
};

type FormState = {
  id: string | null;
  storeCode: string;
  nameMatch: string;
  aliasesText: string;
  label: string;
  type: string;
  project: string;
  department: string;
  contactId: string;
  groupCode: string;
  codeNumber: string;
  customerName: string;
  productId: string;
  productName: string;
  unit: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  storeCode: "",
  nameMatch: "",
  aliasesText: "",
  label: "",
  type: "",
  project: "",
  department: "",
  contactId: "",
  groupCode: "",
  codeNumber: "",
  customerName: "",
  productId: "P-00005",
  productName: "กาแฟ CAFE AMAZON",
  unit: "วัน",
};

export function BranchesEditor({ branches }: { branches: UiBranch[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"list" | "form">("list");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // probe state
  const [keyword, setKeyword] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [results, setResults] = useState<ProbedBranch[] | null>(null);

  const accountingSet = form.type !== "" && form.project !== "";

  function startAdd() {
    setForm(EMPTY_FORM);
    setKeyword("");
    setResults(null);
    setProbeErr(null);
    setErr(null);
    setMode("form");
  }

  function startEdit(b: UiBranch) {
    setForm({
      id: b.id,
      storeCode: b.storeCode,
      nameMatch: b.nameMatch,
      aliasesText: (b.aliases ?? []).join(", "),
      label: b.label,
      type: b.type,
      project: b.project,
      department: b.department,
      contactId: b.contactId,
      groupCode: b.groupCode,
      codeNumber: b.codeNumber,
      customerName: b.customerName,
      productId: b.productId,
      productName: b.productName,
      unit: b.unit,
    });
    setKeyword("");
    setResults(null);
    setProbeErr(null);
    setErr(null);
    setMode("form");
  }

  async function runProbe() {
    if (keyword.trim().length < 2) {
      setProbeErr("พิมพ์ชื่อสาขาอย่างน้อย 2 ตัวอักษร");
      return;
    }
    setProbing(true);
    setProbeErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/cashhub/amazon-branch/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProbeErr(data.error ?? "ค้นหาไม่สำเร็จ");
        return;
      }
      setResults(data.branches as ProbedBranch[]);
    } catch {
      setProbeErr("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setProbing(false);
    }
  }

  function pickProbed(p: ProbedBranch) {
    const aliasParts = [p.branchField.replace(/^สาขา\s*/, "").trim()].filter(
      (a) => a && a !== p.suggestedNameMatch,
    );
    setForm((f) => ({
      ...f,
      type: p.type,
      project: p.project,
      department: p.department,
      contactId: p.contactId,
      groupCode: p.groupCode,
      codeNumber: p.codeNumber,
      customerName: p.customerName,
      label: f.label || p.suggestedNameMatch || p.customerName,
      nameMatch: f.nameMatch || p.suggestedNameMatch,
      aliasesText: f.aliasesText || aliasParts.join(", "),
    }));
    setResults(null);
  }

  async function save() {
    setErr(null);
    if (!accountingSet) {
      setErr("ยังไม่ได้ดึงค่าบัญชีจาก TRCloud — กด “ค้นหาจาก TRCloud” แล้วเลือกสาขาก่อน");
      return;
    }
    if (!form.label.trim() || !form.nameMatch.trim()) {
      setErr("กรอกชื่อสาขา และชื่อจับคู่ไฟล์ POS ก่อน");
      return;
    }
    setBusy(true);
    try {
      const aliases = form.aliasesText
        .split(/[,\n]/)
        .map((a) => a.trim())
        .filter(Boolean);
      const res = await fetch("/api/cashhub/amazon-branch/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: {
            storeCode: form.storeCode.trim(),
            nameMatch: form.nameMatch.trim(),
            aliases,
            label: form.label.trim(),
            type: form.type,
            project: form.project,
            department: form.department,
            contactId: form.contactId,
            groupCode: form.groupCode,
            codeNumber: form.codeNumber,
            customerName: form.customerName,
            productId: form.productId,
            productName: form.productName,
            unit: form.unit,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setMode("list");
      router.refresh();
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  async function del(b: UiBranch) {
    if (!b.id) return;
    if (!window.confirm(`ลบสาขา “${b.label}” ออกจากระบบ?\n(ยอดที่เคยเซฟไม่หาย — แค่เลิกจับคู่ไฟล์ใหม่)`))
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/cashhub/amazon-branch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error ?? "ลบไม่สำเร็จ");
        return;
      }
      router.refresh();
    } catch {
      window.alert("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  // ───────────────────────── LIST ─────────────────────────
  if (mode === "list") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            onClick={startAdd}
            className="h-10 rounded-xl bg-emerald-600 text-white font-semibold px-5 text-sm hover:bg-emerald-700"
          >
            ➕ เพิ่มสาขา
          </button>
        </div>

        <div className="space-y-2.5">
          {branches.map((b) => (
            <div
              key={b.id ?? b.project}
              className="rounded-2xl border border-zinc-200 bg-white p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-zinc-900">{b.label}</span>
                  {b.builtin ? (
                    <span className="text-[11px] rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5">
                      มากับระบบ
                    </span>
                  ) : (
                    <span className="text-[11px] rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">
                      เพิ่มเอง
                    </span>
                  )}
                  {b.storeCode && (
                    <span className="text-[11px] rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">
                      รหัส {b.storeCode}
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-1 space-y-0.5">
                  <div>จับคู่ไฟล์ด้วยชื่อ: <span className="text-zinc-700">{b.nameMatch}</span>
                    {b.aliases && b.aliases.length > 0 && (
                      <span className="text-zinc-400"> · หรือ {b.aliases.join(", ")}</span>
                    )}
                  </div>
                  <div className="text-zinc-400">สูตรบัญชี: {b.type}</div>
                </div>
              </div>
              {!b.builtin && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => startEdit(b)}
                    className="text-xs rounded-lg border border-zinc-200 px-3 py-1.5 font-medium hover:bg-zinc-50"
                  >
                    แก้ไข
                  </button>
                  <button
                    onClick={() => del(b)}
                    disabled={busy}
                    className="text-xs rounded-lg border border-red-200 text-red-600 px-3 py-1.5 font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    ลบ
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ───────────────────────── FORM ─────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-900">
          {form.id ? "แก้ไขสาขา" : "เพิ่มสาขาใหม่"}
        </h2>
        <button
          onClick={() => setMode("list")}
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← กลับรายการ
        </button>
      </div>

      {/* STEP 1 · ดึงจาก TRCloud */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-semibold text-zinc-800 mb-1">
          1. ดึงค่าบัญชีจาก TRCloud
        </div>
        <p className="text-xs text-zinc-500 mb-3">
          พิมพ์ชื่อสาขา (เช่น “ตลาดจักราช”) แล้วกดค้นหา — ระบบจะดึง สูตรบัญชี/โครงการ/แผนก/รหัสคู่ค้า
          จากใบกำกับจริงให้ ไม่ต้องพิมพ์รหัสเอง
        </p>
        <div className="flex gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runProbe()}
            placeholder="ชื่อสาขาใน TRCloud"
            className="flex-1 h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
          />
          <button
            onClick={runProbe}
            disabled={probing}
            className="h-10 rounded-xl bg-zinc-900 text-white font-semibold px-4 text-sm disabled:opacity-50"
          >
            {probing ? "กำลังค้น…" : "🔎 ค้นหา"}
          </button>
        </div>
        {probeErr && <p className="text-xs text-red-600 mt-2">{probeErr}</p>}

        {results && results.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-zinc-500">เจอ {results.length} สาขา — เลือกสาขาที่ใช่:</div>
            {results.map((p) => (
              <button
                key={p.project}
                onClick={() => pickProbed(p)}
                className="w-full text-left rounded-xl border border-zinc-200 hover:border-emerald-400 hover:bg-emerald-50/40 p-3 transition-colors"
              >
                <div className="font-medium text-zinc-900 text-sm">{p.customerName}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  โครงการ {p.project} · {p.type}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  {p.branchField && `branch: ${p.branchField} · `}
                  คู่ค้า {p.groupCode}{p.codeNumber} · ใบล่าสุด {p.lastIvNo || "-"} ({p.lastIvDate || "-"}) · พบ {p.ivCount} ใบ
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* STEP 2 · ปรับชื่อจับคู่ + บันทึก */}
      {accountingSet && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
          <div className="text-sm font-semibold text-zinc-800">2. ตรวจ + บันทึก</div>

          {/* บัญชีที่ดึงมา (ล็อก) */}
          <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-3">
            <div className="text-xs font-semibold text-emerald-700 mb-1.5">
              ✓ ค่าบัญชีจาก TRCloud (ระบบกรอกให้ — ห้ามแก้เอง)
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-600">
              <div><dt className="inline text-zinc-400">สูตร: </dt>{form.type}</div>
              <div><dt className="inline text-zinc-400">โครงการ: </dt>{form.project}</div>
              <div><dt className="inline text-zinc-400">แผนก: </dt>{form.department}</div>
              <div><dt className="inline text-zinc-400">contact: </dt>{form.contactId}</div>
              <div><dt className="inline text-zinc-400">รหัสคู่ค้า: </dt>{form.groupCode}{form.codeNumber}</div>
              <div className="col-span-2"><dt className="inline text-zinc-400">ลูกค้า: </dt>{form.customerName}</div>
            </dl>
          </div>

          {/* ฟิลด์ที่ CEO แก้ได้ */}
          <Field label="ชื่อสาขา (แสดงในระบบ)" value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} />
          <Field
            label="ชื่อที่ใช้จับคู่ไฟล์ POS"
            hint="ต้องเป็นคำที่ปรากฏในชื่อสาขาที่ขึ้นในไฟล์ปิดกะ POS"
            value={form.nameMatch}
            onChange={(v) => setForm((f) => ({ ...f, nameMatch: v }))}
          />
          <Field
            label="ชื่อเรียกอื่น (ถ้ามี)"
            hint="ถ้า POS เรียกชื่อต่างจาก TRCloud ใส่เพิ่มได้ คั่นด้วยจุลภาค ( , )"
            value={form.aliasesText}
            onChange={(v) => setForm((f) => ({ ...f, aliasesText: v }))}
          />
          <Field
            label="รหัสสาขา POS (ไม่บังคับ)"
            hint="ใส่ถ้ารู้รหัสจากไฟล์ — ไม่ใส่ก็ได้ ระบบจับคู่ด้วยชื่อ"
            value={form.storeCode}
            onChange={(v) => setForm((f) => ({ ...f, storeCode: v }))}
          />

          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy}
              className="h-10 rounded-xl bg-emerald-600 text-white font-semibold px-6 text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "กำลังบันทึก…" : "บันทึกสาขา"}
            </button>
            <button
              onClick={() => setMode("list")}
              className="h-10 rounded-xl border border-zinc-200 px-5 text-sm font-medium hover:bg-zinc-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {!accountingSet && (
        <p className="text-xs text-zinc-400">
          ↑ ค้นหาและเลือกสาขาจาก TRCloud ก่อน เพื่อให้ระบบเติมค่าบัญชีให้
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      {hint && <span className="block text-[11px] text-zinc-400 mb-1">{hint}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full h-10 rounded-xl border border-zinc-200 px-3 text-sm bg-white"
      />
    </label>
  );
}

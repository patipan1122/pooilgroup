"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Trash2, FileText, Eye, GitBranch } from "lucide-react";
import { actSaveTemplate, actDeleteTemplate, actCreateTemplateVersion } from "../../../_actions";
import { TEMPLATE_VARS, contractPlaceholders, fillPlaceholders } from "@/lib/rentspace/contract-doc";

type Template = {
  id: string;
  name: string;
  bodyHtml: string;
  isDefault: boolean;
  version: number;
  changelog?: string | null;
  familyKey?: string | null;
};

// ค่าตัวอย่างสำหรับพรีวิวแม่แบบ (เติมตัวแปรจริงให้เห็นหน้าตาก่อนบันทึก)
const SAMPLE_VALUES = contractPlaceholders({
  rentAmountThb: 12000,
  depositAmountThb: 24000,
  depositMonths: 2,
  rentDueDay: 5,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  contractNo: "CT2026-0001",
  vatPercent: 0,
  electricRate: 8,
  waterRate: 18,
  lateFeeType: "fixed",
  lateFeeValue: 500,
  promoDiscountThb: 0,
  unit: { code: "A101", name: "ร้านตัวอย่าง" },
  tenant: {
    bizName: "บริษัท ตัวอย่าง จำกัด",
    idCardNo: "1234567890123",
    address: "123 ถนนตัวอย่าง ต.ในเมือง อ.เมือง",
    phones: ["081-234-5678"],
  } as never,
  project: { name: "โครงการตัวอย่าง", address: "456 ถนนโครงการ", electricRate: 8, waterRate: 18 },
});

export const DEFAULT_TEMPLATE_HTML = `<h2 style="text-align:center">สัญญาเช่าพื้นที่ / ห้องเช่าเพื่อการพาณิชย์</h2>
<p style="text-align:right">ทำที่ {{projectName}}<br/>วันที่ {{today}}</p>

<p>สัญญาฉบับนี้ทำขึ้นระหว่าง <b>{{projectName}}</b> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <b>{{tenantName}}</b> ("ผู้เช่า") อีกฝ่ายหนึ่ง คู่สัญญาทั้งสองฝ่ายตกลงกันดังต่อไปนี้</p>

<p><b>ข้อ 1. ทรัพย์สินที่เช่า</b><br/>ผู้ให้เช่าตกลงให้เช่าพื้นที่/ห้องเลขที่ <b>{{unitCode}}</b> ภายในโครงการ {{projectName}} เพื่อใช้ประกอบกิจการตามที่ผู้เช่าแจ้งไว้</p>

<p><b>ข้อ 2. ระยะเวลาเช่า</b><br/>มีกำหนดตั้งแต่วันที่ {{startDate}} ถึงวันที่ {{endDate}}</p>

<p><b>ข้อ 3. ค่าเช่า</b><br/>ผู้เช่าตกลงชำระค่าเช่าเดือนละ <b>{{rentAmount}}</b> โดยชำระภายในกำหนดของแต่ละเดือน</p>

<p><b>ข้อ 4. เงินประกัน</b><br/>ผู้เช่าวางเงินประกันจำนวน <b>{{depositAmount}}</b> ให้แก่ผู้ให้เช่าในวันทำสัญญา เพื่อเป็นหลักประกันการปฏิบัติตามสัญญา ผู้ให้เช่าจะคืนเงินประกันเมื่อสิ้นสุดสัญญาและผู้เช่าส่งมอบพื้นที่คืนในสภาพเรียบร้อย หักด้วยค่าเสียหาย/ค่าใช้จ่ายค้างชำระ (ถ้ามี)</p>

<p><b>ข้อ 5. ค่าน้ำ ค่าไฟ และค่าใช้จ่ายอื่น</b><br/>ผู้เช่าเป็นผู้รับผิดชอบค่าน้ำประปา (หน่วยละ {{waterRate}} บาท) ค่าไฟฟ้า (หน่วยละ {{electricRate}} บาท) และค่าใช้จ่ายส่วนกลางตามที่เกิดขึ้นจริงในแต่ละเดือน</p>

<p><b>ข้อ 6. การบำรุงรักษา</b><br/>ผู้เช่าจะดูแลรักษาพื้นที่เช่าให้อยู่ในสภาพดี และไม่ดัดแปลง ต่อเติม โดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า</p>

<p><b>ข้อ 7. การผิดสัญญา</b><br/>หากผู้เช่าผิดนัดชำระค่าเช่าหรือผิดเงื่อนไขข้อหนึ่งข้อใด ผู้ให้เช่ามีสิทธิบอกเลิกสัญญาและเรียกค่าเสียหายได้</p>

<p>คู่สัญญาได้อ่านและเข้าใจข้อความในสัญญาโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นสำคัญ</p>

<table style="width:100%;margin-top:32px">
  <tr>
    <td style="text-align:center">ลงชื่อ ........................................<br/>( ผู้ให้เช่า )</td>
    <td style="text-align:center">ลงชื่อ ........................................<br/>( {{tenantName}} )<br/>ผู้เช่า</td>
  </tr>
</table>`;

export function TemplateEditor({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  // โหมด "สร้างเวอร์ชันใหม่" — ต้นทางที่จะก๊อปเนื้อหามาแก้ (null = ไม่ได้อยู่โหมดนี้)
  const [versioning, setVersioning] = useState<Template | null>(null);

  const [name, setName] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [changelog, setChangelog] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // จัดกลุ่มแม่แบบตามสาย (familyKey) — เวอร์ชันใหม่สุดขึ้นก่อน · เดี่ยว (familyKey=null) = กลุ่มละใบ
  const groups = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      const key = t.familyKey ?? `solo:${t.id}`;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    const list = Array.from(map.values()).map((items) => [...items].sort((a, b) => b.version - a.version));
    // กลุ่มที่มีค่าเริ่มต้นขึ้นก่อน แล้วเรียงตามชื่อ
    list.sort((a, b) => {
      const ad = a.some((t) => t.isDefault) ? 0 : 1;
      const bd = b.some((t) => t.isDefault) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a[0].name.localeCompare(b[0].name, "th");
    });
    return list;
  }, [templates]);

  function openNew() {
    setVersioning(null);
    setEditing("new");
    setName("");
    setBodyHtml("");
    setChangelog("");
    setIsDefault(templates.length === 0);
  }
  function openEdit(t: Template) {
    setVersioning(null);
    setEditing(t);
    setName(t.name);
    setBodyHtml(t.bodyHtml);
    setChangelog(t.changelog ?? "");
    setIsDefault(t.isDefault);
  }
  // เปิดตัวแก้ไขแบบ "เวอร์ชันใหม่": ก๊อปเนื้อหาเดิมมาแก้ · เวอร์ชันเก่ายังอยู่ครบ
  function openVersion(t: Template) {
    setEditing(null);
    setVersioning(t);
    setName(t.name);
    setBodyHtml(t.bodyHtml);
    setChangelog("");
    setIsDefault(t.isDefault);
  }
  function closeEditor() {
    setEditing(null);
    setVersioning(null);
  }

  function save() {
    if (!name.trim()) return toast.error("กรุณาตั้งชื่อแม่แบบ");
    const body = bodyHtml.trim() || DEFAULT_TEMPLATE_HTML;
    start(async () => {
      try {
        if (versioning) {
          const r = await actCreateTemplateVersion({
            fromId: versioning.id,
            bodyHtml: body,
            name: name.trim(),
            changelog: changelog.trim() || undefined,
            setDefault: isDefault,
          });
          toast.success(`สร้างเวอร์ชัน v${r.version} แล้ว`);
        } else {
          await actSaveTemplate({
            id: editing && editing !== "new" ? editing.id : undefined,
            name: name.trim(),
            bodyHtml: body,
            isDefault,
            changelog: changelog.trim() || undefined,
          });
          toast.success("บันทึกแม่แบบแล้ว");
        }
        closeEditor();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }
  function del(t: Template) {
    if (!confirm(`ลบแม่แบบ "${t.name}"?`)) return;
    start(async () => {
      try {
        await actDeleteTemplate(t.id);
        toast.success("ลบแม่แบบแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="rs-btn" onClick={openNew}>
          <Plus className="h-4 w-4" /> แม่แบบใหม่
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rs-card p-8 text-center">
          <FileText className="h-8 w-8 mx-auto mb-2" style={{ color: "var(--rs-text-3)" }} />
          <div className="font-semibold" style={{ color: "var(--rs-text)" }}>
            ยังไม่มีแม่แบบสัญญา
          </div>
          <p className="text-[13px] mt-1" style={{ color: "var(--rs-text-2)" }}>
            สร้างแม่แบบไว้ใช้ซ้ำกับทุกสัญญา — ระบบจะเติมชื่อผู้เช่า ค่าเช่า วันที่ ให้อัตโนมัติ
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((items) => {
            const head = items[0]; // เวอร์ชันใหม่สุด = ตัวหลักของสาย
            const older = items.slice(1);
            return (
              <div key={head.familyKey ?? head.id} className="rs-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold flex items-center gap-2 flex-wrap" style={{ color: "var(--rs-text)" }}>
                      {head.name}
                      {head.version > 1 && (
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
                          style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-2)" }}
                        >
                          v{head.version}
                        </span>
                      )}
                      {head.isDefault && (
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                        >
                          ค่าเริ่มต้น
                        </span>
                      )}
                    </div>
                    {head.changelog && (
                      <div className="text-[12px] mt-1" style={{ color: "var(--rs-text-3)" }}>
                        {head.changelog}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0" onClick={() => openEdit(head)}>
                      แก้ไข
                    </button>
                    <button className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0" onClick={() => openVersion(head)}>
                      <GitBranch className="h-4 w-4" /> สร้างเวอร์ชันใหม่
                    </button>
                    <button className="inline-flex size-11 sm:size-9 items-center justify-center rounded-lg hover:bg-black/5" onClick={() => del(head)} disabled={pending} aria-label="ลบแม่แบบ">
                      <Trash2 className="h-4 w-4" style={{ color: "var(--rs-danger)" }} />
                    </button>
                  </div>
                </div>

                {older.length > 0 && (
                  <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: "var(--rs-border)" }}>
                    <div className="text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }}>
                      เวอร์ชันก่อนหน้า
                    </div>
                    {older.map((o) => (
                      <div key={o.id} className="flex items-start justify-between gap-3 pl-3" style={{ opacity: 0.7 }}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-[13px] font-medium" style={{ color: "var(--rs-text-2)" }}>
                            <span
                              className="text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
                              style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-2)" }}
                            >
                              v{o.version}
                            </span>
                            {o.isDefault && (
                              <span
                                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                              >
                                ค่าเริ่มต้น
                              </span>
                            )}
                          </div>
                          {o.changelog && (
                            <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                              {o.changelog}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0" onClick={() => openEdit(o)}>
                            แก้ไข
                          </button>
                          <button className="inline-flex size-11 sm:size-9 items-center justify-center rounded-lg hover:bg-black/5" onClick={() => del(o)} disabled={pending} aria-label="ลบแม่แบบ">
                            <Trash2 className="h-4 w-4" style={{ color: "var(--rs-danger)" }} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(editing || versioning) && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && closeEditor()}
        >
          <div
            className="rs-card w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ background: "#fff", borderColor: "var(--rs-border)" }}
            >
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                {versioning ? "สร้างเวอร์ชันใหม่" : editing === "new" ? "แม่แบบใหม่" : "แก้ไขแม่แบบ"}
              </div>
              <button onClick={closeEditor} disabled={pending} className="-mr-2 inline-flex size-11 sm:size-9 items-center justify-center rounded-lg hover:bg-black/5" aria-label="ปิด">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {versioning && (
                <div
                  className="rounded-lg p-3 text-[12px]"
                  style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                >
                  ก๊อปเนื้อหาจาก <b>{versioning.name} v{versioning.version}</b> มาแก้เป็นเวอร์ชันใหม่ — เวอร์ชันเดิมยังอยู่ครบ สัญญาเก่าที่ใช้เวอร์ชันนั้นไม่กระทบ
                </div>
              )}
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  ชื่อแม่แบบ
                </label>
                <input className="rs-t-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สัญญาเช่าร้านค้า" />
              </div>

              <div
                className="rounded-lg p-3 text-[12px]"
                style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)", color: "var(--rs-text-2)" }}
              >
                <div className="font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  ตัวแปรที่ใช้ได้ (คลิกเพื่อแทรก) — ระบบเติมค่าจริงให้ตอนออกสัญญา:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARS.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setBodyHtml((b) => `${b}{{${v.key}}}`)}
                      className="rs-chip"
                      title={v.label}
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                    เนื้อหาสัญญา (รองรับ HTML)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold"
                    style={{ color: "var(--rs-brand)" }}
                  >
                    <Eye className="h-4 w-4" /> {showPreview ? "ซ่อนตัวอย่าง" : "ดูตัวอย่าง"}
                  </button>
                </div>
                {showPreview ? (
                  <div
                    className="rounded-lg p-4 min-h-[320px] max-h-[420px] overflow-y-auto text-[13px] leading-relaxed"
                    style={{ border: "1px solid var(--rs-border)", background: "#fff", color: "#111" }}
                    // พรีวิวเนื้อแม่แบบที่ผู้ดูแลเขียนเอง + เติมค่าตัวอย่าง (ไม่ใช่ user input ทั่วไป)
                    dangerouslySetInnerHTML={{
                      __html: fillPlaceholders(bodyHtml.trim() || DEFAULT_TEMPLATE_HTML, SAMPLE_VALUES),
                    }}
                  />
                ) : (
                  <textarea
                    className="rs-t-input font-mono min-h-[320px]"
                    value={bodyHtml}
                    onChange={(e) => setBodyHtml(e.target.value)}
                    placeholder={DEFAULT_TEMPLATE_HTML}
                  />
                )}
                {!showPreview && !bodyHtml.trim() && (
                  <button
                    type="button"
                    className="mt-1.5 text-[12.5px] font-medium"
                    style={{ color: "var(--rs-brand)" }}
                    onClick={() => setBodyHtml(DEFAULT_TEMPLATE_HTML)}
                  >
                    ใช้แม่แบบมาตรฐาน (ภาษาไทย) เป็นจุดเริ่มต้น
                  </button>
                )}
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--rs-text-3)" }}>
                  ตัวอย่างใช้ข้อมูลสมมติ (ค่าเช่า 12,000 · ค่าไฟ 8 · ค่าน้ำ 18) — ของจริงจะเติมตามสัญญาแต่ละใบ
                </p>
              </div>

              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  สรุปการเปลี่ยนแปลง (changelog)
                </label>
                <textarea
                  className="rs-t-input min-h-[60px]"
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="เช่น ปรับข้อ 5 ค่าน้ำ-ค่าไฟ · เพิ่มเงื่อนไขต่อสัญญา (ไม่บังคับ)"
                />
              </div>

              <label className="flex items-center gap-2 text-[13.5px]" style={{ color: "var(--rs-text)" }}>
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                {versioning ? "ตั้งเป็นค่าเริ่มต้น (ใช้กับสัญญาใหม่)" : "ตั้งเป็นแม่แบบค่าเริ่มต้น"}
              </label>
            </div>
            <div className="sticky bottom-0 flex gap-2 px-5 py-3 border-t" style={{ background: "#fff", borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1 min-h-[44px] sm:min-h-0" disabled={pending} onClick={closeEditor}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1 min-h-[44px] sm:min-h-0" disabled={pending} onClick={save}>
                {pending ? "กำลังบันทึก…" : versioning ? "สร้างเวอร์ชันใหม่" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rs-t-input) {
          width: 100%;
          height: 44px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          /* 16px บนมือถือ กัน iOS zoom เวลาแตะ */
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.rs-t-input) {
            height: 42px;
            font-size: 14px;
          }
        }
        :global(textarea.rs-t-input) {
          height: auto;
          padding: 10px 12px;
          line-height: 1.6;
          /* กัน iOS zoom: ใช้ 16px บนมือถือ (ทับ className text-[12.5px]) */
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(textarea.rs-t-input) {
            font-size: 12.5px;
          }
        }
        :global(.rs-t-input:focus) {
          outline: none;
          border-color: var(--rs-brand);
          background: #fff;
        }
      `}</style>
    </div>
  );
}

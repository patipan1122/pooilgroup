"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Trash2, FileText } from "lucide-react";
import { actSaveTemplate, actDeleteTemplate } from "../../../_actions";

type Template = { id: string; name: string; bodyHtml: string; isDefault: boolean };

const PLACEHOLDERS = [
  ["{{tenantName}}", "ชื่อผู้เช่า"],
  ["{{unitCode}}", "ห้อง/ยูนิต"],
  ["{{rentAmount}}", "ค่าเช่า"],
  ["{{startDate}}", "วันเริ่ม"],
  ["{{endDate}}", "วันสิ้นสุด"],
  ["{{depositAmount}}", "เงินประกัน"],
  ["{{projectName}}", "ชื่อโครงการ"],
  ["{{today}}", "วันที่วันนี้"],
];

export const DEFAULT_TEMPLATE_HTML = `<h2 style="text-align:center">สัญญาเช่าพื้นที่ / ห้องเช่าเพื่อการพาณิชย์</h2>
<p style="text-align:right">ทำที่ {{projectName}}<br/>วันที่ {{today}}</p>

<p>สัญญาฉบับนี้ทำขึ้นระหว่าง <b>{{projectName}}</b> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <b>{{tenantName}}</b> ("ผู้เช่า") อีกฝ่ายหนึ่ง คู่สัญญาทั้งสองฝ่ายตกลงกันดังต่อไปนี้</p>

<p><b>ข้อ 1. ทรัพย์สินที่เช่า</b><br/>ผู้ให้เช่าตกลงให้เช่าพื้นที่/ห้องเลขที่ <b>{{unitCode}}</b> ภายในโครงการ {{projectName}} เพื่อใช้ประกอบกิจการตามที่ผู้เช่าแจ้งไว้</p>

<p><b>ข้อ 2. ระยะเวลาเช่า</b><br/>มีกำหนดตั้งแต่วันที่ {{startDate}} ถึงวันที่ {{endDate}}</p>

<p><b>ข้อ 3. ค่าเช่า</b><br/>ผู้เช่าตกลงชำระค่าเช่าเดือนละ <b>{{rentAmount}}</b> โดยชำระภายในกำหนดของแต่ละเดือน</p>

<p><b>ข้อ 4. เงินประกัน</b><br/>ผู้เช่าวางเงินประกันจำนวน <b>{{depositAmount}}</b> ให้แก่ผู้ให้เช่าในวันทำสัญญา เพื่อเป็นหลักประกันการปฏิบัติตามสัญญา ผู้ให้เช่าจะคืนเงินประกันเมื่อสิ้นสุดสัญญาและผู้เช่าส่งมอบพื้นที่คืนในสภาพเรียบร้อย หักด้วยค่าเสียหาย/ค่าใช้จ่ายค้างชำระ (ถ้ามี)</p>

<p><b>ข้อ 5. ค่าน้ำ ค่าไฟ และค่าใช้จ่ายอื่น</b><br/>ผู้เช่าเป็นผู้รับผิดชอบค่าน้ำประปา ค่าไฟฟ้า และค่าใช้จ่ายส่วนกลางตามที่เกิดขึ้นจริงในแต่ละเดือน</p>

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

  const [name, setName] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  function openNew() {
    setEditing("new");
    setName("");
    setBodyHtml("");
    setIsDefault(templates.length === 0);
  }
  function openEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setBodyHtml(t.bodyHtml);
    setIsDefault(t.isDefault);
  }

  function save() {
    if (!name.trim()) return toast.error("กรุณาตั้งชื่อแม่แบบ");
    const body = bodyHtml.trim() || DEFAULT_TEMPLATE_HTML;
    start(async () => {
      try {
        await actSaveTemplate({
          id: editing && editing !== "new" ? editing.id : undefined,
          name: name.trim(),
          bodyHtml: body,
          isDefault,
        });
        toast.success("บันทึกแม่แบบแล้ว");
        setEditing(null);
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
          {templates.map((t) => (
            <div key={t.id} className="rs-card p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2" style={{ color: "var(--rs-text)" }}>
                  {t.name}
                  {t.isDefault && (
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                    >
                      ค่าเริ่มต้น
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="rs-btn rs-btn-ghost" onClick={() => openEdit(t)}>
                  แก้ไข
                </button>
                <button className="p-2 rounded-lg hover:bg-black/5" onClick={() => del(t)} disabled={pending}>
                  <Trash2 className="h-4 w-4" style={{ color: "var(--rs-danger)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && setEditing(null)}
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
                {editing === "new" ? "แม่แบบใหม่" : "แก้ไขแม่แบบ"}
              </div>
              <button onClick={() => setEditing(null)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
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
                  ตัวแปรที่ใช้ได้ (คลิกเพื่อแทรก):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map(([ph, label]) => (
                    <button
                      key={ph}
                      type="button"
                      onClick={() => setBodyHtml((b) => `${b}${ph}`)}
                      className="rs-chip"
                      title={label}
                    >
                      {ph}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  เนื้อหาสัญญา (รองรับ HTML)
                </label>
                <textarea
                  className="rs-t-input font-mono text-[12.5px] min-h-[320px]"
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  placeholder={DEFAULT_TEMPLATE_HTML}
                />
                {!bodyHtml.trim() && (
                  <button
                    type="button"
                    className="mt-1.5 text-[12.5px] font-medium"
                    style={{ color: "var(--rs-brand)" }}
                    onClick={() => setBodyHtml(DEFAULT_TEMPLATE_HTML)}
                  >
                    ใช้แม่แบบมาตรฐาน (ภาษาไทย) เป็นจุดเริ่มต้น
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2 text-[13.5px]" style={{ color: "var(--rs-text)" }}>
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                ตั้งเป็นแม่แบบค่าเริ่มต้น
              </label>
            </div>
            <div className="sticky bottom-0 flex gap-2 px-5 py-3 border-t" style={{ background: "#fff", borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={() => setEditing(null)}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1" disabled={pending} onClick={save}>
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rs-t-input) {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          font-size: 14px;
        }
        :global(textarea.rs-t-input) {
          height: auto;
          padding: 10px 12px;
          line-height: 1.6;
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

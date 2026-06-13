"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, useTransition } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, X, Trash2, Upload, ImageIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import { actSaveTenant, actDeleteTenant, actUploadFile } from "../../_actions";

type EditableTenant = {
  id: string;
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  bizName?: string | null;
  phones?: string[] | null;
  idCardNo?: string | null;
  taxId?: string | null;
  birthDate?: string | Date | null;
  nationality?: string | null;
  address?: string | null;
  email?: string | null;
  facebook?: string | null;
  lineId?: string | null;
  idCardUrl?: string | null;
  docUrls?: string[] | null;
  note?: string | null;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function dateInput(v?: string | Date | null): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function TenantForm({
  tenant,
  triggerLabel,
}: {
  tenant?: EditableTenant | null;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const isEdit = !!tenant;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);

  const [prefix, setPrefix] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [bizName, setBizName] = useState("");
  const [phones, setPhones] = useState("");
  const [email, setEmail] = useState("");
  const [lineId, setLineId] = useState("");
  const [facebook, setFacebook] = useState("");
  const [idCardNo, setIdCardNo] = useState("");
  const [taxId, setTaxId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [nationality, setNationality] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [idCardUrl, setIdCardUrl] = useState("");
  const [docUrls, setDocUrls] = useState<string[]>([]);

  const idCardInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPrefix(tenant?.prefix ?? "");
    setFirstName(tenant?.firstName ?? "");
    setLastName(tenant?.lastName ?? "");
    setNickname(tenant?.nickname ?? "");
    setBizName(tenant?.bizName ?? "");
    setPhones((tenant?.phones ?? []).join(", "));
    setEmail(tenant?.email ?? "");
    setLineId(tenant?.lineId ?? "");
    setFacebook(tenant?.facebook ?? "");
    setIdCardNo(tenant?.idCardNo ?? "");
    setTaxId(tenant?.taxId ?? "");
    setBirthDate(dateInput(tenant?.birthDate));
    setNationality(tenant?.nationality ?? "");
    setAddress(tenant?.address ?? "");
    setNote(tenant?.note ?? "");
    setIdCardUrl(tenant?.idCardUrl ?? "");
    setDocUrls(tenant?.docUrls ?? []);
  }, [open, tenant]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function uploadIdCard(file: File) {
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { url } = await actUploadFile({ sub: "tenant", dataUrl });
      setIdCardUrl(url);
      toast.success("อัปโหลดบัตรประชาชนแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function uploadDocs(files: FileList) {
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const { url } = await actUploadFile({ sub: "tenant", dataUrl });
        urls.push(url);
      }
      setDocUrls((prev) => [...prev, ...urls]);
      toast.success(`อัปโหลด ${urls.length} ไฟล์แล้ว`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  function save() {
    const hasName = firstName.trim() || bizName.trim() || nickname.trim();
    if (!hasName) {
      toast.error("กรุณากรอกชื่อ หรือชื่อร้าน/กิจการ");
      return;
    }
    start(async () => {
      try {
        await actSaveTenant({
          id: tenant?.id,
          prefix: prefix.trim() || undefined,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          nickname: nickname.trim() || undefined,
          bizName: bizName.trim() || undefined,
          phones: phones
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          email: email.trim() || undefined,
          lineId: lineId.trim() || undefined,
          facebook: facebook.trim() || undefined,
          idCardNo: idCardNo.trim() || undefined,
          taxId: taxId.trim() || undefined,
          birthDate: birthDate || undefined,
          nationality: nationality.trim() || undefined,
          address: address.trim() || undefined,
          note: note.trim() || undefined,
          idCardUrl: idCardUrl || undefined,
          docUrls,
        });
        toast.success(isEdit ? "บันทึกผู้เช่าแล้ว" : "เพิ่มผู้เช่าแล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function remove() {
    if (!tenant?.id) return;
    if (!confirm("ลบผู้เช่ารายนี้? (ลบไม่ได้ถ้ายังมีสัญญาที่ใช้งานอยู่)")) return;
    start(async () => {
      try {
        await actDeleteTenant(tenant.id);
        toast.success("ลบผู้เช่าแล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  const busy = pending || uploading;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={isEdit ? "rs-btn rs-btn-ghost" : "rs-btn"}
      >
        {isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {triggerLabel ?? (isEdit ? "แก้ไขผู้เช่า" : "เพิ่มผู้เช่า")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "rgba(15,23,42,0.45)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rs-card w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "แก้ไขผู้เช่า" : "เพิ่มผู้เช่า"}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--rs-border)", background: "#fff" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "var(--rs-text)" }}>
                {isEdit ? "แก้ไขผู้เช่า" : "เพิ่มผู้เช่า"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg"
                style={{ color: "var(--rs-text-3)" }}
                aria-label="ปิด"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* ข้อมูลหลัก */}
              <Group title="ข้อมูลหลัก">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Field label="คำนำหน้า">
                    <input className="rs-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="นาย / นาง / บจก." />
                  </Field>
                  <Field label="ชื่อ">
                    <input className="rs-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </Field>
                  <Field label="นามสกุล">
                    <input className="rs-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </Field>
                  <Field label="ชื่อเล่น">
                    <input className="rs-input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
                  </Field>
                  <Field label="ชื่อร้าน / กิจการ" full>
                    <input className="rs-input" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="เช่น ร้านกาแฟดอยช้าง" />
                  </Field>
                </div>
              </Group>

              {/* ติดต่อ */}
              <Group title="ติดต่อ">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="เบอร์โทร (คั่นด้วย ,)" full>
                    <input className="rs-input" value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="081-234-5678, 02-111-2222" />
                  </Field>
                  <Field label="อีเมล">
                    <input className="rs-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <Field label="LINE ID">
                    <input className="rs-input" value={lineId} onChange={(e) => setLineId(e.target.value)} />
                  </Field>
                  <Field label="Facebook" full>
                    <input className="rs-input" value={facebook} onChange={(e) => setFacebook(e.target.value)} />
                  </Field>
                </div>
              </Group>

              {/* เอกสาร */}
              <Group title="เอกสาร & รายละเอียด">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="เลขบัตรประชาชน">
                    <input className="rs-input" value={idCardNo} onChange={(e) => setIdCardNo(e.target.value)} />
                  </Field>
                  <Field label="เลขผู้เสียภาษี">
                    <input className="rs-input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
                  </Field>
                  <Field label="วันเกิด">
                    <input className="rs-input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                  </Field>
                  <Field label="สัญชาติ">
                    <input className="rs-input" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="ไทย" />
                  </Field>
                  <Field label="ที่อยู่" full>
                    <textarea className="rs-input rs-textarea" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
                  </Field>
                  <Field label="หมายเหตุ" full>
                    <textarea className="rs-input rs-textarea" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                  </Field>
                </div>

                {/* idCard upload */}
                <div className="mt-1">
                  <span className="block text-[12.5px] font-medium mb-1.5" style={{ color: "var(--rs-text-2)" }}>
                    รูปบัตรประชาชน
                  </span>
                  <div className="flex items-center gap-3">
                    {idCardUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={idCardUrl}
                        alt="บัตรประชาชน"
                        className="h-20 w-32 object-cover rounded-lg border"
                        style={{ borderColor: "var(--rs-border)" }}
                      />
                    ) : (
                      <div
                        className="h-20 w-32 flex items-center justify-center rounded-lg border"
                        style={{ borderColor: "var(--rs-border)", color: "var(--rs-text-3)" }}
                      >
                        <ImageIcon className="h-6 w-6" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => idCardInputRef.current?.click()}
                        className="rs-btn rs-btn-ghost"
                        disabled={busy}
                      >
                        <Upload className="h-4 w-4" /> {idCardUrl ? "เปลี่ยนรูป" : "อัปโหลด"}
                      </button>
                      {idCardUrl && (
                        <button
                          type="button"
                          onClick={() => setIdCardUrl("")}
                          className="text-[13px] font-medium text-left"
                          style={{ color: "var(--rs-danger)" }}
                        >
                          ลบรูป
                        </button>
                      )}
                    </div>
                    <input
                      ref={idCardInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadIdCard(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>

                {/* extra docs */}
                <div className="mt-3">
                  <span className="block text-[12.5px] font-medium mb-1.5" style={{ color: "var(--rs-text-2)" }}>
                    เอกสารเพิ่มเติม
                  </span>
                  {docUrls.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {docUrls.map((url, i) => (
                        <li key={url} className="flex items-center justify-between gap-2 text-sm">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 truncate"
                            style={{ color: "var(--rs-brand)" }}
                          >
                            <FileText className="h-4 w-4 shrink-0" /> เอกสาร {i + 1}
                          </a>
                          <button
                            type="button"
                            onClick={() => setDocUrls((prev) => prev.filter((u) => u !== url))}
                            style={{ color: "var(--rs-text-3)" }}
                            aria-label="ลบเอกสาร"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => docsInputRef.current?.click()}
                    className="rs-btn rs-btn-ghost"
                    disabled={busy}
                  >
                    <Upload className="h-4 w-4" /> เพิ่มเอกสาร
                  </button>
                  <input
                    ref={docsInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) uploadDocs(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </Group>
            </div>

            <div
              className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-4 border-t"
              style={{ borderColor: "var(--rs-border)", background: "#fff" }}
            >
              {isEdit ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: "var(--rs-danger)" }}
                >
                  <Trash2 className="h-4 w-4" /> ลบผู้เช่า
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rs-btn rs-btn-ghost" disabled={busy}>
                  ยกเลิก
                </button>
                <button type="button" onClick={save} className="rs-btn" disabled={busy}>
                  {pending ? "กำลังบันทึก…" : uploading ? "กำลังอัปโหลด…" : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .rs-input {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: #fff;
          color: var(--rs-text);
          font-size: 14px;
        }
        .rs-textarea {
          height: auto;
          padding: 10px 12px;
          line-height: 1.4;
          resize: vertical;
        }
        .rs-input:focus {
          outline: none;
          border-color: var(--rs-brand);
          box-shadow: 0 0 0 3px var(--rs-brand-50);
        }
      `}</style>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-bold mb-2" style={{ color: "var(--rs-text)" }}>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  const id = useId();
  // associate the visible label with the control for a11y (linter + screen readers)
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, { id, "aria-label": label })
    : children;
  return (
    <div className={`block ${full ? "col-span-full" : ""}`}>
      <label htmlFor={id} className="block text-[12.5px] font-medium mb-1" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </label>
      {control}
    </div>
  );
}

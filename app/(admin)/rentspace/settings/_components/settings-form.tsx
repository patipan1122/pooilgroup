"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings, Upload, Check, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { actSaveProject, actUploadFile } from "../../_actions";

type LateFeeType = "none" | "fixed" | "percent_total" | "per_day";

type Initial = {
  id: string;
  name: string;
  slug: string;
  address: string;
  description: string;
  planImageUrl: string;
  electricRate: number;
  waterRate: number;
  vatPercent: number;
  billDueDay: number;
  lateFeeType: LateFeeType;
  lateFeeValue: number;
  lateFeeGraceDays: number;
  autoBillEnabled: boolean;
  view3dEnabled: boolean;
  billEditUnlocked: boolean;
  billDeleteUnlocked: boolean;
  billIssueUnlocked: boolean;
  billCompanyName: string;
  billTaxId: string;
  billBranch: string;
  billAddress: string;
};

const LATE_FEE_OPTIONS: { value: LateFeeType; label: string }[] = [
  { value: "none", label: "ไม่มีค่าปรับ" },
  { value: "fixed", label: "คงที่ (บาท)" },
  { value: "percent_total", label: "เปอร์เซ็นต์ของยอดบิล" },
  { value: "per_day", label: "ต่อวันที่เกินกำหนด (บาท/วัน)" },
];

function str(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ก-๙\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

export default function SettingsForm({ initial }: { initial: Initial | null }) {
  const router = useRouter();
  const isFirstTime = !initial;
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [planImageUrl, setPlanImageUrl] = useState(initial?.planImageUrl ?? "");
  const [electricRate, setElectricRate] = useState(str(initial?.electricRate ?? 7));
  const [waterRate, setWaterRate] = useState(str(initial?.waterRate ?? 18));
  const [vatPercent, setVatPercent] = useState(str(initial?.vatPercent ?? 0));
  const [billDueDay, setBillDueDay] = useState(str(initial?.billDueDay ?? 5));
  const [lateFeeType, setLateFeeType] = useState<LateFeeType>(initial?.lateFeeType ?? "none");
  const [lateFeeValue, setLateFeeValue] = useState(str(initial?.lateFeeValue ?? 0));
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState(str(initial?.lateFeeGraceDays ?? 7));
  const [autoBillEnabled, setAutoBillEnabled] = useState(initial?.autoBillEnabled ?? true);
  const [view3dEnabled, setView3dEnabled] = useState(initial?.view3dEnabled ?? true);
  const [billEditUnlocked, setBillEditUnlocked] = useState(initial?.billEditUnlocked ?? false);
  const [billDeleteUnlocked, setBillDeleteUnlocked] = useState(initial?.billDeleteUnlocked ?? false);
  const [billIssueUnlocked, setBillIssueUnlocked] = useState(initial?.billIssueUnlocked ?? true);
  const [billCompanyName, setBillCompanyName] = useState(initial?.billCompanyName ?? "");
  const [billTaxId, setBillTaxId] = useState(initial?.billTaxId ?? "");
  const [billBranch, setBillBranch] = useState(initial?.billBranch ?? "");
  const [billAddress, setBillAddress] = useState(initial?.billAddress ?? "");

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  function onPickFile() {
    fileRef.current?.click();
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setUploading(true);
      try {
        const { url } = await actUploadFile({ sub: "plan", dataUrl });
        setPlanImageUrl(url);
        toast.success("อัปโหลดผังโครงการแล้ว");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => toast.error("อ่านไฟล์ไม่สำเร็จ");
    reader.readAsDataURL(file);
  }

  function save() {
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อโครงการ");
      return;
    }
    const due = Number(billDueDay);
    if (billDueDay.trim() && (!Number.isInteger(due) || due < 1 || due > 28)) {
      toast.error("วันครบกำหนดต้องอยู่ระหว่าง 1–28");
      return;
    }
    start(async () => {
      try {
        await actSaveProject({
          id: initial?.id,
          name: name.trim(),
          slug: slug.trim() || slugify(name) || "default",
          address: address.trim() || undefined,
          description: description.trim() || undefined,
          planImageUrl: planImageUrl || undefined,
          electricRate: electricRate.trim() ? Number(electricRate) : undefined,
          waterRate: waterRate.trim() ? Number(waterRate) : undefined,
          vatPercent: vatPercent.trim() ? Number(vatPercent) : undefined,
          billDueDay: billDueDay.trim() ? Number(billDueDay) : undefined,
          lateFeeType,
          lateFeeValue:
            lateFeeType === "none"
              ? 0
              : lateFeeValue.trim()
                ? Number(lateFeeValue)
                : undefined,
          lateFeeGraceDays: lateFeeGraceDays.trim() ? Number(lateFeeGraceDays) : undefined,
          autoBillEnabled,
          view3dEnabled,
          billEditUnlocked,
          billDeleteUnlocked,
          billIssueUnlocked,
          billCompanyName: billCompanyName.trim() || undefined,
          billTaxId: billTaxId.trim() || undefined,
          billBranch: billBranch.trim() || undefined,
          billAddress: billAddress.trim() || undefined,
        });
        toast.success(isFirstTime ? "สร้างโครงการแล้ว" : "บันทึกการตั้งค่าแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-5">
      {isFirstTime && (
        <div
          className="rs-card p-4 flex items-start gap-3"
          style={{ background: "var(--rs-brand-50)", borderColor: "var(--rs-brand)" }}
        >
          <Settings className="h-5 w-5 mt-0.5 shrink-0" style={{ color: "var(--rs-brand)" }} />
          <div className="text-sm" style={{ color: "var(--rs-text)" }}>
            <p className="font-semibold">เริ่มใช้งานครั้งแรก</p>
            <p className="mt-0.5" style={{ color: "var(--rs-text-2)" }}>
              กรอกข้อมูลโครงการแล้วกด “บันทึก” ระบบจะสร้างโครงการให้ จากนั้นจึงเพิ่มห้องและผู้เช่าได้
            </p>
          </div>
        </div>
      )}

      {/* ── ข้อมูลโครงการ ── */}
      <section className="rs-card p-5 space-y-4">
        <SectionTitle title="ข้อมูลโครงการ" hint="ชื่อและที่อยู่ที่จะแสดงบนบิลและสัญญา" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="ชื่อโครงการ *" hint="เช่น โครงการทะเลทาวน์">
            <input
              className="rs-input"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="โครงการทะเลทาวน์"
            />
          </Field>
          <Field label="รหัสย่อ (slug)" hint="ใช้ภายในระบบ ตัวอักษรอังกฤษ/ตัวเลข">
            <input
              className="rs-input"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="talaytown"
            />
          </Field>
          <Field label="ที่อยู่" hint="ที่ตั้งโครงการ" full>
            <input
              className="rs-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 ถนน... ตำบล... อำเภอ... จังหวัด..."
            />
          </Field>
          <Field label="รายละเอียด" hint="คำอธิบายเพิ่มเติม (ไม่บังคับ)" full>
            <textarea
              className="rs-input"
              style={{ height: 80, paddingTop: 8, resize: "vertical" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ศูนย์อาหาร / ตลาด / อาคารพาณิชย์ ..."
            />
          </Field>
        </div>
      </section>

      {/* ── ข้อมูลผู้ให้เช่า (หัวบิล/ใบกำกับภาษี) ── */}
      <section className="rs-card p-5 space-y-4">
        <SectionTitle
          title="ข้อมูลผู้ให้เช่า (หัวบิล / ใบกำกับภาษี)"
          hint="ชื่อบริษัทและเลขผู้เสียภาษีของผู้ให้เช่า จะแสดงบนหัวบิล เพื่อให้เป็นใบกำกับภาษีที่ถูกต้องสำหรับผู้เช่านิติบุคคล"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="ชื่อบริษัท / ผู้ให้เช่า" hint="เช่น บริษัท ทะเลทาวน์ จำกัด">
            <input
              className="rs-input"
              value={billCompanyName}
              onChange={(e) => setBillCompanyName(e.target.value)}
              placeholder="บริษัท ... จำกัด"
            />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี" hint="13 หลัก">
            <input
              className="rs-input"
              value={billTaxId}
              onChange={(e) => setBillTaxId(e.target.value)}
              placeholder="0 0000 00000 00 0"
            />
          </Field>
          <Field label="สำนักงาน / สาขา" hint="เช่น สำนักงานใหญ่ หรือ สาขา 00001">
            <input
              className="rs-input"
              value={billBranch}
              onChange={(e) => setBillBranch(e.target.value)}
              placeholder="สำนักงานใหญ่"
            />
          </Field>
          <Field label="ที่อยู่ออกบิล" hint="ที่อยู่ตามใบกำกับภาษี (ถ้าต่างจากที่อยู่โครงการ)" full>
            <input
              className="rs-input"
              value={billAddress}
              onChange={(e) => setBillAddress(e.target.value)}
              placeholder="เลขที่ ... ถนน ... ตำบล ... อำเภอ ... จังหวัด ... รหัสไปรษณีย์"
            />
          </Field>
        </div>
      </section>

      {/* ── ผังโครงการ ── */}
      <section className="rs-card p-5 space-y-3">
        <SectionTitle
          title="ผังโครงการ (Plan)"
          hint="รูปแผนผังที่ใช้วางตำแหน่งห้องบนหน้าผัง (รองรับ 3D)"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {planImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={planImageUrl}
              alt="ผังโครงการ"
              className="rounded-xl border object-contain w-full sm:w-[200px] h-[140px] shrink-0"
              style={{ borderColor: "var(--rs-border)", background: "var(--rs-bg-2)" }}
            />
          ) : (
            <div
              className="rounded-xl border flex items-center justify-center text-center text-[12px] w-full sm:w-[200px] h-[140px] shrink-0"
              style={{
                borderColor: "var(--rs-border)",
                color: "var(--rs-text-3)",
                background: "var(--rs-bg-2)",
              }}
            >
              ยังไม่มีรูปผัง
            </div>
          )}
          <div className="space-y-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onPickFile}
              className="rs-btn rs-btn-ghost w-full sm:w-auto"
              disabled={uploading || pending}
            >
              <Upload className="h-4 w-4" />
              {uploading ? "กำลังอัปโหลด…" : planImageUrl ? "เปลี่ยนรูปผัง" : "อัปโหลดรูปผัง"}
            </button>
            {planImageUrl && (
              <button
                type="button"
                onClick={() => setPlanImageUrl("")}
                className="inline-flex items-center min-h-[44px] text-[13px] font-medium"
                style={{ color: "var(--rs-danger)" }}
                disabled={pending}
              >
                เอารูปออก
              </button>
            )}
            <p className="text-[12px] sm:max-w-[220px]" style={{ color: "var(--rs-text-3)" }}>
              ไฟล์รูปภาพ ขนาดไม่เกิน 8MB จะใช้เป็นพื้นหลังของหน้าผังห้อง
            </p>
          </div>
        </div>
      </section>

      {/* ── อัตราค่าบริการ ── */}
      <section className="rs-card p-5 space-y-4">
        <SectionTitle
          title="อัตราค่าบริการ"
          hint="ค่ามาตรฐานของโครงการ ใช้คำนวณบิลอัตโนมัติ (สัญญาแต่ละห้องตั้งทับได้)"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="ค่าไฟ (บาท/หน่วย)" hint="คูณกับหน่วยที่ใช้จากมิเตอร์">
            <input
              className="rs-input"
              type="number"
              step="0.01"
              value={electricRate}
              onChange={(e) => setElectricRate(e.target.value)}
            />
          </Field>
          <Field label="ค่าน้ำ (บาท/หน่วย)" hint="คูณกับหน่วยที่ใช้จากมิเตอร์">
            <input
              className="rs-input"
              type="number"
              step="0.01"
              value={waterRate}
              onChange={(e) => setWaterRate(e.target.value)}
            />
          </Field>
          <Field label="VAT (%)" hint="ภาษีมูลค่าเพิ่ม 0 = ไม่คิด VAT">
            <input
              className="rs-input"
              type="number"
              step="0.01"
              value={vatPercent}
              onChange={(e) => setVatPercent(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* ── การออกบิล + ค่าปรับ ── */}
      <section className="rs-card p-5 space-y-4">
        <SectionTitle title="การออกบิล &amp; ค่าปรับล่าช้า" hint="ค่ากลางของทั้งโครงการ — ใช้เป็นค่าเริ่มต้นของสัญญาใหม่" />
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
        >
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            ตั้ง <b>ค่าปรับ / ส่วนลด / วันวางบิลเป็นรายคน</b> ได้ที่หน้าสัญญาของผู้เช่าแต่ละห้อง
            (เปิดสัญญา → “ตั้งค่าปรับ / ส่วนลด / วันวางบิล (รายคน)”) — ค่าตรงนี้เป็นค่าเริ่มต้นของทั้งโครงการเท่านั้น
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="วันครบกำหนดชำระ (1–28)" hint="ทุกเดือนบิลจะครบกำหนดวันที่นี้">
            <input
              className="rs-input"
              type="number"
              min={1}
              max={28}
              value={billDueDay}
              onChange={(e) => setBillDueDay(e.target.value)}
            />
          </Field>
          <Field label="รูปแบบค่าปรับล่าช้า" hint="คิดอย่างไรเมื่อเลยกำหนด">
            <select
              className="rs-input"
              value={lateFeeType}
              onChange={(e) => setLateFeeType(e.target.value as LateFeeType)}
            >
              {LATE_FEE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={
              lateFeeType === "percent_total"
                ? "ค่าปรับ (%)"
                : lateFeeType === "per_day"
                  ? "ค่าปรับ (บาท/วัน)"
                  : "ค่าปรับ (บาท)"
            }
            hint={lateFeeType === "none" ? "ปิดอยู่ — ไม่คิดค่าปรับ" : "จำนวนตามรูปแบบที่เลือก"}
          >
            <input
              className="rs-input"
              type="number"
              step="0.01"
              value={lateFeeValue}
              onChange={(e) => setLateFeeValue(e.target.value)}
              disabled={lateFeeType === "none"}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field
            label="ผ่อนผัน (วัน)"
            hint="เลยกำหนดกี่วันจึงเริ่มคิดค่าปรับ"
          >
            <input
              className="rs-input"
              type="number"
              min={0}
              value={lateFeeGraceDays}
              onChange={(e) => setLateFeeGraceDays(e.target.value)}
              disabled={lateFeeType === "none"}
            />
          </Field>
        </div>
      </section>

      {/* ── ตัวเลือกการทำงาน ── */}
      <section className="rs-card p-5 space-y-3">
        <SectionTitle title="ตัวเลือกการทำงาน" />
        <Toggle
          checked={autoBillEnabled}
          onChange={setAutoBillEnabled}
          label="ออกบิลอัตโนมัติทุกเดือน"
          hint="ระบบจะสร้างบิลให้ทุกสัญญาที่ใช้งานอยู่เมื่อถึงรอบบิล โดยไม่ต้องกดเอง"
        />
        <Toggle
          checked={view3dEnabled}
          onChange={setView3dEnabled}
          label="แสดงผัง 3D"
          hint="เปิดมุมมองผังห้องแบบสามมิติในหน้าผังโครงการ"
        />
      </section>

      {/* ── สิทธิ์จัดการบิล (เปิด-ปิดต่อการกระทำ · super_admin ตั้งได้คนเดียว) ── */}
      <section className="rs-card p-5 space-y-3">
        <SectionTitle
          title="สิทธิ์จัดการบิล (สำหรับทีมงาน)"
          hint="เปิด-ปิดว่าให้แอดมิน/ผู้ดูแล RentSpace ทำอะไรกับบิลได้บ้าง · ผู้ดูแลระบบ (super admin) ทำได้ทุกอย่างเสมอ ไม่ต้องเปิดสวิตช์"
        />
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{ background: "var(--rs-pending-soft)", color: "#8A6400" }}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            ตามหลักบัญชี ใบแจ้งหนี้ที่ออกแล้ว <b>ไม่ควรแก้/ลบอิสระ</b> — เปิดเฉพาะเมื่อจำเป็น
            แล้ว<b>ปิดกลับ</b>เมื่อไม่ใช้ · ทุกการออก/แก้/ลบมีบันทึกประวัติไว้ ·
            สวิตช์เหล่านี้คุมเฉพาะทีมงาน <b>ไม่กระทบ super admin</b>
          </span>
        </div>
        <Toggle
          checked={billIssueUnlocked}
          onChange={setBillIssueUnlocked}
          label="อนุญาตให้ออกบิล / สร้างใบแจ้งหนี้"
          hint="เปิด = แอดมิน/ผู้ดูแลออกบิลได้ (ค่าเริ่มต้น) · ปิด = เฉพาะ super admin ออกบิลได้"
        />
        <Toggle
          checked={billEditUnlocked}
          onChange={setBillEditUnlocked}
          label="อนุญาตให้แก้ไขบิล"
          hint="เปิด = หน้าบิลจะมีปุ่ม “แก้ไขบิล” สำหรับแอดมิน/ผู้ดูแล · ปิด = ปลอดภัยตามปกติ (แก้ไม่ได้)"
        />
        <Toggle
          checked={billDeleteUnlocked}
          onChange={setBillDeleteUnlocked}
          label="อนุญาตให้ลบบิลทิ้ง"
          hint="เปิด = หน้าบิลจะมีปุ่ม “ลบบิล” สำหรับแอดมิน/ผู้ดูแล · ปิด = ลบไม่ได้ (ยกเลิกบิลผ่านการอนุมัติ 2 คนแทน)"
        />
      </section>

      {/* ── บันทึก ── */}
      <div className="flex justify-stretch sm:justify-end pb-4">
        <button
          type="button"
          onClick={save}
          className="rs-btn w-full sm:w-auto"
          disabled={pending || uploading}
        >
          {pending ? (
            "กำลังบันทึก…"
          ) : (
            <>
              <Check className="h-4 w-4" />
              {isFirstTime ? "สร้างโครงการ" : "บันทึกการตั้งค่า"}
            </>
          )}
        </button>
      </div>

      <style jsx>{`
        .rs-input {
          width: 100%;
          min-height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: #fff;
          color: var(--rs-text);
          font-size: 14px;
        }
        textarea.rs-input {
          line-height: 1.5;
        }
        .rs-input:focus {
          outline: none;
          border-color: var(--rs-brand);
          box-shadow: 0 0 0 3px var(--rs-brand-50);
        }
        .rs-input:disabled {
          background: var(--rs-bg-2);
          color: var(--rs-text-3);
        }
      `}</style>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-base font-bold" style={{ color: "var(--rs-text)" }}>
        {title}
      </h2>
      {hint && (
        <p className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="block text-[12.5px] font-medium mb-1" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11.5px] mt-1" style={{ color: "var(--rs-text-3)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 text-left rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--rs-bg-2)]"
      role="switch"
      aria-checked={checked}
    >
      <div>
        <div className="text-sm font-medium" style={{ color: "var(--rs-text)" }}>
          {label}
        </div>
        {hint && (
          <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
            {hint}
          </div>
        )}
      </div>
      <span
        className="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors mt-0.5"
        style={{ background: checked ? "var(--rs-brand)" : "var(--rs-bg-3)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 22 : 2 }}
        />
      </span>
    </button>
  );
}

"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Upload,
  Check,
  Info,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";
import {
  actSaveProject,
  actUploadFile,
  actSaveRecurringCharge,
  actDeleteRecurringCharge,
} from "../../_actions";

type LateFeeType = "none" | "fixed" | "percent_total" | "per_day";

export type RecurringCharge = {
  id: string;
  unitId: string | null;
  kind: string;
  label: string;
  amountThb: number;
  vatable: boolean;
  isActive: boolean;
  sort: number;
  unitCode: string | null;
  unitName: string | null;
};

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
  vatOnRent: boolean;
  vatOnElectric: boolean;
  vatOnWater: boolean;
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
  contractEditUnlocked: boolean;
  contractDeleteUnlocked: boolean;
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  promptpayId: string;
  paymentNote: string;
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

export default function SettingsForm({
  initial,
  recurringCharges = [],
  canEditPerms = true,
}: {
  initial: Initial | null;
  recurringCharges?: RecurringCharge[];
  /** เฉพาะ super admin เห็น/ตั้งสวิตช์ปลดล็อก (แก้/ลบ/ออกบิล·สัญญา). module admin = false. */
  canEditPerms?: boolean;
}) {
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
  const [vatOnRent, setVatOnRent] = useState(initial?.vatOnRent ?? true);
  const [vatOnElectric, setVatOnElectric] = useState(initial?.vatOnElectric ?? false);
  const [vatOnWater, setVatOnWater] = useState(initial?.vatOnWater ?? false);
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
  const [contractEditUnlocked, setContractEditUnlocked] = useState(
    initial?.contractEditUnlocked ?? false,
  );
  const [contractDeleteUnlocked, setContractDeleteUnlocked] = useState(
    initial?.contractDeleteUnlocked ?? false,
  );
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [bankAccountNo, setBankAccountNo] = useState(initial?.bankAccountNo ?? "");
  const [bankAccountHolder, setBankAccountHolder] = useState(initial?.bankAccountHolder ?? "");
  const [promptpayId, setPromptpayId] = useState(initial?.promptpayId ?? "");
  const [paymentNote, setPaymentNote] = useState(initial?.paymentNote ?? "");

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
          vatOnRent,
          vatOnElectric,
          vatOnWater,
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
          contractEditUnlocked,
          contractDeleteUnlocked,
          bankName: bankName.trim() || undefined,
          bankAccountNo: bankAccountNo.trim() || undefined,
          bankAccountHolder: bankAccountHolder.trim() || undefined,
          promptpayId: promptpayId.trim() || undefined,
          paymentNote: paymentNote.trim() || undefined,
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

      {/* ── บัญชีรับเงิน ── */}
      <section className="rs-card p-5 space-y-4">
        <SectionTitle
          title="บัญชีรับเงิน (ให้ผู้เช่าจ่ายง่าย)"
          hint="เลขบัญชีนี้จะแสดงบนบิล สัญญา และหน้าจ่ายเงินออนไลน์ของผู้เช่า"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="ชื่อธนาคาร" hint="ธนาคารที่รับโอนเงินค่าเช่า">
            <input
              className="rs-input"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="ไทยพาณิชย์ (SCB)"
            />
          </Field>
          <Field label="เลขที่บัญชี" hint="เลขบัญชีสำหรับรับโอน">
            <input
              className="rs-input"
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
              placeholder="8134094107"
              inputMode="numeric"
            />
          </Field>
          <Field label="ชื่อบัญชี" hint="ชื่อเจ้าของบัญชีตามที่ปรากฏในธนาคาร">
            <input
              className="rs-input"
              value={bankAccountHolder}
              onChange={(e) => setBankAccountHolder(e.target.value)}
              placeholder="เจพีซิ้งค์ กรุ๊ป จำกัด"
            />
          </Field>
          <Field label="พร้อมเพย์ (PromptPay)" hint="เบอร์โทร / เลขประจำตัวผู้เสียภาษี (ไม่บังคับ)">
            <input
              className="rs-input"
              value={promptpayId}
              onChange={(e) => setPromptpayId(e.target.value)}
              placeholder="0812345678"
              inputMode="numeric"
            />
          </Field>
          <Field label="หมายเหตุการชำระเงิน" hint="ข้อความเพิ่มเติมที่จะแสดงใต้ช่องทางการจ่ายเงิน (ไม่บังคับ)" full>
            <textarea
              className="rs-input"
              style={{ height: 80, paddingTop: 8, resize: "vertical" }}
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder="เช่น โอนแล้วส่งสลิปทาง LINE @rentspace · ชำระภายในวันที่ครบกำหนด"
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
        {/* คิด VAT กับรายการไหน — ค่าเริ่มต้นของทั้งโครงการ (แต่ละห้องแก้ทับได้ในสัญญา) */}
        <div className="mt-1">
          <div className="text-[12.5px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
            คิด VAT กับรายการไหน
          </div>
          <p className="text-[11.5px] mb-2" style={{ color: "var(--rs-text-3)" }}>
            ค่าเริ่มต้นของทั้งโครงการ — แต่ละห้องแก้ทับได้ในหน้าสัญญา ·
            ค่าเช่าอสังหาฯ มักได้รับยกเว้น VAT · น้ำ/ไฟ ที่เรียกเก็บถือเป็นบริการ (คิด VAT ได้)
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ["ค่าเช่า", vatOnRent, setVatOnRent],
                ["ค่าไฟ", vatOnElectric, setVatOnElectric],
                ["ค่าน้ำ", vatOnWater, setVatOnWater],
              ] as const
            ).map(([label, val, setter]) => (
              <label
                key={label}
                className="flex items-center gap-2 text-[13px] cursor-pointer"
                style={{ color: "var(--rs-text)" }}
              >
                <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          {vatPercent.trim() === "" || Number(vatPercent) === 0 ? (
            <p className="text-[11.5px] mt-2" style={{ color: "var(--rs-pending)" }}>
              ⚠️ ตอนนี้ VAT (%) = 0 → บิลจะไม่คิด VAT ทุกรายการ (ต้องตั้ง % ให้มากกว่า 0 ก่อน)
            </p>
          ) : null}
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

      {/* สวิตช์ปลดล็อก = การให้สิทธิ์ทีมงาน → เฉพาะ super admin เห็น/ตั้งได้
          (module admin ตั้งค่าอื่นได้ แต่ปลดล็อกให้ตัวเองไม่ได้ · กัน self-escalation) */}
      {canEditPerms && (
      <>
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

      {/* ── สิทธิ์จัดการสัญญา (เปิด-ปิดต่อการกระทำ · super_admin ทะลุเสมอ) ── */}
      <section className="rs-card p-5 space-y-3">
        <SectionTitle
          title="สิทธิ์จัดการสัญญา (สำหรับทีมงาน)"
          hint="เปิด-ปิดว่าให้แอดมิน/ผู้ดูแล RentSpace ทำอะไรกับสัญญาเช่าได้บ้าง · ผู้ดูแลระบบ (super admin) ทำได้ทุกอย่างเสมอ ไม่ต้องเปิดสวิตช์"
        />
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{ background: "var(--rs-pending-soft)", color: "#8A6400" }}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            สัญญาที่เซ็นแล้วถือเป็นเอกสารผูกพัน <b>ไม่ควรแก้/ลบอิสระ</b> — เปิดเฉพาะเมื่อจำเป็น
            แล้ว<b>ปิดกลับ</b>เมื่อไม่ใช้ · ทุกการแก้/ลบมีบันทึกประวัติไว้ ·
            สวิตช์เหล่านี้คุมเฉพาะทีมงาน <b>ไม่กระทบ super admin</b>
          </span>
        </div>
        <Toggle
          checked={contractEditUnlocked}
          onChange={setContractEditUnlocked}
          label="อนุญาตให้แก้ไขสัญญา"
          hint="เปิด = แก้สัญญาที่เซ็นแล้วได้ (จะออกฉบับแก้ไข + ให้เซ็นใหม่) · ปิด = ต้องขออนุมัติก่อน"
        />
        <Toggle
          checked={contractDeleteUnlocked}
          onChange={setContractDeleteUnlocked}
          label="อนุญาตให้ลบสัญญา"
          hint="เปิด = ลบสัญญาที่ยังไม่มีบิลได้ · ปิด = ปลอดภัย"
        />
      </section>
      </>
      )}

      {/* ── ค่าใช้จ่ายประจำ (เฉพาะเมื่อมีโครงการแล้ว) ── */}
      {initial?.id && (
        <RecurringChargesManager projectId={initial.id} charges={recurringCharges} />
      )}

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

// ───────── ค่าใช้จ่ายประจำ (recurring charges) — บวกทุกบิลอัตโนมัติ ─────────

const thb = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type ChargeDraft = {
  id?: string;
  label: string;
  amount: string;
  vatable: boolean;
  kind: string;
};

const EMPTY_DRAFT: ChargeDraft = { label: "", amount: "", vatable: false, kind: "other" };

function RecurringChargesManager({
  projectId,
  charges,
}: {
  projectId: string;
  charges: RecurringCharge[];
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [draft, setDraft] = useState<ChargeDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isLandTax = draft?.kind === "land_tax";

  function openAdd(preset?: Partial<ChargeDraft>) {
    setDraft({ ...EMPTY_DRAFT, ...preset });
  }

  function openEdit(c: RecurringCharge) {
    setDraft({
      id: c.id,
      label: c.label,
      amount: str(c.amountThb),
      vatable: c.vatable,
      kind: c.kind,
    });
  }

  function saveDraft() {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) {
      toast.error("กรุณาระบุชื่อรายการค่าใช้จ่าย");
      return;
    }
    const amount = Number(draft.amount);
    if (!draft.amount.trim() || !Number.isFinite(amount) || amount < 0) {
      toast.error("กรุณาระบุจำนวนเงินให้ถูกต้อง");
      return;
    }
    startSave(async () => {
      try {
        await actSaveRecurringCharge({
          id: draft.id,
          projectId,
          unitId: null,
          kind: draft.kind,
          label,
          amountThb: amount,
          vatable: draft.vatable,
        });
        toast.success(draft.id ? "แก้ไขรายการแล้ว" : "เพิ่มรายการแล้ว");
        setDraft(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function remove(c: RecurringCharge) {
    if (!window.confirm(`ลบรายการ “${c.label}” ออกจากบิลทุกเดือน?`)) return;
    setBusyId(c.id);
    startSave(async () => {
      try {
        await actDeleteRecurringCharge(c.id);
        toast.success("ลบรายการแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      } finally {
        setBusyId(null);
      }
    });
  }

  const hasLandTax = charges.some((c) => c.kind === "land_tax");

  return (
    <section className="rs-card p-5 space-y-4">
      <SectionTitle
        title="ค่าใช้จ่ายประจำ (บวกทุกบิลอัตโนมัติ)"
        hint="รายการที่ต้องเก็บจากผู้เช่าทุกเดือน เช่น ค่าส่วนกลาง ค่าขยะ ภาษีที่ดิน — ระบบจะบวกเข้าบิลให้อัตโนมัติ"
      />

      {/* รายการที่มีอยู่ */}
      {charges.length === 0 ? (
        <p
          className="rounded-xl px-3 py-4 text-center text-[13px]"
          style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-3)" }}
        >
          ยังไม่มีค่าใช้จ่ายประจำ — เพิ่มรายการด้านล่างเพื่อให้บวกเข้าบิลทุกเดือนอัตโนมัติ
        </p>
      ) : (
        <ul className="space-y-2">
          {charges.map((c) => {
            const rowBusy = busyId === c.id;
            const scope =
              c.unitId == null
                ? "ทั้งโครงการ"
                : `ห้อง ${c.unitCode ?? ""}${c.unitName ? ` · ${c.unitName}` : ""}`.trim();
            return (
              <li
                key={c.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl px-3 py-3 border"
                style={{
                  borderColor: "var(--rs-border)",
                  background: c.isActive ? "#fff" : "var(--rs-bg-2)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-sm font-semibold truncate"
                      style={{ color: "var(--rs-text)" }}
                    >
                      {c.label}
                    </span>
                    {c.vatable && (
                      <span
                        className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
                      >
                        VAT
                      </span>
                    )}
                    {!c.isActive && (
                      <span
                        className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-3)" }}
                      >
                        ปิดอยู่
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                    {scope}
                  </div>
                </div>
                <div
                  className="text-base font-bold tabular-nums shrink-0"
                  style={{ color: "var(--rs-text)" }}
                >
                  ฿{thb.format(c.amountThb)}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-[13px] font-medium border"
                    style={{ borderColor: "var(--rs-border)", color: "var(--rs-text-2)" }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    แก้
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-[13px] font-medium border"
                    style={{ borderColor: "var(--rs-border)", color: "var(--rs-danger)" }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {rowBusy ? "กำลังลบ…" : "ลบ"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ฟอร์มเพิ่ม/แก้ไข inline */}
      {draft ? (
        <div
          className="rounded-xl border p-4 space-y-4"
          style={{ borderColor: "var(--rs-brand)", background: "var(--rs-brand-50)" }}
        >
          <div className="text-sm font-semibold" style={{ color: "var(--rs-text)" }}>
            {draft.id ? "แก้ไขรายการ" : "เพิ่มรายการใหม่"}
          </div>
          {isLandTax && (
            <div
              className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
              style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>ภาษีที่ดินเป็นภาษีส่งต่อ — ไม่คิด VAT ซ้ำ</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="ชื่อรายการ *" hint="เช่น ค่าส่วนกลาง · ค่าขยะ · ภาษีที่ดิน">
              <input
                className="rs-input"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="ค่าส่วนกลาง"
              />
            </Field>
            <Field label="จำนวนเงิน (บาท/เดือน) *" hint="ยอดที่จะบวกเข้าบิลทุกเดือน">
              <input
                className="rs-input"
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-5 w-5 rounded"
              style={{ accentColor: "var(--rs-brand)" }}
              checked={draft.vatable}
              onChange={(e) => setDraft({ ...draft, vatable: e.target.checked })}
            />
            <span className="text-sm" style={{ color: "var(--rs-text)" }}>
              คิด VAT กับรายการนี้
            </span>
          </label>
          <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            ขอบเขต: <b style={{ color: "var(--rs-text-2)" }}>ทั้งโครงการ</b> (ทุกห้องที่มีสัญญา)
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={saving}
              className="rs-btn rs-btn-ghost w-full sm:w-auto"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving}
              className="rs-btn w-full sm:w-auto"
            >
              <Check className="h-4 w-4" />
              {saving ? "กำลังบันทึก…" : draft.id ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => openAdd()}
            className="rs-btn rs-btn-ghost w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            เพิ่มรายการ
          </button>
          {!hasLandTax && (
            <button
              type="button"
              onClick={() =>
                openAdd({ label: "ภาษีที่ดิน", kind: "land_tax", vatable: false })
              }
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg text-[13px] font-medium border w-full sm:w-auto"
              style={{ borderColor: "var(--rs-border)", color: "var(--rs-text-2)", background: "#fff" }}
            >
              <Landmark className="h-4 w-4" />
              + ภาษีที่ดิน
            </button>
          )}
        </div>
      )}

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
      `}</style>
    </section>
  );
}

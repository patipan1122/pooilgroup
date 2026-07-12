// Rendered maid employment contract — mirrors the paper form
// "สัญญาจ้างเหมาทำความสะอาดและเก็บเงินนำส่งธนาคาร" (CEO 2026-07-12).
//
// Presentational + server-safe (no hooks) so it works as the live PREVIEW, the
// SIGNED copy, and inside a print view. White-paper look, Thai body text.

import type { ContractDocData, ContractSignature } from "./types";

function thaiDate(iso: string | null): string {
  if (!iso) return "____/____/______";
  const d = new Date(`${iso}T00:00:00+07:00`);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function fill(v: string | null | undefined, dots = "........................"): string {
  const t = (v ?? "").toString().trim();
  return t === "" ? dots : t;
}

function bahtOrDots(n: number | null): string {
  return n == null ? "......................" : n.toLocaleString("th-TH");
}

export function ContractDocument({
  data,
  signature,
}: {
  data: ContractDocData;
  signature?: ContractSignature | null;
}) {
  return (
    <div className="contract-doc mx-auto max-w-[820px] bg-white p-6 text-[13px] leading-relaxed text-zinc-900 sm:p-10">
      <h1 className="text-center text-lg font-bold">
        สัญญาจ้างเหมาทำความสะอาดและเก็บเงินนำส่งธนาคาร
      </h1>

      <p className="mt-4">
        <span className="font-semibold">คู่สัญญา</span>
      </p>
      <p className="mt-1">
        1. บริษัท เจพีซิงค์กรุ๊ป จำกัด ซึ่งต่อไปในสัญญานี้จะเรียกว่า “ผู้ว่าจ้าง”
      </p>
      <p className="mt-1">
        2. ชื่อ <U>{fill(data.maidName)}</U> ซึ่งต่อไปในสัญญานี้จะเรียกว่า “ผู้รับจ้าง”
      </p>
      <p className="mt-1">
        เลขบัตรประชาชน: <U>{fill(data.idCardNumber)}</U> &nbsp; เบอร์โทร: <U>{fill(data.phone, "..............")}</U>
      </p>
      <p className="mt-1">ที่อยู่: <U>{fill(data.address, "....................................................................")}</U></p>

      <Section title="ข้อ 1 ลักษณะงาน">
        <ol className="ml-5 list-decimal space-y-0.5">
          <li>ทำความสะอาดพื้นที่และภายในบริเวณของบริษัทในช่วงเช้า</li>
          <li>ถูและทำความสะอาดบริเวณที่กำหนด พร้อมจัดเก็บให้เรียบร้อย</li>
          <li>เก็บเงินจากลูกค้าตามจุดที่กำหนด</li>
          <li>นำเงินทั้งหมดฝากเข้าบัญชีบริษัทภายในวันเดียวกัน</li>
          <li>ส่งหลักฐานการฝากเงิน (สลิป) และถ่ายรูปส่งให้ผู้ว่าจ้างทุกวัน</li>
        </ol>
      </Section>

      <Section title="ข้อ 2 ค่าจ้างและการชำระเงิน">
        <p>
          1. ผู้ว่าจ้างตกลงจ่ายค่าจ้างให้แก่ผู้รับจ้างเป็นจำนวนเงิน (<U>{bahtOrDots(data.monthlyWage)}</U> บาท) ต่อเดือน
        </p>
        <p className="mt-1">
          2. ผู้ว่าจ้างจะโอนเงินเข้าบัญชีของผู้รับจ้างดังนี้ ชื่อบัญชี: <U>{fill(data.salaryAccountName)}</U> ธนาคาร: <U>{fill(data.salaryBankName, "................")}</U>
        </p>
        <p className="mt-1">
          - เลขที่บัญชี: <U>{fill(data.salaryAccountNo, "............................")}</U> โอนภายในวันที่ <U>{fill(data.payDayOfMonth?.toString() ?? null, "......")}</U> ของทุกเดือน
        </p>
        <p className="mt-1">3. ผู้รับจ้างต้องนำเงินที่เก็บได้ฝากเข้าบัญชีของบริษัทตามรายละเอียดดังนี้</p>
        <p className="mt-1">
          - ชื่อบัญชี: <U>{fill(data.companyAccountName ?? "บริษัท เจพีซิงค์กรุ๊ป จำกัด")}</U> ธนาคาร: <U>{fill(data.companyBankName, "................")}</U>
        </p>
        <p className="mt-1">
          - เลขที่บัญชี: <U>{fill(data.companyAccountNo, "............................")}</U> ประเภทบัญชี: <U>{fill(data.companyAccountType, "ออมทรัพย์ / กระแสรายวัน")}</U>
        </p>
        <p className="mt-1 text-zinc-600">
          หากผู้รับจ้างไม่นำเงินส่งหรือมีการทุจริต บริษัทมีสิทธิบอกเลิกสัญญาทันที
        </p>
      </Section>

      <Section title="ข้อ 3 ความรับผิดชอบ">
        <ol className="ml-5 list-decimal space-y-0.5">
          <li>ผู้รับจ้างต้องรับผิดชอบเงินที่เก็บได้ทั้งหมด</li>
          <li>หากเงินสูญหายหรือใช้ผิดวัตถุประสงค์ ต้องชดใช้เต็มจำนวน</li>
          <li>ห้ามนำเงินไปใช้ส่วนตัวก่อนนำฝากโดยเด็ดขาด</li>
          <li>หากตรวจพบการทุจริต บริษัทมีสิทธิบอกเลิกสัญญาและดำเนินการทางกฎหมายทันที</li>
        </ol>
      </Section>

      <Section title="ข้อ 4 ระยะเวลาสัญญา">
        <p>
          สัญญาฉบับนี้มีผลตั้งแต่วันที่ <U>{thaiDate(data.startDate)}</U> ถึงวันที่ <U>{thaiDate(data.endDate)}</U>
        </p>
        <p className="mt-1 text-zinc-600">
          เมื่อครบกำหนด หากไม่มีการบอกเลิกสัญญา สัญญานี้จะขยายออกไปโดยอัตโนมัติครั้งละ 1 เดือน
        </p>
      </Section>

      <Section title="ข้อ 5 การลงนาม">
        <p className="text-zinc-600">
          คู่สัญญาทั้งสองฝ่ายได้อ่านและเข้าใจข้อความในสัญญาฉบับนี้โดยละเอียดแล้ว จึงได้ลงลายมือชื่อไว้เป็นหลักฐาน
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <SignBox
            role="ผู้ว่าจ้าง"
            name="บริษัท เจพีซิงค์กรุ๊ป จำกัด"
            preAuthorized
          />
          <SignBox
            role="ผู้รับจ้าง"
            name={data.maidName}
            signatureUrl={signature?.signatureImageUrl}
            signedAt={signature?.signedAt}
          />
        </div>
      </Section>

      {data.idCardImageUrl && (
        <Section title="เอกสารแนบ · สำเนาบัตรประชาชน">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.idCardImageUrl}
            alt="สำเนาบัตรประชาชน"
            className="max-h-56 rounded-md border border-zinc-200"
          />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="font-semibold">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function U({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-b border-dotted border-zinc-400 px-1 font-medium">{children}</span>
  );
}

function SignBox({
  role,
  name,
  signatureUrl,
  signedAt,
  preAuthorized,
}: {
  role: string;
  name: string | null;
  signatureUrl?: string | null;
  signedAt?: string | null;
  preAuthorized?: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 text-center">
      <div className="text-sm font-semibold">{role}</div>
      <div className="mt-2 flex h-16 items-end justify-center">
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signatureUrl} alt="ลายเซ็น" className="max-h-16" />
        ) : preAuthorized ? (
          <span className="pb-1 text-xs italic text-zinc-400">(อนุมัติล่วงหน้าโดยบริษัท)</span>
        ) : (
          <span className="pb-1 text-xs text-zinc-300">ลงชื่อ ____________________</span>
        )}
      </div>
      <div className="mt-1 border-t border-zinc-200 pt-1 text-xs text-zinc-600">
        ({fill(name, "..............................")})
      </div>
      <div className="text-[11px] text-zinc-400">
        {signedAt
          ? `วันที่ ${thaiDate(signedAt.slice(0, 10))}`
          : "วันที่ ____/____/______"}
      </div>
    </div>
  );
}

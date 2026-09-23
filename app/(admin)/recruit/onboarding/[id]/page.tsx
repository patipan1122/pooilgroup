// /recruit/onboarding/[id] — one new-hire submission, everything HR needs to
// decide on ONE screen (docs/BIGFEATURE_recruit-onboarding_SPEC.md).
//
// Layout priorities come straight from the BranchManager persona
// (docs/BIGFEATURE_recruit-onboarding_PERSONA_BRANCHMANAGER.md §2):
//   • ลายเซ็น + เซลฟี่ + บัตรประชาชน ต้องอยู่ "ข้างกัน" ในจอเดียว เทียบหน้าได้เลย
//     ไม่ต้องคลิกสลับแท็บ (เขารีวิวขณะยืนอยู่หน้างาน)
//   • ปุ่มตัดสินใจอยู่บนสุด ไม่ต้องเลื่อนจนสุดหน้าก่อนกดได้
//   • เห็น timestamp ที่กรอก (กรอกตอนตี 2 = น่าสงสัย)
//   • ตีกลับพร้อมเหตุผลได้ ไม่ใช่แค่ approve/not-approve
//
// เอกสารทุกใบเปิดผ่าน proxy ของเราเอง (/api/recruit/onboarding/documents/[docId])
// — ไม่มีลิงก์ Google Drive ดิบ ๆ โผล่ในหน้านี้เด็ดขาด (spec P0).

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin, canRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { formatBaht } from "@/lib/utils/format";
import {
  ONBOARDING_DOC_TYPE_LABELS_TH,
  onboardingCompanyLegalName,
  type OnboardingDocType,
} from "@/lib/recruit/onboarding-types";
import {
  getOnboardingContractSections,
  hashContractText,
  hashOnboardingContract,
  renderOnboardingContract,
  ONBOARDING_CONTRACT_TITLE,
  type OnboardingContractVars,
} from "@/lib/recruit/onboarding-contract";
import {
  ONBOARDING_STATUS_CLASSES,
  ONBOARDING_STATUS_LABELS_TH,
} from "../_status";
import { ReviewPanel } from "../_components/review-panel";
import {
  ShieldAlert,
  CopyCheck,
  FileText,
  BadgeCheck,
  AlertTriangle,
  UserPlus,
  Ban,
} from "lucide-react";

export const dynamic = "force-dynamic";

// ── helpers: read the JSON columns without `any` ──────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "ใช่" : "ไม่ใช่";
  return "";
}

/** ต้องตรงกับ oneLineAddress() ใน app/api/recruit/onboarding/submit/route.ts
 * แบบอักขระต่ออักขระ — ข้อความนี้เข้าไปอยู่ใน hash ของสัญญา */
function oneLineAddress(v: unknown): string {
  const a = asRecord(v);
  if (!asText(a.line)) return "";
  return `${asText(a.line)} ต./แขวง ${asText(a.subDistrict)} อ./เขต ${asText(
    a.district,
  )} จ.${asText(a.province)} ${asText(a.postalCode)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** `@db.Date` → "dd/mm/yyyy" (ใช้ส่วน UTC เพราะคอลัมน์ date เก็บเที่ยงคืน UTC) */
function fmtDateTh(d: Date): string {
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
/** ตรงกับ fmtDateTimeTh() ในฝั่ง submit — เวลาไทย (UTC+7) */
function fmtDateTimeTh(at: Date): string {
  const bkk = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  return `${pad(bkk.getUTCDate())}/${pad(bkk.getUTCMonth() + 1)}/${bkk.getUTCFullYear()} ${pad(
    bkk.getUTCHours(),
  )}:${pad(bkk.getUTCMinutes())} น.`;
}
/** ชั่วโมงไทยที่กรอก — ใช้ทำ flag "กรอกตอนดึก" */
function bkkHour(at: Date): number {
  return new Date(at.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const docHref = (docId: string) => `/api/recruit/onboarding/documents/${docId}`;

export default async function OnboardingSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);
  const orgId = session.user.org_id;
  const { id } = await params;

  const sub = await prisma.recruitOnboardingSubmission.findFirst({
    where: { id, orgId },
    include: {
      company: { select: { name: true, code: true } },
      branch: { select: { name: true } },
      reviewer: { select: { name: true } },
      documents: { orderBy: { createdAt: "asc" } },
      consent: true,
    },
  });
  if (!sub) return notFound();

  const [duplicates, resultUser] = await Promise.all([
    // ใบอื่นที่ใช้เลขบัตรเดียวกัน — ไม่บล็อก แค่ให้คนตัดสิน
    prisma.recruitOnboardingSubmission.findMany({
      where: { orgId, nationalId: sub.nationalId, id: { not: sub.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, fullNameTh: true, status: true, createdAt: true },
    }),
    sub.resultUserId
      ? prisma.user.findFirst({
          where: { id: sub.resultUserId, orgId },
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            role: true,
            isActive: true,
            employeeCode: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const address = asRecord(sub.addressJson);
  const contacts = asArray(sub.emergencyContactsJson);
  const education = asRecord(sub.educationJson);
  const workHistory = asArray(sub.workHistoryJson);
  const answers = asRecord(sub.answersJson);
  const noBankAccountYet = answers.noBankAccountYet === true;

  // ── สัญญา: render ใหม่จากข้อมูลที่เก็บไว้ แล้วเทียบ hash ─────────────────
  const contractVars: OnboardingContractVars = {
    // ชื่อนิติบุคคลภาษาไทย ต้องตรงกับฝั่ง submit/หน้าเซ็นเป๊ะ ๆ ไม่งั้น hash
    // จะไม่ตรงแล้วขึ้นเตือนว่าถูกแก้ไขทั้งที่ไม่ได้ถูกแก้
    companyName: onboardingCompanyLegalName(sub.company.code, sub.company.name),
    fullNameTh: sub.fullNameTh,
    nationalId: sub.nationalId,
    registeredAddress: oneLineAddress(address.registered),
    position: sub.positionApplied,
    branch: sub.branch?.name ?? asText(answers.branchText),
    startDate: fmtDateTh(sub.desiredStartDate),
    signedAtText: sub.consent ? fmtDateTimeTh(sub.consent.signedAt) : "",
  };
  const contractSections = getOnboardingContractSections(contractVars);
  // hash ฉบับ "ไม่รวมเวลาที่กดยินยอม" คือฉบับ canonical ของ lib สัญญา, ส่วน
  // ฉบับ "รวมเวลา" คือสิ่งที่ตัวบันทึกการเซ็นคำนวณไว้ — ตรงอันใดอันหนึ่ง
  // แปลว่าข้อความที่พนักงานอ่านยังเป็นข้อความเดิมทุกตัวอักษร
  const hashCanonical = hashOnboardingContract(contractVars);
  const hashWithSignedAt = hashContractText(renderOnboardingContract(contractVars));
  const storedHash = sub.consent?.contractContentHash ?? null;
  const hashOk =
    storedHash !== null && (storedHash === hashCanonical || storedHash === hashWithSignedAt);

  // ── เอกสาร: แยกลายเซ็น/เซลฟี่ออกจาก "เอกสารแนบ 6 ใบ" ────────────────────
  const signatureDoc = sub.documents.find((d) => d.id === sub.consent?.signatureDocId) ?? null;
  const selfieDoc = sub.documents.find((d) => d.id === sub.consent?.selfieDocId) ?? null;
  const idCardDoc = sub.documents.find((d) => d.docType === "ID_CARD") ?? null;
  const attachments = sub.documents.filter(
    (d) => d.id !== signatureDoc?.id && d.id !== selfieDoc?.id,
  );

  const submittedHour = bkkHour(sub.createdAt);
  const oddHourSubmission = submittedHour >= 0 && submittedHour < 5;
  const reference = sub.id.slice(0, 8).toUpperCase();
  const decided = sub.status === "APPROVED" || sub.status === "REJECTED";

  return (
    <div className="bg-white min-h-screen pb-16">
      {/* ── แถบบน (ค้างไว้ตอนเลื่อน) ── */}
      <div className="border-b border-zinc-200 px-4 sm:px-8 py-2 sticky top-0 bg-white z-20 flex items-center gap-3 flex-wrap">
        <Link
          href="/recruit/onboarding"
          className="inline-flex items-center h-9 -ml-2 px-3 text-sm text-zinc-600 hover:text-zinc-900 rounded-lg hover:bg-zinc-100"
        >
          ← กลับรายการพนักงานใหม่
        </Link>
        <span className="text-xs font-mono text-zinc-400">#{reference}</span>
        <span
          className={`ml-auto inline-block px-2.5 py-1 rounded-full border text-[11px] font-bold ${
            ONBOARDING_STATUS_CLASSES[sub.status]
          }`}
        >
          {ONBOARDING_STATUS_LABELS_TH[sub.status]}
        </span>
      </div>

      <div className="px-4 sm:px-8 pt-4 max-w-[1200px] mx-auto space-y-4">
        {/* ── หัวเรื่อง ── */}
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold font-display text-zinc-900">
            {sub.titlePrefix}
            {sub.fullNameTh}{" "}
            <span className="font-normal text-zinc-500">({sub.nickname})</span>
          </h1>
          <p className="text-sm text-zinc-600 mt-1">
            {sub.positionApplied} ·{" "}
            {sub.branch?.name ?? (asText(answers.branchText) || "ไม่ระบุสาขา")} · {sub.company.name}
          </p>
          <p className="text-xs text-zinc-500 mt-1 tabular-num">
            ส่งเข้ามา {fmtDateTimeTh(sub.createdAt)}
            {oddHourSubmission && (
              <span className="ml-2 text-orange-700 font-bold">
                ⚠️ กรอกช่วงดึก ({pad(submittedHour)}:00 น.) — ถ้าไม่ตรงกับที่นัดไว้ ให้เช็คก่อน
              </span>
            )}
          </p>
        </div>

        {/* ── ด่านที่ระบบทำแทนไม่ได้ ── */}
        {!decided && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2.5">
            <ShieldAlert className="size-5 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 leading-relaxed">
              <b>ก่อนกดอนุมัติ:</b> โทรยืนยันตัวตนด้วย
              <b>เบอร์ที่ใช้คุยกันตอนสัมภาษณ์จริง</b> ไม่ใช่เบอร์ {sub.phone} ที่พิมพ์มาในฟอร์มนี้ ·
              ระบบไม่มีการเชื่อมกับใบสมัครงานโดยเจตนา จึง<b>ไม่มีอะไรยืนยันอัตโนมัติ</b>ว่าคนนี้คือคนที่เราตกลงรับ
              · เทียบ ตำแหน่ง/สาขา/ค่าแรงต่อวัน กับที่ตกลงไว้ด้วย
            </p>
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3 flex items-start gap-2.5">
            <CopyCheck className="size-5 text-orange-700 shrink-0 mt-0.5" />
            <div className="text-xs text-orange-900 leading-relaxed min-w-0">
              <b>เลขบัตรประชาชนนี้ถูกส่งเข้ามาแล้ว {duplicates.length + 1} ครั้ง</b> — ระบบไม่บล็อกให้
              เพราะอาจเป็นคนเดิมกรอกใหม่หลังถูกตีกลับ · ตรวจเองว่าอันไหนคือใบจริง:
              <ul className="mt-1.5 space-y-1">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/recruit/onboarding/${d.id}`}
                      className="font-bold underline hover:text-orange-950"
                    >
                      {d.fullNameTh}
                    </Link>{" "}
                    · {ONBOARDING_STATUS_LABELS_TH[d.status]} ·{" "}
                    <span className="tabular-num">{fmtDateTimeTh(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── ผลการพิจารณา / ปุ่มตัดสินใจ ── */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4">
          {sub.status === "APPROVED" && resultUser && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3">
              <p className="text-sm font-bold text-green-900 flex items-center gap-1.5">
                <UserPlus className="size-4" />
                สร้างบัญชีพนักงานแล้ว
              </p>
              <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                <Mini label="ชื่อบัญชี" value={resultUser.name} />
                <Mini label="เบอร์" value={resultUser.phone ?? "—"} />
                <Mini label="อีเมล" value={resultUser.email ?? "ไม่มี"} />
                <Mini label="สิทธิ์" value={`พนักงาน (${resultUser.role})`} />
                <Mini label="รหัสพนักงาน" value={resultUser.employeeCode ?? "ยังไม่ได้ใส่"} />
                <Mini
                  label="สถานะบัญชี"
                  value={resultUser.isActive ? "เปิดใช้งานแล้ว" : "ยังไม่เปิดใช้งาน"}
                />
              </dl>
              {!resultUser.isActive && (
                <p className="text-xs text-green-900 mt-2 leading-relaxed">
                  <b>ยังล็อกอินไม่ได้จนกว่าจะเปิดใช้งาน</b> — ไปที่หน้า{" "}
                  <Link href="/users" className="underline font-bold">
                    ผู้ใช้งาน
                  </Link>{" "}
                  แล้วกดเปิดใช้งานบัญชีนี้ · พร้อมใส่รหัสพนักงานจาก Humansoft และกำหนดสาขาที่ดูแล
                  (ระบบไม่ตั้งให้อัตโนมัติโดยตั้งใจ)
                </p>
              )}
            </div>
          )}
          {sub.status === "APPROVED" && !resultUser && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <b>อนุมัติแล้วแต่หาบัญชีที่สร้างไว้ไม่เจอ</b> — บัญชีอาจถูกลบไปภายหลัง · แจ้งผู้ดูแลระบบ
            </div>
          )}
          {sub.status === "REJECTED" && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-bold text-red-900 flex items-center gap-1.5">
                <Ban className="size-4" />
                ตีกลับ / ไม่รับ
              </p>
              <p className="text-xs text-red-900 mt-1 leading-relaxed whitespace-pre-wrap">
                {sub.rejectReason ?? "ไม่ได้ระบุเหตุผล"}
              </p>
            </div>
          )}
          {decided && (
            <p className="text-[11px] text-zinc-500 mb-2 tabular-num">
              พิจารณาโดย {sub.reviewer?.name ?? "ไม่ทราบ"}
              {sub.reviewedAt ? ` · ${fmtDateTimeTh(sub.reviewedAt)}` : ""}
            </p>
          )}
          <ReviewPanel
            submissionId={sub.id}
            candidateName={`${sub.fullNameTh} (${sub.nickname})`}
            status={sub.status}
            canDecide={canRecruitAdmin(session.user.role)}
          />
        </div>

        {/* ── เทียบหน้า: ลายเซ็น · เซลฟี่ · บัตรประชาชน (BranchManager §2) ── */}
        <Block
          no="★"
          title="เทียบหน้า — ลายเซ็น · เซลฟี่สด · บัตรประชาชน"
          hint="กดที่รูปเพื่อเปิดเต็มจอ (รูปบัตรจากมือถือมักเบลอ · ซูมดูก่อนตัดสิน)"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DocFrame doc={selfieDoc} caption="เซลฟี่สด (ถ่ายตอนเซ็น)" tall />
            <DocFrame doc={idCardDoc} caption="บัตรประชาชน" tall />
            <DocFrame doc={signatureDoc} caption="ลายเซ็นที่วาด" tall />
          </div>
        </Block>

        {/* ── ส่วนที่ 1-2 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Block no={1} title="ตำแหน่งที่สมัคร">
            <Fields
              rows={[
                ["ตำแหน่ง", sub.positionApplied],
                ["บริษัท", `${sub.company.name} (${sub.company.code})`],
                [
                  "สาขา/สถานที่ทำงาน",
                  sub.branch?.name ??
                    `${asText(answers.branchText) || "—"} (พิมพ์เอง · ยังจับคู่สาขาในระบบไม่ได้)`,
                ],
                ["วันที่พร้อมเริ่มงาน", fmtDateTh(sub.desiredStartDate)],
                ["ค่าแรงต่อวันที่ตกลงไว้", `${formatBaht(sub.desiredSalary.toString())} / วัน`],
              ]}
            />
          </Block>

          <Block no={2} title="ข้อมูลส่วนตัว">
            <Fields
              rows={[
                ["ชื่อ-นามสกุล (ไทย)", `${sub.titlePrefix}${sub.fullNameTh}`],
                ["ชื่อ-นามสกุล (อังกฤษ)", sub.fullNameEn ?? "—"],
                ["ชื่อเล่น", sub.nickname],
                ["เลขบัตรประชาชน", sub.nationalId],
                ["วันเกิด", fmtDateTh(sub.birthDate)],
                ["สัญชาติ", sub.nationality],
                ["สถานภาพทางทหาร", sub.militaryStatus ?? "—"],
                ["สถานภาพสมรส", sub.maritalStatus ?? "—"],
                ["เบอร์โทร (ที่กรอกมา)", sub.phone],
                ["LINE ID", sub.lineId ?? "—"],
                ["อีเมล", sub.email ?? "—"],
              ]}
            />
          </Block>
        </div>

        {/* ── ส่วนที่ 3-4 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Block no={3} title="ที่อยู่">
            <Fields
              rows={[
                ["ตามทะเบียนบ้าน", oneLineAddress(address.registered) || "—"],
                [
                  "ที่อยู่ปัจจุบัน",
                  address.sameAsRegistered === true
                    ? `${oneLineAddress(address.registered) || "—"} (เดียวกับทะเบียนบ้าน)`
                    : oneLineAddress(address.current) || "—",
                ],
              ]}
            />
          </Block>

          <Block no={4} title="ผู้ติดต่อฉุกเฉิน">
            {contacts.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-2">
                {contacts.map((c, i) => {
                  const r = asRecord(c);
                  return (
                    <div key={i} className="rounded-xl border border-zinc-200 p-2.5">
                      <p className="text-sm font-bold text-zinc-900">
                        {asText(r.name) || "—"}{" "}
                        <span className="font-normal text-zinc-500">
                          ({asText(r.relation) || "ไม่ระบุความสัมพันธ์"})
                        </span>
                      </p>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        {asText(r.phone) || "ไม่มีเบอร์"}
                        {asText(r.address) ? ` · ${asText(r.address)}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Block>
        </div>

        {/* ── ส่วนที่ 5-7 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Block no={5} title="การศึกษา">
            <Fields
              rows={[
                ["ระดับ", asText(education.level) || "—"],
                ["สถาบัน", asText(education.institute) || "—"],
                ["สาขาวิชา", asText(education.major) || "—"],
                ["ปีที่จบ", asText(education.graduationYear) || "—"],
                ["เกรดเฉลี่ย", asText(education.gpa) || "—"],
              ]}
            />
          </Block>

          <Block no={7} title="บัญชีรับเงินเดือน">
            {noBankAccountYet ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                <p className="text-[13px] font-bold text-amber-900">
                  ยังไม่ได้เปิดบัญชี ttb
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                  พนักงานแจ้งว่ายังไม่มีบัญชี — ต้องพาไปเปิดบัญชี ttb ก่อนรอบจ่ายเงินเดือนแรก
                </p>
              </div>
            ) : (
              <>
                <Fields
                  rows={[
                    ["ธนาคาร", sub.bankName],
                    ["เลขบัญชี", sub.bankAccountNo],
                    ["ชื่อบัญชี", sub.bankAccountName],
                  ]}
                />
                <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                  เทียบชื่อบัญชีกับชื่อในบัตรประชาชนให้ตรงกันก่อนอนุมัติ · ถ้าไม่ตรง
                  เงินเดือนจะโอนไม่เข้าและต้องแก้ทีหลัง
                </p>
              </>
            )}
          </Block>
        </div>

        <Block no={6} title="ประวัติการทำงาน">
          {workHistory.length === 0 ? (
            <Empty text="ไม่ได้กรอกประวัติการทำงาน (อาจเป็นงานแรก)" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {workHistory.map((w, i) => {
                const r = asRecord(w);
                return (
                  <div key={i} className="rounded-xl border border-zinc-200 p-2.5">
                    <p className="text-sm font-bold text-zinc-900">{asText(r.company) || "—"}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      {asText(r.position) || "ไม่ระบุตำแหน่ง"}
                      {asText(r.period) ? ` · ${asText(r.period)}` : ""}
                      {asText(r.salary) ? ` · ${asText(r.salary)}` : ""}
                    </p>
                    {asText(r.reasonLeaving) && (
                      <p className="text-xs text-zinc-500 mt-1">
                        เหตุผลที่ออก: {asText(r.reasonLeaving)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Block>

        {/* ── ส่วนที่ 8 — เอกสารแนบ ── */}
        <Block
          no={8}
          title={`เอกสารแนบ (${attachments.length} ใบ)`}
          hint="ทุกไฟล์เปิดผ่านระบบของเราเท่านั้น · ไม่มีลิงก์ Google Drive ที่คนนอกกดดูได้"
        >
          {attachments.length === 0 ? (
            <Empty text="ไม่มีเอกสารแนบ" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {attachments.map((d) => (
                <DocFrame
                  key={d.id}
                  doc={d}
                  caption={ONBOARDING_DOC_TYPE_LABELS_TH[d.docType as OnboardingDocType]}
                />
              ))}
            </div>
          )}
        </Block>

        {/* ── ส่วนที่ 9 — การยินยอม + สัญญา ── */}
        <Block no={9} title="การยินยอม + สัญญาจ้างที่เซ็นแล้ว">
          {!sub.consent ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <b>ไม่มีบันทึกการเซ็นสัญญา</b> — ใบนี้ไม่ควรถูกอนุมัติจนกว่าจะรู้สาเหตุ
              (ปกติเป็นไปไม่ได้ เพราะฟอร์มบังคับเซ็นก่อนส่ง)
            </div>
          ) : (
            <>
              <div
                className={`rounded-xl border p-3 mb-3 ${
                  hashOk ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                }`}
              >
                <p
                  className={`text-sm font-bold flex items-center gap-1.5 ${
                    hashOk ? "text-green-900" : "text-red-900"
                  }`}
                >
                  {hashOk ? (
                    <>
                      <BadgeCheck className="size-4" />✅ สัญญาตรงกับตอนที่เซ็น
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4" />⚠️ สัญญาไม่ตรงกับตอนที่เซ็น
                    </>
                  )}
                </p>
                <p
                  className={`text-xs mt-1 leading-relaxed ${
                    hashOk ? "text-green-900" : "text-red-900"
                  }`}
                >
                  {hashOk
                    ? "ระบบสร้างข้อความสัญญาขึ้นใหม่จากข้อมูลในใบนี้แล้วเทียบลายนิ้วมือดิจิทัล (hash) — ตรงกันทุกตัวอักษร แปลว่าข้อความที่พนักงานอ่านและเซ็นคือฉบับเดียวกับที่เห็นด้านล่างนี้"
                    : "ข้อความสัญญาที่สร้างใหม่จากข้อมูลในใบนี้ ไม่ตรงกับลายนิ้วมือดิจิทัลที่บันทึกไว้ตอนเซ็น — อาจเกิดจากข้อมูล (ชื่อ/ตำแหน่ง/สาขา/วันเริ่มงาน) ถูกแก้ภายหลัง หรือแม่แบบสัญญาถูกแก้หลังจากคนนี้เซ็นไปแล้ว · อย่าเพิ่งอนุมัติ · แจ้งผู้ดูแลระบบให้ตรวจก่อน"}
                </p>
                <p className="text-[10px] font-mono text-zinc-500 mt-1.5 break-all">
                  เก็บไว้ {storedHash?.slice(0, 24)}… · คำนวณใหม่ {hashCanonical.slice(0, 24)}…
                </p>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs mb-3">
                <Mini label="เซ็นเมื่อ" value={fmtDateTimeTh(sub.consent.signedAt)} />
                <Mini label="IP ที่เซ็น" value={sub.consent.signedIp ?? "ไม่ทราบ"} />
                <Mini
                  label="อ่านจนจบ?"
                  value={sub.consent.scrolledToEnd ? "เลื่อนอ่านจนจบ" : "ไม่ได้เลื่อนจนจบ"}
                />
                <Mini label="รหัสอ้างอิง" value={`#${reference}`} />
              </dl>
              {!sub.consent.scrolledToEnd && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
                  พนักงานไม่ได้เลื่อนอ่านสัญญาจนจบก่อนกดยินยอม — ระบบบันทึกตามจริง ไม่ได้บล็อกไว้ ·
                  ถ้าจะให้ปลอดภัยควรทวนเนื้อหาสัญญากับเขาอีกครั้งก่อนอนุมัติ
                </p>
              )}
              <p className="text-[11px] text-zinc-500 break-all mb-3">
                อุปกรณ์ที่เซ็น: {sub.consent.signedUserAgent ?? "ไม่ทราบ"}
              </p>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs mb-3">
                <Mini
                  label="รับรองว่าข้อมูลจริง"
                  value={sub.consentTruthfulAt ? "ยินยอม" : "ไม่ได้ติ๊ก"}
                />
                <Mini
                  label="อ่านนโยบายความเป็นส่วนตัว"
                  value={sub.consentPrivacyReadAt ? "ยินยอม" : "ไม่ได้ติ๊ก"}
                />
                <Mini
                  label="แจ้งผู้ติดต่อฉุกเฉินแล้ว"
                  value={sub.consentEmergencyContactNotifiedAt ? "ยินยอม" : "ไม่ได้ติ๊ก"}
                />
                <Mini
                  label="ยินยอมให้ตรวจสอบประวัติ"
                  value={sub.consentReferenceCheckAt ? "ยินยอม" : "ไม่ได้ติ๊ก"}
                />
              </dl>

              <details className="rounded-xl border border-zinc-200 bg-zinc-50/60">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-bold text-zinc-800 flex items-center gap-1.5">
                  <FileText className="size-4 text-zinc-500" />
                  อ่านสัญญาฉบับที่เขาเซ็น ({ONBOARDING_CONTRACT_TITLE})
                </summary>
                <div className="px-3 pb-3 space-y-3 max-h-[60vh] overflow-y-auto">
                  {contractSections.map((s) => (
                    <div key={s.id}>
                      {s.heading && (
                        <p className="text-xs font-bold text-zinc-900 mt-2">{s.heading}</p>
                      )}
                      {s.paragraphs.map((p, i) => (
                        <p key={i} className="text-xs text-zinc-700 leading-relaxed mt-1">
                          {p}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </Block>

        {Object.keys(answers).length > 0 && (
          <Block no="+" title="ข้อมูลเพิ่มเติมที่ฟอร์มเก็บไว้">
            <Fields
              rows={Object.entries(answers).map(([k, v]) => [k, asText(v) || JSON.stringify(v)])}
            />
          </Block>
        )}
      </div>
    </div>
  );
}

// ── ชิ้นส่วน UI ──────────────────────────────────────────────────────────
function Block({
  no,
  title,
  hint,
  children,
}: {
  /** เลขข้อของฟอร์มกระดาษ (1-9) หรือสัญลักษณ์สำหรับบล็อกที่ไม่ใช่ข้อของฟอร์ม */
  no: number | string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-3.5">
      <div className="flex items-baseline gap-2 mb-2.5">
        <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-md bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[10px] font-bold tabular-nums text-[var(--color-brand-800)]">
          {no}
        </span>
        <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
      </div>
      {hint && <p className="text-[11px] text-zinc-500 -mt-1.5 mb-2.5">{hint}</p>}
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2 min-w-0">
          <dt className="text-[11px] text-zinc-500 shrink-0 w-[128px]">{label}</dt>
          <dd className="text-sm text-zinc-900 min-w-0 break-words">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-zinc-500">{label}</dt>
      <dd className="text-xs font-bold text-zinc-900 break-words">{value}</dd>
    </div>
  );
}

function Empty({ text = "ไม่มีข้อมูล" }: { text?: string }) {
  return <p className="text-xs text-zinc-400 py-2">{text}</p>;
}

function DocFrame({
  doc,
  caption,
  tall = false,
}: {
  doc: { id: string; fileName: string; mimeType: string } | null;
  caption: string;
  tall?: boolean;
}) {
  if (!doc) {
    return (
      <figure className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 flex flex-col items-center justify-center p-3 text-center min-h-[96px]">
        <p className="text-[11px] font-bold text-zinc-400">{caption}</p>
        <p className="text-[10px] text-zinc-400 mt-0.5">ไม่มีไฟล์</p>
      </figure>
    );
  }
  const href = docHref(doc.id);
  const isImage = IMAGE_MIMES.has(doc.mimeType);
  return (
    <figure className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <a href={href} target="_blank" rel="noreferrer" className="block bg-zinc-50">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={href}
            alt={caption}
            className={`w-full object-contain ${tall ? "h-48 sm:h-56" : "h-28"}`}
            loading="lazy"
          />
        ) : (
          <span
            className={`flex flex-col items-center justify-center gap-1 text-zinc-500 ${
              tall ? "h-48 sm:h-56" : "h-28"
            }`}
          >
            <FileText className="size-6" />
            <span className="text-[10px] font-bold">เปิดไฟล์ PDF</span>
          </span>
        )}
      </a>
      <figcaption className="px-2 py-1.5 border-t border-zinc-100">
        <p className="text-[11px] font-bold text-zinc-800 truncate">{caption}</p>
        <p className="text-[10px] text-zinc-400 truncate">{doc.fileName}</p>
      </figcaption>
    </figure>
  );
}

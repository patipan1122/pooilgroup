// ClawFleet · Help / User Manual
// Static Server Component · Thai-first · printable
// Sections: overview · workspace tour · 3-role flows · 32 rules · keyboard · Q&A
// Updated: 2026-05-26

import Link from "next/link";
import {
  Home,
  Activity,
  BarChart3,
  Settings,
  ScanLine,
  Camera,
  Coins,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Keyboard,
  HelpCircle,
  ListChecks,
  Lightbulb,
  ArrowRight,
} from "lucide-react";

export const metadata = { title: "คู่มือใช้งาน · ClawFleet" };

export default function ClawFleetHelpPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <PageHeader />
        <TableOfContents />

        <Section id="overview" icon={<Lightbulb className="h-5 w-5" />} title="§1 ภาพรวมระบบ">
          <p className="text-zinc-700">
            <strong>ClawFleet</strong> คือระบบบริหารตู้คีบ + ตู้แลกเหรียญหลายสาขา · กันโกง · กันกรอกผิด · เห็นภาพรวมรายได้ทุกตู้ในที่เดียว
          </p>
          <KeyFactsList
            items={[
              { label: "ผู้ใช้หลัก", value: "พนักงานเก็บเงิน · หัวหน้าสาขา · เจ้าของกิจการ" },
              { label: "ใช้ที่ไหน", value: "พนักงานใช้มือถือ · หัวหน้าสาขา + เจ้าของใช้ laptop หรือมือถือก็ได้" },
              { label: "หลักการ", value: "เปิด session → กรอกทุกตู้ในกลุ่ม → ปิด session → ระบบเช็คอัตโนมัติว่าเหรียญตรงใหม" },
              { label: "ความปลอดภัย", value: "ทุก action บันทึก audit log · มี role-based access · ห้ามข้ามตู้/ข้ามสาขา" },
            ]}
          />
        </Section>

        <Section id="workspaces" icon={<Home className="h-5 w-5" />} title="§2 รู้จัก 4 พื้นที่ทำงาน (Workspace)">
          <p className="text-zinc-700">
            ClawFleet มี 4 เมนูหลัก · จัดตามจุดประสงค์ · ไม่ใช่ตามชื่อตาราง:
          </p>
          <WorkspaceCard
            icon={<Home className="h-5 w-5 text-blue-600" />}
            title="หน้าแรก (Hub)"
            href="/clawfleet/hub"
            who="ทุกคน"
            why="เปิดเช้าวันแรกของวัน · เห็นว่าวันนี้ต้องทำอะไร 3 อย่าง"
            features={[
              "Action Cards บอก 'ตอนนี้ต้องทำอะไร' (review anomaly · session ค้าง · stock ใกล้หมด)",
              "KPI 6 ตัว: รายได้วันนี้ · ขาดวันนี้ · anomaly count · warning count · low stock · active sessions",
              "Branch picker ด้านบน (ถ้ามีหลายสาขา)",
            ]}
          />
          <WorkspaceCard
            icon={<Activity className="h-5 w-5 text-blue-600" />}
            title="ปฏิบัติการ (Operations)"
            href="/clawfleet/operations"
            who="พนักงาน + หัวหน้าสาขา"
            why="ทำงานวันนี้ · ดู session ที่กำลังทำ · review anomaly"
            features={[
              "3 ช่องในจอเดียว: filter ซ้าย · session grid กลาง · drawer ขวา",
              "Anomaly strip ลอยบนสุดเสมอ (เห็นทันทีถ้ามี P0)",
              "กดปุ่ม 'เริ่มรอบใหม่' มุมบนขวา → เลือกกลุ่มตู้ → เปิด session",
              "Keyboard shortcut: a=approve · r=recheck · e=escalate · n=ตัวถัดไป · p=ตัวก่อน · Esc=ปิด drawer",
            ]}
          />
          <WorkspaceCard
            icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
            title="ข้อมูล (Insights)"
            href="/clawfleet/insights"
            who="เจ้าของ + หัวหน้าสาขา + บัญชี"
            why="ขุดข้อมูล · ดูตู้ไหนปัง/ห่วย · export CSV ทำงบ"
            features={[
              "7 view: Events · Sessions · Machines · Branches · Staff · Stock · Audit log",
              "Filter ซ้าย: ช่วงเวลา · สาขา · กลุ่ม · ตู้ · พนักงาน · severity",
              "Drill drawer ขวา: ดูรายละเอียดตู้/session + sparkline 30 วัน",
              "ปุ่ม 'ส่งออก CSV' ใช้กับ filter ปัจจุบัน",
            ]}
          />
          <WorkspaceCard
            icon={<Settings className="h-5 w-5 text-blue-600" />}
            title="ตั้งค่า (Setup)"
            href="/clawfleet/setup"
            who="Admin เท่านั้น"
            why="ตั้งค่า threshold · เพิ่มตู้/กลุ่ม/สินค้า · นำเข้า CSV · ดู audit log"
            features={[
              "7 tabs: ระบบ · โครงสร้าง · นำเข้า · ผู้ใช้ · องค์กร · audit log · พื้นที่อันตราย",
              "Tab 'นำเข้า' = upload CSV เพิ่มตู้ทีละหลายตัว (preview + diff ก่อนเขียน)",
              "Tab 'พื้นที่อันตราย' = ปิด module · reset demo (ทุก action ต้องพิมพ์ยืนยัน)",
            ]}
          />
        </Section>

        <Section id="staff-flow" icon={<Camera className="h-5 w-5" />} title="§3 คู่มือพนักงานเก็บเงิน (STAFF)">
          <RoleBadge role="STAFF" device="📱 มือถือ" frequency="ทุกวัน" />
          <h3 className="mt-4 text-base font-semibold text-zinc-900">Flow เก็บเงิน 1 รอบ (~70 นาที · 11 ตู้)</h3>
          <FlowSteps
            steps={[
              {
                num: "1",
                title: "Login + เลือกสาขา",
                detail: "เปิดมือถือ → /clawfleet/operations → ถ้ามีหลายสาขาให้เลือก",
              },
              {
                num: "2",
                title: "กด 'เริ่มรอบใหม่'",
                detail: "เลือกกลุ่มตู้ (Token Exchange Group = 1 ตู้แลก + ~10 ตู้คีบ) · ระบบจะสร้าง session ใหม่",
              },
              {
                num: "3",
                title: "Scan QR ของตู้ที่จะเก็บ",
                detail: "บังคับ scan ก่อนกรอก · กันเปิดผิดตู้",
                tip: "ถ้า QR เสีย/หาย → กดปุ่มเลือกจาก list (จะถูกบันทึก audit)",
              },
              {
                num: "4",
                title: "ถ่ายรูป 4 ใบ (CLAW) / 3 ใบ (EX)",
                detail: "1) มิเตอร์ก่อน · 2) เงินสดในตู้ · 3) ของในตู้ · 4) มิเตอร์หลัง",
                tip: "ถ้าเน็ตช้า · รูปอยู่ในคิวรอ upload · ทำต่อได้",
              },
              {
                num: "5",
                title: "กรอกฟอร์ม 6 ช่อง (CLAW) / 3 ช่อง (EX)",
                detail: "มิเตอร์เหรียญ · มิเตอร์ตุ๊กตา · เงินสด · สต๊อกตุ๊กตาคงเหลือ",
                tip: "ระบบเห็น delta real-time · ถ้าผิด ✅/🟡/🔴 จะขึ้นเลย",
              },
              {
                num: "6",
                title: "กด 'บันทึก & ตู้ถัดไป'",
                detail: "auto-advance ไปตู้ที่ 2 · ทำซ้ำจนครบ 11 ตู้",
              },
              {
                num: "7",
                title: "ครบทุกตู้ → กด 'ปิดรอบ'",
                detail: "ระบบ trigger cross-check: เหรียญตู้แลกแจก vs เหรียญตู้คีบรวม ภายใน 5%",
                tip: "ผ่าน = CLOSED · ขาดเกิน 5% = ANOMALY_REVIEW → หัวหน้าสาขาดู",
              },
            ]}
          />
          <Callout tone="warning" title="⚠ ห้ามทำ">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>ห้ามข้ามขั้น scan QR (จะ block submit)</li>
              <li>ห้ามกรอกมิเตอร์ที่ &lt; รอบก่อน (ระบบ block · มิเตอร์ห้ามถอย)</li>
              <li>ห้าม shutdown app กลาง session — ระบบ autosave ทุก 5 วินาทีลง sessionStorage · เปิดใหม่ resume ต่อได้</li>
            </ul>
          </Callout>
        </Section>

        <Section id="mgr-flow" icon={<ShieldCheck className="h-5 w-5" />} title="§4 คู่มือหัวหน้าสาขา (Branch Manager)">
          <RoleBadge role="BRANCH_MANAGER" device="💻 laptop + 📱 มือถือ" frequency="ทุกวัน · เช้า + เย็น" />
          <h3 className="mt-4 text-base font-semibold text-zinc-900">Flow เช้า (5 นาที)</h3>
          <FlowSteps
            steps={[
              {
                num: "1",
                title: "เปิด /clawfleet/hub",
                detail: "ดู Action Cards · ถ้ามี P0 anomaly จะอยู่บนสุด",
              },
              {
                num: "2",
                title: "คลิก action card → ไปที่ /clawfleet/operations?focus=<code>",
                detail: "drawer ขวาเปิดทันที · ดูภาพรวม session + cross-check detail",
              },
              {
                num: "3",
                title: "ตัดสินใจ: Approve / Recheck / Escalate",
                detail: "Approve = ผ่าน · Recheck = ขอกรอกใหม่ · Escalate = ส่ง CEO",
                tip: "Auto-pass: ขาด ≤฿50 ระบบ approve ให้เอง (ตามที่ตั้งใน Setup)",
              },
              {
                num: "4",
                title: "กด `n` ไปตัวถัดไปอัตโนมัติ",
                detail: "Review queue เรียงตาม severity · จัดการ P0 ก่อน · ใช้ keyboard เร็ว",
              },
            ]}
          />
          <h3 className="mt-6 text-base font-semibold text-zinc-900">Flow เย็น (3 นาที)</h3>
          <FlowSteps
            steps={[
              {
                num: "1",
                title: "เปิด /clawfleet/insights",
                detail: "View = Events · Period = today · Branch = ของฉัน · ดูสรุปวัน",
              },
              {
                num: "2",
                title: "Export CSV · ส่ง LINE ให้เจ้าของ",
                detail: "TODO[claude-design]: auto-LINE summary Phase 1.5",
              },
            ]}
          />
        </Section>

        <Section id="ceo-flow" icon={<BarChart3 className="h-5 w-5" />} title="§5 คู่มือเจ้าของ / Admin (CEO)">
          <RoleBadge role="SUPER_ADMIN / ORG_ADMIN" device="💻 laptop + 📱 มือถือ" frequency="วันละ 2-3 ครั้ง" />
          <h3 className="mt-4 text-base font-semibold text-zinc-900">Flow เช้า (10 วินาที)</h3>
          <FlowSteps
            steps={[
              {
                num: "1",
                title: "เปิด /clawfleet/hub บนมือถือ",
                detail: "เห็น 6 KPI: รายได้ · ขาด · anomaly · warning · low stock · active sessions",
              },
              {
                num: "2",
                title: "คลิก KPI สีแดง/อำพัน → drill ไป workspace ที่เกี่ยวข้อง",
                detail: "Anomaly = ไป Operations · Low stock = ไป Insights view=stock",
              },
            ]}
          />
          <h3 className="mt-6 text-base font-semibold text-zinc-900">Flow ตรวจรายสัปดาห์ (10 นาที)</h3>
          <FlowSteps
            steps={[
              {
                num: "1",
                title: "เปิด /clawfleet/insights → view=Branches",
                detail: "ดู branch ไหนรายได้ตก · click row → pivot เป็น view=events filter ที่สาขานั้น",
              },
              {
                num: "2",
                title: "Click event row → drawer ดู photo + detail",
                detail: "ใช้ context จริงตัดสินใจ: ย้ายตู้? เปลี่ยนพนักงาน? maintenance?",
              },
              {
                num: "3",
                title: "View=Machines → ดู sparkline 30 วัน per ตู้",
                detail: "เห็น trend ชัด · ตู้ไหน flat หรือ drop เด่นๆ ใหม",
              },
              {
                num: "4",
                title: "View=Staff → ดู ranking + anomaly count per พนักงาน",
                detail: "หาแพทเทิร์น 'พนักงานคนเดียวกัน anomaly ซ้ำ'",
              },
            ]}
          />
          <h3 className="mt-6 text-base font-semibold text-zinc-900">Setup (admin tasks)</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            <li>เพิ่มตู้ใหม่: Setup → Structure tab → Machines → + เพิ่ม · หรือ Import CSV ทีละหลายตัว</li>
            <li>เพิ่มกลุ่ม: Setup → Structure → Groups → + เพิ่ม · ผูก 1 ตู้แลก + N ตู้คีบ</li>
            <li>เปลี่ยน threshold: Setup → System tab → แก้ใน `lib/clawfleet/types.ts` ตอนนี้ · UI edit Phase 1.5</li>
            <li>ดู audit log: Setup → Audit log tab (รอ migration M1 · ปัจจุบันยัง stub)</li>
          </ul>
        </Section>

        <Section id="rules" icon={<ListChecks className="h-5 w-5" />} title="§6 กฎกันโง่ 32 ข้อ (สรุปสั้น)">
          <p className="text-zinc-700">
            ระบบมี rule 32 ข้อ · แบ่งเป็น 7 หมวด · severity 3 ระดับ:
          </p>
          <SeverityTable />
          <h3 className="mt-6 text-base font-semibold text-zinc-900">หมวดสำคัญที่ STAFF ต้องรู้</h3>
          <RuleCategoryList
            items={[
              {
                code: "C",
                name: "Continuity (มิเตอร์)",
                rules: [
                  "C1 มิเตอร์ห้ามถอยหลัง (P0 BLOCK)",
                  "C2 มิเตอร์เพิ่มเกิน threshold (P1 WARN)",
                ],
              },
              {
                code: "M",
                name: "Money (เงิน)",
                rules: [
                  "M1 เงินขาด >5% (P0 BLOCK · ต้องใส่เหตุผล)",
                  "M2 เงินขาด ฿20-100 → ANOMALY_REVIEW",
                  "M5 cash surplus (ขาดเป็นบวก) — สงสัยโกง → review",
                ],
              },
              {
                code: "P",
                name: "Product (สินค้า)",
                rules: [
                  "P1 ตุ๊กตาออกเกินมิเตอร์ → ANOMALY (สงสัยตู้พัง/ทุจริต)",
                  "P6 ตุ๊กตาเกิน capacity ตู้ → BLOCK",
                ],
              },
              {
                code: "G",
                name: "Group cross-check (หัวใจ)",
                rules: [
                  "G1 เหรียญตู้แลกแจก vs ตู้คีบรวม >5% diff → ANOMALY",
                  "G2 ปิด session ไม่ครบทุกตู้ → BLOCK (ต้องทำครบ)",
                  "G7 ตู้บางตัวไม่กรอก → BLOCK",
                ],
              },
              {
                code: "F",
                name: "Photo (รูปถ่าย)",
                rules: [
                  "F1 รูปไม่ครบ 4 ใบ (CLAW) → BLOCK",
                  "F5 รูปซ้ำกับ session ก่อน (hash match) → ANOMALY",
                ],
              },
            ]}
          />
        </Section>

        <Section id="keyboard" icon={<Keyboard className="h-5 w-5" />} title="§7 Keyboard Shortcuts">
          <p className="text-zinc-700">สำหรับคนที่ใช้ laptop · พิมพ์เร็วกว่ามือ:</p>
          <KeyboardTable />
        </Section>

        <Section id="qa" icon={<HelpCircle className="h-5 w-5" />} title="§8 คำถามพบบ่อย (Q&A)">
          <QAItem
            q="เปิดผิดตู้แล้วทำไง?"
            a="กดปุ่มย้อนกลับ · กรอกไม่ได้เพราะ scan QR ไม่ตรง · ระบบจะ block พร้อม audit log · ไม่กระทบ session"
          />
          <QAItem
            q="ถ่ายรูปไม่ผ่าน เน็ตช้า"
            a="รูปจะอยู่ในคิวรอ upload · ทำต่อได้เลย · ระบบ retry อัตโนมัติ · ถ้า 24 ชม. ยังไม่ผ่านจะแจ้งเตือน"
          />
          <QAItem
            q="Session ค้างมาเมื่อวาน"
            a="เปิด /clawfleet/operations → filter status=Active → จะเห็น session ค้าง · พนักงานเดิมเข้ามาทำต่อได้ · หรือ MGR กด handover ให้คนอื่น (Phase 1.5)"
          />
          <QAItem
            q="กรอกตัวเลขผิด · ขอแก้"
            a="ถ้ายังไม่กด submit → กดกลับมาแก้ได้ · ถ้า submit แล้ว → ให้ MGR ใช้ Recheck ในหน้า anomaly · จะ rollback แล้วให้กรอกใหม่"
          />
          <QAItem
            q="ทำไม anomaly เกิดขึ้น แต่ฉันกรอกถูก?"
            a="ดู drawer ใน Operations → จะเห็น 'cross-check detail' บอกว่า rule ไหนถูก trigger · ถ้าเชื่อว่าระบบผิด → ใส่ note แล้วให้ MGR approve"
          />
          <QAItem
            q="เจ้าของอยากดูสรุปวันนี้ทุกสาขา"
            a="เปิด /clawfleet/hub → branch picker = ทุกสาขา (default) · หรือ /clawfleet/insights → view=Branches → period=today"
          />
          <QAItem
            q="ลืม password / login ไม่ได้"
            a="ติดต่อ admin (CEO) ที่บัญชี Pool/JPSync ไม่ใช่ ClawFleet โดยตรง · ทุกคนใช้ Pool login เดียวกัน"
          />
          <QAItem
            q="หน้าเก่ายังอยู่ใหม?"
            a="ยังอยู่ · เปิดทาง URL ตรง: /clawfleet/sessions · /clawfleet/dashboard · /clawfleet/machines · ฯลฯ · แค่ไม่อยู่ใน nav หลัก · ถ้าใช้บ่อย bookmark URL เอา"
          />
        </Section>

        <Section id="contact" icon={<HelpCircle className="h-5 w-5" />} title="§9 ติดปัญหา / Contact">
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <ul className="space-y-2 text-sm text-zinc-700">
              <li><strong>ติดปุ่ม / ใช้งานไม่ได้</strong> — แจ้ง admin ของบริษัท · admin เปิด Setup → audit log ดู error trace</li>
              <li><strong>ข้อมูลผิด / Anomaly เยอะผิดปกติ</strong> — เจ้าของ + MGR คุยกัน · ปรับ threshold ใน Setup → System tab</li>
              <li><strong>เรื่องด่วน prod</strong> — TODO[claude-design]: เพิ่ม LINE bot help channel (Phase 1.5)</li>
              <li><strong>ขอ feature เพิ่ม</strong> — บันทึกใน <code>docs/AUDIT_clawfleet_2026-05-25.md</code> §10 (open questions)</li>
            </ul>
          </div>
        </Section>

        <PageFooter />
      </div>
    </div>
  );
}

// =============================================================
// Components
// =============================================================

function PageHeader() {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-blue-600">ClawFleet</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-900">คู่มือการใช้งาน</h1>
        <p className="mt-2 text-sm text-zinc-600">
          อ่าน 5 นาที · ครอบคลุม 3 บทบาท (พนักงาน · หัวหน้าสาขา · เจ้าของ) · 4 workspace · 32 rule
        </p>
      </div>
      <Link
        href="/clawfleet/hub"
        className="hidden shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 sm:inline-flex"
      >
        ← กลับ Hub
      </Link>
    </div>
  );
}

function TableOfContents() {
  const items = [
    { id: "overview", label: "§1 ภาพรวมระบบ" },
    { id: "workspaces", label: "§2 รู้จัก 4 workspace" },
    { id: "staff-flow", label: "§3 คู่มือพนักงาน" },
    { id: "mgr-flow", label: "§4 คู่มือหัวหน้าสาขา" },
    { id: "ceo-flow", label: "§5 คู่มือเจ้าของ" },
    { id: "rules", label: "§6 กฎกันโง่ 32 ข้อ" },
    { id: "keyboard", label: "§7 Keyboard shortcuts" },
    { id: "qa", label: "§8 Q&A" },
    { id: "contact", label: "§9 ติดต่อ" },
  ];
  return (
    <nav className="mb-8 rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold text-zinc-500">สารบัญ</p>
      <ol className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={`#${it.id}`}
              className="block rounded-md px-2 py-1 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          {icon}
        </div>
        <h2 className="text-xl font-semibold text-zinc-900">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function KeyFactsList({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 bg-white p-5 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-xs font-medium text-zinc-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-zinc-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkspaceCard({
  icon,
  title,
  href,
  who,
  why,
  features,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  who: string;
  why: string;
  features: string[];
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">{icon}</div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
            <p className="text-xs text-zinc-500">{who}</p>
          </div>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          เปิด <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <p className="mb-3 text-sm text-zinc-700">{why}</p>
      <ul className="space-y-1.5 text-sm text-zinc-700">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleBadge({ role, device, frequency }: { role: string; device: string; frequency: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 font-medium text-blue-800">
        {role}
      </span>
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-700">
        {device}
      </span>
      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-700">
        {frequency}
      </span>
    </div>
  );
}

function FlowSteps({ steps }: { steps: Array<{ num: string; title: string; detail: string; tip?: string }> }) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.num} className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {s.num}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-zinc-900">{s.title}</h4>
              <p className="mt-1 text-sm text-zinc-700">{s.detail}</p>
              {s.tip ? (
                <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{s.tip}</span>
                </p>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "info" | "warning" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  const toneClasses = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-rose-200 bg-rose-50 text-rose-900",
  }[tone];
  return (
    <div className={`mt-4 rounded-xl border ${toneClasses} p-4`}>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function SeverityTable() {
  const rows = [
    {
      severity: "P0 BLOCK",
      tone: "danger" as const,
      icon: <AlertTriangle className="h-4 w-4" />,
      meaning: "ระบบ block submit ทันที · ห้ามผ่าน · ต้องแก้ก่อน",
      example: "มิเตอร์ถอยหลัง · cross-check เกิน 5% · รูปไม่ครบ",
    },
    {
      severity: "P1 WARN (ANOMALY_REVIEW)",
      tone: "warning" as const,
      icon: <AlertTriangle className="h-4 w-4" />,
      meaning: "Session ผ่านได้ · แต่เข้า queue ให้ MGR review",
      example: "เงินขาด ฿20-100 · ตุ๊กตาออกเกิน · ตู้เงียบ >7 วัน",
    },
    {
      severity: "P2 INFO",
      tone: "info" as const,
      icon: <Coins className="h-4 w-4" />,
      meaning: "บันทึกใน log · ไม่ปลุกใคร · ไว้ดู pattern",
      example: "ตู้ระดับ stock ใกล้หมด · rate สูง",
    },
  ];
  const toneBg = {
    danger: "bg-rose-50 text-rose-700 border-rose-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-600">
          <tr>
            <th className="px-3 py-2">Severity</th>
            <th className="px-3 py-2">ความหมาย</th>
            <th className="px-3 py-2">ตัวอย่าง</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {rows.map((r) => (
            <tr key={r.severity}>
              <td className="px-3 py-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneBg[r.tone]}`}
                >
                  {r.icon} {r.severity}
                </span>
              </td>
              <td className="px-3 py-3 text-zinc-700">{r.meaning}</td>
              <td className="px-3 py-3 text-zinc-600">{r.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleCategoryList({
  items,
}: {
  items: Array<{ code: string; name: string; rules: string[] }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((cat) => (
        <div key={cat.code} className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white">
              {cat.code}
            </span>
            <h4 className="text-sm font-semibold text-zinc-900">{cat.name}</h4>
          </div>
          <ul className="space-y-1 text-xs text-zinc-700">
            {cat.rules.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function KeyboardTable() {
  const groups = [
    {
      title: "ทุกหน้า",
      keys: [
        { key: "g + h", action: "ไป Hub" },
        { key: "g + o", action: "ไป Operations" },
        { key: "g + i", action: "ไป Insights" },
        { key: "g + s", action: "ไป Setup" },
        { key: "?", action: "เปิด help (หน้านี้)" },
      ],
    },
    {
      title: "Operations drawer",
      keys: [
        { key: "a", action: "Approve anomaly" },
        { key: "r", action: "Recheck (ขอกรอกใหม่)" },
        { key: "e", action: "Escalate ส่ง CEO" },
        { key: "n", action: "Next anomaly" },
        { key: "p", action: "Previous anomaly" },
        { key: "Esc", action: "ปิด drawer" },
      ],
    },
    {
      title: "List pages (sessions/machines)",
      keys: [
        { key: "j", action: "Row ถัดไป" },
        { key: "k", action: "Row ก่อนหน้า" },
        { key: "Enter", action: "เปิด drawer ของ row นี้" },
      ],
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {groups.map((g) => (
        <div key={g.title} className="rounded-xl border border-zinc-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-semibold text-zinc-500">{g.title}</h4>
          <dl className="space-y-1.5 text-sm">
            {g.keys.map((k) => (
              <div key={k.key} className="flex items-center justify-between gap-3">
                <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs text-zinc-800">
                  {k.key}
                </kbd>
                <dd className="text-right text-xs text-zinc-700">{k.action}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function QAItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-zinc-200 bg-white p-4 open:bg-zinc-50">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start gap-2">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 transition-transform group-open:rotate-90" />
          <h4 className="text-sm font-semibold text-zinc-900">{q}</h4>
        </div>
      </summary>
      <p className="mt-2 pl-6 text-sm text-zinc-700">{a}</p>
    </details>
  );
}

function PageFooter() {
  return (
    <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
      <p>
        คู่มือนี้อัพเดต 2026-05-26 · build ผ่าน skill <code>/claude-design</code> ·
        แก้ไขที่ <code>app/(admin)/clawfleet/help/page.tsx</code>
      </p>
      <p className="mt-1">
        Spec เต็ม: <code>docs/AUDIT_clawfleet_2026-05-25.md</code> ·
        Master plan: <code>docs/CLAWFLEET_PLAN.md</code>
      </p>
    </footer>
  );
}

# Deep Feature Audit — ChairOps (office + maid) · 2026-06-03

> Triggered by CEO: "ทำให้เมนูใช้ได้จริงบนมือถือ + deep research หาปัญหา วิเคราะห์ฟีเจอร์ทั้งหมด ให้มั่นใจว่าทุกฟีเจอร์ใช้งานได้จริงและไปทางเดียวกัน"
> Branch `claude/chairops-parts-history` (merged onto origin/setup `7df0c88`). tsc 0 errors. Pre-deploy adversarial review = SHIP (0 blockers).

## Scope
18-area deep audit across BOTH surfaces (9 office + 6 maid + 3 cross-cutting), each area deep-walked then **every finding adversarially verified** (independent agent re-read the code, default-refute). 91 agents. **69 raw → 60 confirmed (4 P0 / 23 P1 / 33 P2).**

## New feature shipped
- **Office mobile bottom-nav** (`(office)/_components/office-bottom-nav.tsx`): 4 primary tabs (หน้าหลัก/เก็บเงิน/ฝากเงิน/ตรวจยอด) + "เพิ่มเติม" bottom-sheet (งานซ่อม/เบิกของ/บิล/แม่บ้าน/POS/เตือน/ตัดเงินขาด). Mirrors maid bottom-nav; mobile-only (`lg:hidden`); home tab exact-match. All 11 hrefs verified to resolve.

## Fixed (P0 / P1)
| # | sev | area | fix | commit |
|---|---|---|---|---|
| broken redirects | P0/P1 | pos-ingest + write-offs/reconcile | 11 error-path redirects missing `/chairops` prefix → 404. Now prefixed. | 5380ba0 |
| deposit diff display | P0 | maid deposit | "ผลต่าง" showed `diff` (no bank fee) while the fraud-gate uses `eff` (with fee) → number contradicted the warning. Display `eff` + fix label. | 5380ba0 |
| cross-tenant leak | P1 | damage list | where-clause had no `orgId` (ChairOps has no RLS) → other orgs' tickets visible. Scoped to session org. | 5380ba0 |
| stale data (coherence) | P1 | deposit/write-off/damage/parts | missing `revalidatePath` → drift/counts/hub didn't refresh on the pages that show them. Added targeted revalidations. | 5380ba0 |
| badge/KPI/hub scope | P0/P1 | maid layout + parts hub + home agg | badge + parts-hub now branch-scoped + orgId to match the home KPI exactly. | 5380ba0, b471386 |
| alert acker integrity | P1 | alerts | resolveAlert overwrote `ackedById` with the resolver → lost the acknowledger. Resolver is in the audit log, so dropped the overwrite. | 7ef4693 |
| mobile KPI grid | P1 | office dashboard | inline auto-fit grid → responsive `grid-cols-2/sm:3/lg:4` (8 tiles read cleanly on phone). | 7ef4693 |

## Deliberately NOT applied (audit fix was wrong / conflicts with design)
- **P1-7 reconcile "collected" flag** — suggested `dep && deposit>=pending` would show `diff=0` on partial-deposit rows while `closedDrift` still accumulates the shortage → MORE incoherent. Current behavior is correct.
- **Maid-layout non-maid bounce** (P1-21/P0-4) — bounce to `/chairops/branch-collect` is INTENTIONAL (CEO 2026-05-30: lets owner collect-on-behalf from one tap). Audit's "forbidden toast / audit log" would regress it.
- **P1-1 dashboard table** — `overflow-auto` already scrolls; new layout bottom-padding keeps it clear of the nav.

## ⚠️ Near-miss caught (deploy safety)
Branch was cut from `f77cf66` but `origin/setup` had advanced to `7df0c88` with the **5-piece sprint (Google Drive backup / slip viewer / pay window / maid payroll / bills window) already LIVE on prod**. A naive merge would have **deleted all of it** (`git diff origin/setup..HEAD` showed −2,555 incl. those files). Fixed by **merging `origin/setup` into the branch first** (clean auto-merge, no conflicts) — both feature sets now coexist; final diff = +439/−45, ONLY this audit's work.

## Deferred (P2 ×33 + non-safe P1) — next round
FAB(AI) sits behind the office bottom-nav on mobile (cosmetic); bottom-nav not persistent on `/chairops/damage` + `/chairops/parts` (outside office group); deposit success-ID feedback; write-off keyboard focus; ~30 minor copy/consistency items. None block daily use.

## Manual test (after deploy)
1. มือถือ · บัญชีออฟฟิศ → เปิด ChairOps → เห็น **แถบเมนูล่าง 5 ปุ่ม** · กดครบทุกปุ่ม + "เพิ่มเติม" เด้ง sheet.
2. ฝากเงิน (มีค่าธรรมเนียม) → ตัวเลข "ผลต่าง" ตรงกับคำเตือน.
3. ทำให้เกิดข้อมูลใหม่ (เก็บ/ฝาก/แจ้งซ่อม/เบิกของ) → ตัวเลขอัปเดตทุกหน้า (dashboard/reconcile/home).
4. ฟีเจอร์เดิม (Drive backup/slip/payroll/bills) ยังทำงานปกติ.

# BIGFEATURE · Playland Wristband + POS expansion · Spec
> 2026-05-26 · /bigfeature run · Scope=Playland only

## Phase 0 · Context (compressed)
Playland is LIVE Pool module · 28 routes · uses scoped `.pl-root` design tokens · auth via session+role+module-entitlement gate. ACS-F606 face reader integrated (mock + real adapter). Face register works via webcam OR upload (camera=(self) Permissions-Policy fixed earlier this session). Memory rules in force: [[playland-workshop-decisions]] · [[acs-f606-api-spec-received]] · [[claude-design-playland-2026-05-26]] · [[ceo-prefers-multi-pane-workspace]] · [[role-rank-privilege-escalation-guard]] · [[module-entitlement-must-gate-all-layouts]] · [[feedback-real-world-verification]].

## Phase 1+2 · Goal lock (CEO answers from prior turn)

7 epics requested:
- **W1 Wristband mode** (Harborland-style · QR strap · ADDITIVE to face per ans 1B · format = small QR square per ans 2)
- **W2 Mobile QR scanner** (cashier phone scans wristband + barcode)
- **W3 Shift required** (per ans 4A · block all transactions if no open shift)
- **W4 Extend session payment modal** + PromptPay QR placeholder
- **W5 Family cart** (multi-package + products in one checkout)
- **W6 Full POS scope** (per ans 5BC · PO doc + supplier + multi-line + GR + return + transfer)
- **W7 Stock count** (variance form)

CEO scan-state machine (ans 3):
1. **Scan #1** = lookup `code` → if unbound → cashier binds to paid member (issue)
2. **Scan #2** at gate = state ISSUED → ACTIVE + opens session + gate
3. **Scan #3+** = picker: ออก / ขายของ (charge-to-bill)

Build mode: **Full ship**. Goal hook active.

## Phase 4 · SPEC (synthesis · 13-persona output compressed)

### Data model
```prisma
model PlaylandWristband {
  id           String                  @id @default(uuid()) @db.Uuid
  orgId        String                  @map("org_id") @db.Uuid
  branchId     String                  @map("branch_id") @db.Uuid
  code         String                  @unique           // QR payload · 12-char short
  memberId     String?                 @map("member_id") @db.Uuid
  sessionId    String?                 @map("session_id") @db.Uuid
  status       PlaylandWristbandStatus @default(ISSUED)  // ISSUED / ACTIVE / RETURNED / LOST
  issuedAt     DateTime                @default(now())
  issuedByUserId String                @map("issued_by_user_id") @db.Uuid
  boundAt      DateTime?               @map("bound_at")
  activatedAt  DateTime?               @map("activated_at")
  returnedAt   DateTime?               @map("returned_at")
  notes        String?
  member       PlaylandMember?         @relation(fields: [memberId], references: [id])
  session      PlaylandSession?        @relation(fields: [sessionId], references: [id])
  scans        PlaylandWristbandScan[]
  @@index([orgId, branchId])
  @@index([code])
  @@map("wristbands")
  @@schema("playland")
}

model PlaylandWristbandScan {
  id           String   @id @default(uuid()) @db.Uuid
  orgId        String   @map("org_id") @db.Uuid
  wristbandId  String   @map("wristband_id") @db.Uuid
  scannedByUserId String? @map("scanned_by_user_id") @db.Uuid
  scanType     String                                          // BIND / GATE_IN / GATE_OUT / POS_CHARGE / EXIT
  outcome      String                                          // ok / blocked / error
  metadata     Json?
  scannedAt    DateTime @default(now()) @map("scanned_at")
  wristband    PlaylandWristband @relation(fields: [wristbandId], references: [id], onDelete: Cascade)
  @@index([wristbandId, scannedAt])
  @@map("wristband_scans")
  @@schema("playland")
}

enum PlaylandWristbandStatus { ISSUED  ACTIVE  RETURNED  LOST  @@schema("playland") }
```

### Routes (new)
- `/playland/wristbands` (admin) — cashier issues new wristband · binds to member · prints/shows QR
- `/playland/scan` (admin) — universal scanner UI · input box (works with USB barcode scanner) · processes any QR
- `/api/playland/wristband/scan` (POST) — server lookup + state transition
- `/api/playland/wristband/issue` (POST) — bind code → member
- `/playland/settings/stock-count` (admin) — W7 stock count form

### Server actions (new in `lib/playland/wristband.ts`)
- `issueWristband({ branchId, memberId, code })` → cashier hands out
- `scanWristband(code)` → returns `{ wristband, member, allowedActions[] }`
- `executeWristbandAction(code, action: "GATE_IN"|"GATE_OUT"|"POS_CHARGE"|"EXIT")` → state transition + side effects

### W3 Shift gate (modify existing actions)
- Add `requireOpenShift({ orgId, branchId, userId })` helper in `lib/playland/actions.ts`
- Apply to: `checkInSession` · `createSale` · `issueWristband` · `extendSession`
- Return error if no shift · UI shows banner + "เปิดกะก่อนทำรายการ" CTA
- Per [[playland-workshop-decisions]] CEO confirmed: ปิดกะ manual + per-shift (ans Q20=a)

### W4 Extend payment modal (modify session-inspector)
- Replace inline doExtend with `<ExtendPaymentModal>` client component
- Method picker: Cash / PromptPay / Stripe / Charge-to-bill
- PromptPay → show placeholder QR (uses `promptpay-qr` lib if available else SVG placeholder · TODO real API)

### W7 Stock count (settings sub-page)
- Lists all products for branch · system stock · input "นับจริง" · variance auto
- Save = creates audit log entry · updates product.stock to counted value
- No new table needed · log via PlaylandAuditLog category="general"

### Consistency checklist ✓
- [x] Uses `.pl-root` design tokens
- [x] Module entitlement gate via existing `/playland/layout.tsx`
- [x] Role guard: `requirePlaylandCashier` for issue/scan · `requirePlaylandManager` for stock count
- [x] Audit log on issue · bind · activate · count adjustment
- [x] Respects: shift gate (W3) + face register pattern + family group pattern + RLS
- [x] Mobile responsive (scanner = priority mobile)
- [x] No AI auto-run

### Stubs for W2 W5 W6 (out of scope this sprint · greppable TODO[bigfeature])
- W2 mobile camera QR scan: today uses USB scanner / manual paste · BarcodeDetector API hook = TODO
- W5 family cart: today register-one-at-a-time · cart-of-sessions = TODO
- W6 full PO: today stock count updates direct · supplier/PO/transfer = TODO

### Effort estimate
Sprint A (this turn): W1 + W3 + W4 + W7 = ~4 dev-days squeezed into 1 build turn
Sprint B (next turn): W2 + W5 + W6 = ~6 dev-days

### Risks
1. **Wristband code collision** — 12-char alphanumeric · 36^12 = sufficient · enforce DB UNIQUE
2. **Cashier issues wrong wristband to wrong member** — confirm UI shows member photo before bind
3. **Lost wristband** — `status=LOST` field · cashier can mark · prevents re-use
4. **No shift open during peak** — banner + 1-click "เปิดกะตอนนี้" inline action
5. **PromptPay QR is placeholder** — CEO sigend off "ทำ api ทีหลัง" so OK

### Acceptance criteria
- Cashier can issue wristband to a member · QR generated · printable
- Member scans at gate · session activates · gate signal sent (or mock event)
- Member scans again · picker shows: ออก / ขายของ
- POS sale + wristband = charges to member's bill (uses existing chargeSession flow)
- No transaction allowed if no open shift · banner shown
- Extend session prompts for payment method · PromptPay shows QR
- Stock count saves variance + updates stock + audit log

## Phase 5 · GO confirmed (CEO goal hook + ship-everything directive)

## Phase 6 · BUILD starts now (Sprint A)

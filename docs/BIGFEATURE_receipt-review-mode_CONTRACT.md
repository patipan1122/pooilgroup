# CONTRACT — Receipt-Review "middle form" (reuse existing money/accounting server actions 100%)

> Goal: wire a **brand-new** receipt-review form component to the SAME server actions the current
> `ExpenseReviewPane` uses. **No new write paths.** Every signature below is copied verbatim from the
> worktree (`pg-wt-receipt-review`); function bodies omitted. Cite `file:line`.
>
> Golden rules that constrain the new form:
> - **Never auto-post.** A row stays `draft` until a human presses save/confirm (`ExpenseReviewPane.tsx:5`, `:1589`).
> - **input-VAT claimability is NOT editable via save/confirm** — it is written ONLY through
>   `overrideClaimability()` (accountant-gated). `patchSchema` deliberately omits it (`_actions.ts:138-143`).
> - The pane is a **controlled draft** — it holds ALL fields in one `draft` object and passes the whole
>   `ExpenseDraft` to `onSave`/`onConfirm`. There is no per-field PATCH endpoint; save = full replace.

---

## 1. `ExpenseDraft` — the editable draft-state shape
`components/ledger/ExpenseReviewPane.tsx:70-98` (exported)

```ts
export type ExpenseDraft = {
  vendor: string;
  vendorTaxId: string;
  docDate: string;               // "YYYY-MM-DD"
  categoryId: string;
  branchId: string;
  paymentMethod: string;
  subtotal: number;
  vat: number;
  wht: number;
  total: number;
  note: string;
  title: string;                 // user label shown instead of docCode ("" = fall back to docCode)
  // — Bainy-parity fields —
  docType: ExpenseDocType;
  vendorDocNumber: string;
  vendorAddress: string;
  vendorBranchCode: string;
  discount: number;
  paymentStatus: PaymentStatus;
  claimantName: string;
  bankDetail: string;
  isRecurring: boolean;
  // — Input-VAT claimability — accountant sets "claimable?" + reason (NOT sent via save/confirm) —
  inputVatClaimable: boolean | null;
  inputVatBlockReason: InputVatBlockReason | null;
  items: ExpenseItem[];
};
```

**How the pane seeds `draft`** (`:363-388`): every field = `expense.<field> ?? <fallback>` — e.g.
`docType: expense.docType ?? "tax_invoice"`, `discount: expense.discount ?? 0`,
`paymentStatus: expense.paymentStatus ?? "paid"`, `items: expense.items ?? []`.
Draft is `useState<ExpenseDraft>`; a generic setter `set<K>(k, v)` (`:494-497`) updates one key and clears the status msg.

**Draft-save bridge** (`:389-396`): `registerDraftSaver(expense.id, () => onSave(id, draftRef.current).ok)` from
`@/lib/ledger/draft-save-registry` — lets an out-of-island "ส่ง TRCloud" button flush the latest draft
before pushing. A new form should register the same way if it lives on the admin page.

---

## 2. `ExpenseReviewPane` — full Props interface
`components/ledger/ExpenseReviewPane.tsx:296-362`

```ts
{
  expense: ExpenseRow;                         // = Expense (lib/ledger/types)
  replacement?: ExpenseRow | null;             // replacement invoice (show 2 receipts side-by-side)
  categories: CategoryOption[];
  branches: BranchOption[];
  onSave: SaveExpenseAction;
  onConfirm: ConfirmExpenseAction;
  onVoid: VoidExpenseAction;
  onOverrideClaimability?: OverrideClaimabilityAction;
  onAttachReplacement?: AttachReplacementAction;
  onSelfDelete?: SelfDeleteAction;
  onRequestDelete?: RequestDeleteAction;
  onEnsureCentralBranch?: EnsureCentralBranchAction;
  onRequestPayout?: () => Promise<LedgerActionResult>;   // "ขอโอน" — bound to createPaymentRequestAction([id],{})
  projects?: ProjectOption[];
  onSetProject?: SetExpenseProjectAction;
  currentUserId?: string | null;               // decides self-delete-vs-request-delete
  readOnly?: boolean;                           // default false — locked/void → view-only
  canConfirm?: boolean;                         // default true — false = staff, save-draft only
  canEditClaimability?: boolean;                // default false — accountant → VAT override + replacement
  showTrcloud?: boolean;                        // default true — hide TRCloud + VoucherMenu (LIFF)
  showSendToTrcloud?: boolean;                  // default true — hide in-pane "ส่ง TRCloud" button only
  onAfterFinish?: (action?: "confirm" | "delete" | "void") => void;  // web=router.refresh, LIFF=back
}
```

### Action-prop type aliases (all exported from `ExpenseReviewPane.tsx`)
```ts
export type LedgerActionResult = { ok: boolean; error?: string };                                    // :139
export type SaveExpenseAction    = (id: string, patch: ExpenseDraft) => Promise<LedgerActionResult>; // :141
export type ConfirmExpenseAction = (id: string, patch: ExpenseDraft) => Promise<LedgerActionResult>; // :145
export type VoidExpenseAction    = (id: string) => Promise<LedgerActionResult>;                      // :149
export type OverrideClaimabilityAction = (raw: {                                                     // :151
  expenseId: string; claimable: boolean; reason?: InputVatBlockReason;
}) => Promise<LedgerActionResult>;
export type SelfDeleteAction    = (id: string) => Promise<LedgerActionResult>;                        // :157
export type RequestDeleteAction = (id: string, reason?: string) => Promise<LedgerActionResult>;       // :159
export type EnsureCentralBranchAction = (companyId: string) => Promise<LedgerActionResult & { branchId?: string }>; // :165
export type SetExpenseProjectAction = (expenseId: string, projectId: string | null) => Promise<LedgerActionResult>; // :170
// AttachReplacementAction lives in AttachReplacementButton.tsx:26 (see §7)
```

Also exported: `runRecheck(d: ExpenseDraft): RecheckFinding[]` (`:246`), `type RecheckFinding = { field, level:"warn"|"error", message }` (`:132`).

---

## 3. Totals math — EXACT location
**All client-side totals/validation live in `runRecheck()`** — `ExpenseReviewPane.tsx:246-279`. There is NO
separate "compute totals" function; the form treats `subtotal/discount/vat/wht/total` as **independently
editable numbers** and only *validates* the additive identity:

- **Additive identity** (`:255`): `computed = subtotal - (discount ?? 0) + vat - wht`.
  Blocks confirm (`level:"error"`) when `total > 0 && Math.abs(computed - total) > 1` (1.00 baht tolerance —
  MUST match server `recheck.ts` MONEY_TOL).
- **VAT sanity** (`:267-277`): `taxBase = subtotal - discount`; warns if `|vat/taxBase - 0.07| > 0.02`.
- **Tax-id shape** (`:248`): warns if `vendorTaxId` not 13 digits.

**Line-item math** (`:503-521`): `updateItem()` recomputes `amount = +(qty*unitPrice).toFixed(2)` unless
`amount` was the edited field. `itemsSum = Σ items.amount` (`:518`). A "เติมยอดย่อยจากรายการ" button sets
`subtotal = itemsSum` when they differ ≥1 (`:1169-1177`).

**Amount that must be transferred (ยอดที่ต้องโอน)** is NOT computed in the pane — it is computed **server-side**
inside `createPaymentRequest()` (returns `billsGross`, `whtTotal`, `expectedTransfer`; see §5 payment-request).
The pane only sends `[expense.id]` + payee. Do the same in the new form; never client-compute the payout.

**Confirm-gate** (`:529-538`): `expenseConfirmability({ branchId, categoryId })` from
`@/lib/ledger/confirmability` → `{ ok, missing: ("branch"|"category")[] }`. Save button "commits"
(calls `onConfirm`) only when `canConfirm && gate.ok && !hasError && status==="draft"`, otherwise `onSave`
(`:1601-1620`). Server re-checks in every action.

---

## 4. `docType` dropdown, status pill, "ออกเอกสาร", locked logic
- **Status pill**: `<StatusBadge status={expense.status} />` (`:783`) — see §8.
- **`ออกเอกสาร` menu** = two components in the header (`:750-782`):
  - `<SendToTrcloudButton .../>` (gated by `showTrcloud && showSendToTrcloud`) — props: `expenseId, status,
    docType, trcloudDocId, trcloudDocNo, trcloudError, trcloudApDocId, trcloudApDocNo, trcloudApError,
    onBeforeSend:()=>Promise<boolean>`. `onBeforeSend` calls `onSave(id, draft)` and returns `.ok` so the
    push always sends the freshest draft.
  - `<VoucherMenu expenseId companyId vendorTaxId disabled defaultSubReason />` — the PV/JV/PCV/ใบแทน dropdown;
    `disabled` unless `status ∈ {confirmed, locked}`.
- **`docType` select** (`:973-983`): options from `DOC_TYPES` const.
- **Locked derivation** (`:443-449`):
  ```ts
  const trState = trcloudState(expense.trcloudDocId);   // "sent" | "pending" | "error" | null (lib/ledger/trcloud-state)
  const locked = readOnly || status==="locked" || status==="void" || trState==="sent" || trState==="pending";
  ```
  A **failed** push (`trState==="error"`) stays EDITABLE for retry. When `locked`, the whole form disables
  and the sticky action bar is hidden (`:1591`).

### Module-level constants (all in `ExpenseReviewPane.tsx`, copy or re-import)
```ts
DOC_TYPES: {value:ExpenseDocType,label}[]        // :104-111  (tax_invoice, receipt, cash_bill, quotation, delivery_note, other)
PAYMENT_STATUSES: {value:PaymentStatus,label}[]  // :113-117  (paid, unpaid, partial)
PAYMENT_METHODS: string[]                        // :234-240  (เงินสด, โอน, บัตรเครดิต, เช็ค, อื่นๆ)
BLOCK_REASON_OPTIONS: InputVatBlockReason[]      // :224-232
COMPLETENESS_META, BUYER_MATCH_LABEL, BLOCK_REASON_LABEL   // :176-221 (copy maps for the status banner)
SELF_DELETE_WINDOW_MS = 5*60*1000                // :243 (mirrors server)
```

---

## 5. Server actions — `app/(admin)/ledger/_actions.ts`
`export type ActionResult = { ok: boolean; error?: string; warning?: string };` (`:70`)

### 5a. Shared edit schema (the `raw` arg for save/confirm/liff)
`patchSchema` (`:111-143`) → `export type ExpensePatch = z.infer<typeof patchSchema>` (`:144`). Fields (all
coerced/trimmed): `vendor` (req), `title?`, `vendorTaxId` (req), `docDate` (req, max10), `categoryId` (req),
`branchId` (req), `paymentMethod` (req), `subtotal/vat/wht/total` (req, `coerce.number().min(0)`), `note`
(req, max1000), `docType?` (enum 6), `vendorDocNumber?`, `vendorAddress?`, `vendorBranchCode?`, `discount?`
(min0), `paymentStatus?` (enum 3), `claimantName?`, `bankDetail?`, `isRecurring?`, `items?` (array `itemSchema`
max100). `itemSchema` = `{ description(max300), qty, unitPrice, amount, vatRate?|null }` (`:104-110`).
**`ExpenseDraft` is a superset-compatible shape** — the pane passes the whole draft object as `raw`; extra keys
(`inputVatClaimable`, `inputVatBlockReason`) are simply ignored by the schema (strip-not-fail).

### 5b. Core CRUD / confirm / void
```ts
saveExpense(id: string, raw: unknown): Promise<ActionResult>                 // :318 — full-replace edit; blocked if pushed/locked/void/in-active-request; creator-or-admin only
confirmExpense(id: string, raw: unknown): Promise<ActionResult>             // :390 — draft→confirmed; expense.confirm cap; recheckReceipt() blocking-math gate
voidExpense(id: string): Promise<ActionResult>                             // :527 — →void; expense.confirm cap
```

### 5c. VAT claimability + replacement
```ts
overrideClaimability(raw: unknown): Promise<ActionResult>                   // :854
  // overrideSchema (:832-846): { expenseId: uuid, claimable: boolean, reason?: <7 InputVatBlockReason enum> }
attachReplacementInvoice(raw: unknown): Promise<ActionResult & { replacementId?: string; completenessStatus?: string }>  // :917
  // attachReplacementSchema (:897-906): { expenseId: uuid, imageBase64?: string, url?: string } (require one)
```

### 5d. TRCloud push / AP convert / PV  (all `expense.export` cap, need `trcloudPushConfigured()`)
```ts
sendExpenseToTrcloud(id: string): Promise<ActionResult & { docNo?: string|null; alreadySent?: boolean; warning?: string }>   // :1699
deleteTrcloudApAction(expenseId: string, trcloudDocId: string): Promise<ActionResult>                                        // :1640 — clears docId so it can re-push; expense.confirm cap
convertExpenseToAp(id: string): Promise<ActionResult & { apDocNo?: string|null; alreadyAp?: boolean }>                       // :1812
testCreatePvForAp(expenseId: string): Promise<ActionResult & { pvDocNo?: string|null; pvError?: string|null }>              // :1844 — manual PV test
convertExpensesToAp(ids: string[], companyId: string): Promise<ActionResult & { converted?; skipped?; failed?; firstError? }> // :1883
sendExpensesToTrcloud(ids: string[], companyId: string): Promise<ActionResult & { sent?; skipped?; failed?; firstError?; quotationsSent? }> // :1931
```

### 5e. Bulk (list-toolbar) — all companyId-scoped
```ts
bulkConfirm(ids: string[], companyId: string): Promise<ActionResult & { confirmed?; skipped?; skippedReasons?: { math; missingBranch; missingCategory } }>  // :611
bulkClassify(ids: string[], branchId: string, categoryId: string, companyId: string): Promise<ActionResult & { updated?: number }>  // :714 — set สาขา+หมวด batch, stays draft
bulkVoid(ids: string[], companyId: string): Promise<ActionResult & { voided?; skipped? }>  // :762
```

### 5f. Payment request ("ขอโอน" / slip) — flag `LEDGER_PAYREQ_V1`
```ts
createPaymentRequestAction(billIds: string[], payeeRaw: unknown): Promise<ActionResult & { requestId?: string }>  // :3753
  // zPayee (:3735-3749): { acctName?, bankCode?, acctNo?, promptpay?, qrPayload?, qrImageUrl? } — require ≥1 destination.
  // Server computes billsGross / whtTotal / expectedTransfer inside createPaymentRequest() and pushes a LINE card.
  // The pane binds it as: onRequestPayout = () => createPaymentRequestAction([expense.id], {})   (ExpensePaneClient:81)
resendPaymentRequestAction(requestId: string): Promise<ActionResult>       // :3862 — re-push card, open/partial only
cancelPaymentRequestAction(requestId: string): Promise<ActionResult>       // :3933 — owner or accountant
assignSlipToRequestAction(paymentId: string, requestId: string): Promise<ActionResult>  // :3967 — accountant; auto PV after match
markBillPaidCash(expenseId: string): Promise<ActionResult>                 // :3160
```

### 5g. Delete / project / lookup / vendor-autofill / no-receipt / central-branch
```ts
selfDeleteExpense(id: string): Promise<ActionResult>                       // :4274 — own+draft+not-pushed+<5min+not-in-active-req → soft-void
requestDeleteExpense(id: string, reason?: string): Promise<ActionResult>  // :4325 — LINE ping to accountants; always ok from user side
setExpenseProjectAction(expenseId: string, projectId: string | null): Promise<ActionResult>  // :3361 — job-costing tag; own-or-edit_others
ensureCentralBranch(companyId: string): Promise<ActionResult & { branchId?: string }>  // :4191 — idempotent find-or-create "สำนักงาน (ส่วนกลาง)"
lookupPurchaseHistoryAction(term: string, companyId: string): Promise<{ ok; hits; trend; vendorCompare }>  // :3207 — read-only (searchPurchases)
lastPayeeForVendor(vendor: string, companyId: string): Promise<{ acctName?; bankCode?; acctNo?; promptpay? } | null>  // :4004 — autofill payee from last request; fallback bill.bankDetail
createNoReceiptExpense(input: { companyId; vendor; total; reason; categoryId?; branchId?; docDate? }): Promise<{ ok:true; id; docCode } | { ok:false; error }>  // :4467
exportConfirmedCsv(raw: unknown): Promise<ExportResult>                    // :1478 — ExportResult = {ok:true;csv;filename;rows} | {ok:false;error} (:1474)
```

> **On "จำค่านี้ไว้ให้ผู้ขาย" / "ใช้ค่าเดิม":** there is **no** dedicated "remember vendor defaults" write
> action. Vendor payee reuse is implemented as a **read**: `lastPayeeForVendor(vendor, companyId)` (`:4004`),
> called from the LIST-side payout flow (`ExpenseList.tsx:321,343`), which pre-fills the ขอโอน payee form.
> The "memory" is simply the most-recent `ledgerPaymentRequest` snapshot for that vendor. If the new
> middle-form needs payee autofill, call `lastPayeeForVendor` — do not invent a new store.
> (Note: "ใช้ค่าเดิม" string in `settings/LineChannelCard.tsx` is unrelated — LINE channel secrets.)

---

## 6. `ExpensePaneClient` — the thin wrapper (what page.tsx wires)
`app/(admin)/ledger/expenses/_components/ExpensePaneClient.tsx`

Props IN (`:26-51`): `expense: ExpenseRow`, `replacement?`, `categories: CategoryOption[]`,
`branches: BranchOption[]`, `projects?: ProjectOption[]`, `canEditClaimability=false`,
`currentUserId?: string|null`, `payreqEnabled=false`, `showSendToTrcloud=true`.

Action binding (`:53-88`): imports from `../../_actions` and maps 1:1 —
`onSave→saveExpense`, `onConfirm→confirmExpense`, `onVoid→voidExpense`,
`onOverrideClaimability→overrideClaimability`, `onAttachReplacement→attachReplacementInvoice`,
`onSelfDelete→selfDeleteExpense`, `onRequestDelete→requestDeleteExpense`,
`onEnsureCentralBranch→ensureCentralBranch`, `onSetProject→setExpenseProjectAction`,
`onRequestPayout→ (payreqEnabled ? ()=>createPaymentRequestAction([expense.id],{}) : undefined)`,
`onAfterFinish→router.refresh()`.

**Server `page.tsx` passes** (`app/(admin)/ledger/expenses/page.tsx:591-607`):
`expense=selectedExpense`, `replacement=replacementExpense`, `categories` (mapped `{id,name,color,sort,active}`),
`branches=scope.branches`, `projects=projectOptions`, `canEditClaimability` (`ledgerWebCanForRole(... "expense.confirm")` `:161`),
`currentUserId=session.user.id`, `payreqEnabled=ledgerPayreqV1()`, `showSendToTrcloud={false}` (TRCloud lives in the
outer combined `TrcloudButton`, not the pane). → A middle-form replacement drops in the same props;
`selectedExpense` is already the fully-serialized `Expense`.

---

## 7. Primitives — prop signatures

**`SearchableSelect`** — `components/ledger/SearchableSelect.tsx:16-38`
```ts
{ options: SelectOpt[]; value: string; onChange: (id:string)=>void;
  placeholder?="— เลือก —"; disabled?=false; className?; selectClassName?;
  searchPlaceholder?="ค้นหา..."; label? }
// SelectOpt = { id: string; name: string }  (:11-14)
```

**`AmountInput`** — `components/ledger/_kit/AmountInput.tsx:27-43`
```ts
{ value: number | null; onValueChange: (v:number)=>void; name?; placeholder?="0.00";
  disabled?; className?; ariaLabel? }   // holds raw typed string; "฿" prefix; tabular-nums
```

**`ProjectPicker`** — `components/ledger/ProjectPicker.tsx:19-35`  (thin wrapper over SearchableSelect)
```ts
{ value: string; options: ProjectOption[]; onChange: (projectId:string|null)=>void; disabled?=false; placeholder?; className? }
export interface ProjectOption { value: string; label: string }   // :11-14
```

**`AttachReplacementButton` / action** — `components/ledger/AttachReplacementButton.tsx:26-29`
```ts
export type AttachReplacementAction = (raw: { expenseId: string; imageBase64: string }) => Promise<AttachReplacementResult>;
// AttachReplacementResult = { ok; error?; replacementId?; completenessStatus? }  (:19-24)
```

**Kit barrel** — `components/ledger/_kit/index.ts` re-exports: `StatusBadge, LedgerStatus, ConfidenceTag,
CompletenessDot, missingLabel, MISSING_LABELS, DocTag, PaymentTag, docTagOf, AmountInput,
LedgerHeaderSkeleton` + types `ExpenseRow, ExpenseItemRow, CategoryOption, BranchOption, CompanyOption,
BudgetRow, LedgerStatusValue, LedgerSourceValue`.

**`StatusBadge`** — `_kit/StatusBadge.tsx:18-24`: `{ status: LedgerStatus|string; className? }` →
`<Badge tone>` (draft=warning "ร่าง · รอยืนยัน", confirmed=success, locked=info, void=neutral).

**`DocTag`** — `_kit/StatusTags.tsx:48-60`: `{ docType?; vat?; completenessStatus?; missing?: string[]|null; className? }`.
**`docTagOf`** `:20-46`: `(p:{docType?;vat?;completenessStatus?}) => { label; tone } | null`.
**`PaymentTag`** `:78-86`: `{ status?: PaymentStatus|string|null; dupWarning?=false; className? }`.

**`CompletenessDot`** — `_kit/CompletenessDot.tsx:39-47`: `{ status: CompletenessStatus|string; missing?: string[]|null; className? }`.
Exports `missingLabel(token)` + `MISSING_LABELS`.

**`ConfidenceTag`** — `_kit/ConfidenceTag.tsx:22-31`: `{ score: number|null|undefined; showLabel?=false; className? }`
(returns null if score null; levels high≥0.85 / mid≥0.6 / low).

---

## 8. `ReceiptThumb` + PDF guard + lightbox (reuse for new dark multi-page viewer)
`components/ledger/ReceiptThumb.tsx`

```ts
export function ReceiptThumb({ thumbUrl, originalUrl?, alt?="ใบเสร็จ", className? }): JSX  // :16-26
  // props type: { thumbUrl: string|null|undefined; originalUrl?: string|null; alt?: string; className?: string }
```
- **PDF guard** (`:12-14`) — reuse this verbatim:
  ```ts
  function isPdfUrl(u: string | null | undefined): boolean { return !!u && /\.pdf(\?|#|$)/i.test(u); }
  ```
  `src = thumbUrl || originalUrl`; `fullUrl = originalUrl || thumbUrl`. If `isPdfUrl(fullUrl)||isPdfUrl(src)`
  → renders a "เอกสาร PDF" card with an "เปิด PDF" external link, **no `<img>`/lightbox** (`:32-56`).
- **Image** — plain `<img>` (avoids next/image domain config), `onError→setBroken(true)` → placeholder
  ("ไม่มีรูปใบเสร็จ") (`:58-70`). Thumb caps `max-h-44 object-contain`.
- **Lightbox** (`:99-141`) — local `useState open`; full-screen `fixed inset-0 z-[100] bg-black/90`, tap
  backdrop/✕ to close, tap image `stopPropagation`, "เปิดต้นฉบับ" link to `fullUrl`. `<img src={fullUrl||src}
  max-h-full max-w-full object-contain>`. **Multi-page today** = the pane renders one `ReceiptThumb` per
  `attachments[kind==="page"]` in a 3-col grid (`ExpenseReviewPane.tsx:1405-1416`) — each opens its own
  lightbox. For a new unified dark viewer, reuse `isPdfUrl` + the `src/fullUrl` fallback + `onError`
  pattern and feed it `[originalUrl, ...attachments.filter(kind==="page").map(url)]`.

---

## 9. `lib/ledger/types.ts` — core data types

**`Expense`** (`:76-162`) = `ExpenseRow` (`_kit/types.ts:10` aliases it). Key fields for the form:
`id, orgId, companyId, branchId|null, docCode, title?|null, status(ExpenseStatus), source(ExpenseSource),
vendor|null, vendorTaxId|null, docDate|null(YYYY-MM-DD), subtotal, vat, wht, total, categoryId|null,
categoryName?, suggestedCategoryName?|null (AI ghost), projectId?|null, projectName?, paymentMethod|null,
docType(ExpenseDocType), vendorDocNumber|null, vendorAddress|null, vendorBranchCode|null, discount,
paymentStatus(PaymentStatus), payState?:"requested"|"paid"|null, slip?:ExpenseSlip|null, claimantName|null,
bankDetail|null, isRecurring, attachments: ExpenseAttachment[], driveWebUrl?|null,
originalUrl|null, thumbUrl|null, sha256|null, ocrModel|null, ocrConfidence:FieldConfidence|null,
needsReview, note|null, createdBy|null, confirmedBy|null, confirmedAt|null,
trcloudDocId|null, trcloudDocNo|null, trcloudPushedAt|null, trcloudError|null,
trcloudApDocId|null, trcloudApDocNo|null, trcloudApError|null,
buyerTaxIdSnapshot|null, buyerNameSnapshot|null, buyerTaxIdOnDoc|null, buyerMatchStatus(BuyerMatchStatus),
completenessStatus(CompletenessStatus), completenessMissing:string[]|null, completenessCheckedAt|null,
inputVatClaimable:boolean|null, inputVatBlockReason:InputVatBlockReason|null,
replacementOfId|null, replacedById|null, overrideBy|null, overrideAt|null, overrideReason|null,
createdAt, updatedAt, items: ExpenseItem[]`.

**`ExpenseItem`** (`:54-61`): `{ id?; description; qty; unitPrice; amount; vatRate?:number|null }`.

**`ExpenseAttachment`** (`:67-73`): `{ url: string; kind: "po"|"evidence"|"page"; name?; sha256?:string|null }`.
`kind:"page"` = extra pages of a multi-image bill (page 1 = row's `originalUrl/thumbUrl/sha256`; pages 2..N here).

**`ExpenseSlip`** (`:46-52`): `{ slipUrl|null; slipThumbUrl|null; transRef|null; paidAt|null(ISO); amount:number }`.

**`FieldConfidence`** (`:168-178`): `{ vendor?; vendor_tax_id?; doc_date?; subtotal?; vat?; total?;
payment_method?; category?; [field]:number|undefined }` (0..1).

**Enums**: `ExpenseStatus = "draft"|"confirmed"|"locked"|"void"`; `ExpenseSource = "line"|"web"|"email"`;
`ExpenseDocType = "tax_invoice"|"receipt"|"cash_bill"|"delivery_note"|"quotation"|"other"`;
`PaymentStatus = "paid"|"unpaid"|"partial"`;
`BuyerMatchStatus = "matched"|"mismatch"|"not_found_on_doc"|"undecided"`;
`CompletenessStatus = "green_full"|"yellow_partial"|"red_invalid"|"undecided"`;
`InputVatBlockReason = "abbreviated_86_6"|"buyer_mismatch"|"wrong_entity"|"incomplete_invoice"|"entertainment"|"passenger_car"|"other"`.

**Kit option types** (`_kit/types.ts`): `CategoryOption = { id; name; color:string|null; trcloudAccCode?; sort; active? }` (`:16-23`);
`BranchOption = { id; code; name; businessType }` (`:26-31`); `CompanyOption = { id; code; name }` (`:33-37`).

---

## 10. Wiring recipe for the new middle-form (no guessing)
1. Take `expense: ExpenseRow` + `categories`/`branches`/`projects` from the server page (already serialized).
2. Seed one `ExpenseDraft` state exactly like `:363-388`; edit via a `set(k,v)` reducer.
3. Validate with the exported `runRecheck(draft)` + `expenseConfirmability({branchId,categoryId})`.
4. Save = `onSave(id, draft)`; commit-confirm when `canConfirm && gate.ok && !hasError && status==="draft"` → `onConfirm(id, draft)`.
5. All other buttons call the SAME bound actions (§5) via the SAME prop callbacks (§2) — reuse
   `ExpensePaneClient`'s binding block, or import directly from `app/(admin)/ledger/_actions`.
6. Register `registerDraftSaver(id, ()=>onSave(id,draft).ok)` if an external "ส่ง TRCloud" island exists.
7. For images/PDF, reuse `ReceiptThumb`'s `isPdfUrl` + `src/fullUrl` fallback (§8).

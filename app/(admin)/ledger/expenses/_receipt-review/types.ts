// ชนิดข้อมูลที่ page.tsx (server) ส่งเข้า ReceiptReviewWorkspace (client).
// อิงชนิด "จริง" จาก _data โดยตรง → ถ้า schema เปลี่ยน ที่นี่จะ error ให้เห็น (ไม่หลุด).
import type {
  listExpensesSummary,
  getExpense,
  summarizeCompleteness,
} from "../../_data";

export type RRExpenseRow = Awaited<
  ReturnType<typeof listExpensesSummary>
>["expenses"][number] & { projectName?: string | null };

export type RRSelectedExpense = NonNullable<Awaited<ReturnType<typeof getExpense>>>;

export type RRCompletenessSummary = Awaited<ReturnType<typeof summarizeCompleteness>>;

export interface RRCategory {
  id: string;
  name: string;
  color: string | null;
  sort: number;
  active: boolean;
  trcloudAccCode?: string | null;
}

export interface RROption {
  value: string;
  label: string;
}

export interface RRBranch {
  id: string;
  name: string;
}

export interface RRCompany {
  id: string;
  name: string;
}

export interface RRStatusCounts {
  all: number;
  review: number;
  draft: number;
  confirmed: number;
  sent: number;
  unsent: number;
  ap: number;
  pv: number;
  eligible: number;
  requested: number;
  paid: number;
}

/** ค่าฟิลเตอร์ปัจจุบัน (ตรงกับ URL search params ของ list mode). */
export interface RRFilterState {
  status?: string;
  categoryId?: string;
  projectId?: string;
  q?: string;
  selected?: string;
  tr?: "sent" | "unsent";
  ap: boolean;
  pv: boolean;
  cc?: "green" | "yellow" | "red";
  tab: string;
  sort?: string;
  nr?: boolean;
  pay?: "eligible" | "requested" | "paid";
}

export interface ReceiptReviewData {
  // scope
  orgId: string;
  companyId: string;
  branchId: string | null;
  companies: RRCompany[];
  branches: RRBranch[];
  // list + selection
  rows: RRExpenseRow[];
  categories: RRCategory[];
  projects: RROption[];
  statusCounts: RRStatusCounts;
  completenessSummary: RRCompletenessSummary;
  selectedExpense: RRSelectedExpense | null;
  replacementExpense: RRSelectedExpense | null;
  // capability / identity
  canEditClaimability: boolean;
  currentUserId: string;
  payreqEnabled: boolean;
  // url state
  baseParams: string; // querystring (ไม่รวม view/selected) สำหรับสร้างลิงก์
  filter: RRFilterState;
  // bulk-action id sets (เหมือน list mode)
  draftIds: string[];
  sendableIds: string[];
  convertibleIds: string[];
  // TRCloud / stock (ของใบที่เลือก)
  selectedStock: {
    stockinNo: string | null;
    canStockIn: boolean;
    isStockCategory: boolean;
    stockSkus: Array<{
      id: string;
      productId: string;
      productName: string | null;
      businessGroup: string | null;
    }>;
  } | null;
}

// Shared types for the maid employment-contract flow (CEO 2026-07-12).

export interface ContractDocData {
  // ผู้รับจ้าง (maid)
  maidName: string | null;
  idCardNumber: string | null;
  address: string | null;
  phone: string | null;
  // ข้อ 2 · ค่าจ้าง + บัญชี
  monthlyWage: number | null;
  payDayOfMonth: number | null;
  salaryBankName: string | null;
  salaryAccountNo: string | null;
  salaryAccountName: string | null;
  companyBankName: string | null;
  companyAccountNo: string | null;
  companyAccountName: string | null;
  companyAccountType: string | null;
  // ข้อ 4 · ระยะเวลา
  startDate: string | null; // ISO YYYY-MM-DD
  endDate: string | null;
  // แนบ
  idCardImageUrl: string | null;
}

export interface ContractSignature {
  signatureImageUrl: string;
  signedName: string;
  signedAt: string; // ISO
}

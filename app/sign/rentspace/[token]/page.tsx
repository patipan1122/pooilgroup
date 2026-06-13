import "@/components/rentspace/tokens.css";
import { Check, FileText } from "lucide-react";
import { getContractBySignToken } from "@/lib/rentspace/data";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName } from "@/lib/rentspace/format";
import { resolveContractBody } from "@/lib/rentspace/contract-doc";
import { SignPad } from "./_components/sign-pad";

export const dynamic = "force-dynamic";

function NotFound() {
  return (
    <div className="rs-scope min-h-screen flex items-center justify-center p-6" style={{ background: "var(--rs-bg-2)" }}>
      <div className="rs-card p-8 text-center max-w-sm">
        <div className="text-4xl mb-2">🔍</div>
        <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
          ไม่พบสัญญา
        </div>
        <p className="text-[13px] mt-1" style={{ color: "var(--rs-text-2)" }}>
          ลิงก์อาจหมดอายุหรือไม่ถูกต้อง กรุณาติดต่อผู้ให้เช่าเพื่อขอลิงก์ใหม่
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b last:border-0" style={{ borderColor: "var(--rs-border)" }}>
      <span className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </span>
      <span className="text-[13.5px] font-medium text-right" style={{ color: "var(--rs-text)" }}>
        {value}
      </span>
    </div>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contract = await getContractBySignToken(token);
  if (!contract) return <NotFound />;

  const docBody = resolveContractBody(contract);
  const signed = contract.tenantSigned;

  return (
    <div className="rs-scope min-h-screen pb-10" style={{ background: "var(--rs-bg-2)" }}>
      {/* header */}
      <div
        className="px-5 py-5 text-white"
        style={{ background: "linear-gradient(135deg, var(--rs-brand), var(--rs-navy))" }}
      >
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 text-[13px] opacity-90">
            <FileText className="h-4 w-4" /> สัญญาเช่า · {contract.project.name}
          </div>
          <h1 className="text-xl font-bold mt-1">สัญญาเลขที่ {contract.contractNo}</h1>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {/* summary */}
        <div className="rs-card p-5">
          <h2 className="font-bold mb-2" style={{ color: "var(--rs-text)" }}>
            สรุปเงื่อนไข
          </h2>
          <Row label="ผู้เช่า" value={tenantDisplayName(contract.tenant)} />
          <Row label="ห้อง / ยูนิต" value={`${contract.unit.code}${contract.unit.name ? ` · ${contract.unit.name}` : ""}`} />
          <Row label="ค่าเช่า/เดือน" value={formatBaht(toNum(contract.rentAmountThb))} />
          <Row
            label="ระยะสัญญา"
            value={`${thaiDateLong(contract.startDate)} – ${contract.endDate ? thaiDateLong(contract.endDate) : "ไม่มีกำหนด"}`}
          />
          {toNum(contract.depositAmountThb) > 0 && (
            <Row label="เงินประกัน" value={formatBaht(toNum(contract.depositAmountThb))} />
          )}
        </div>

        {/* full terms */}
        {docBody && (
          <div className="rs-card p-5">
            <div
              className="rs-doc text-[14px] leading-relaxed"
              style={{ color: "var(--rs-text)" }}
              dangerouslySetInnerHTML={{ __html: docBody }}
            />
          </div>
        )}

        {/* sign / signed state */}
        {signed ? (
          <div className="rs-card p-6 text-center">
            <div
              className="h-12 w-12 rounded-full mx-auto flex items-center justify-center mb-2"
              style={{ background: "var(--rs-ok-soft)" }}
            >
              <Check className="h-6 w-6" style={{ color: "var(--rs-ok)" }} />
            </div>
            <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
              เซ็นสัญญาเรียบร้อยแล้ว
            </div>
            <p className="text-[13px] mt-1" style={{ color: "var(--rs-text-2)" }}>
              โดย {contract.signerName}
              {contract.signedAt ? ` · ${thaiDateLong(contract.signedAt)}` : ""}
            </p>
            {contract.signatureDataUrl && (
              <div className="mt-3 rounded-xl p-3 inline-block" style={{ border: "1px solid var(--rs-border)", background: "#fff" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={contract.signatureDataUrl} alt="ลายเซ็น" className="max-h-28" />
              </div>
            )}
          </div>
        ) : (
          <div className="rs-card p-5">
            <SignPad token={token} defaultName={tenantDisplayName(contract.tenant)} />
          </div>
        )}
      </div>
    </div>
  );
}

import "@/components/rentspace/tokens.css";
import { Check, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getContractBySignToken } from "@/lib/rentspace/data";
import { thaiDateLong, tenantDisplayName } from "@/lib/rentspace/format";
import { docDataFromContract } from "@/lib/rentspace/contract-doc";
import { RentalContractDocument } from "@/components/rentspace/contract-document";
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

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contract = await getContractBySignToken(token);
  if (!contract) return <NotFound />;

  // เอกสารแนบ (ให้ผู้เช่าเห็นก่อนเซ็นว่ามีเอกสารประกอบอะไรบ้าง)
  const contractDocs = await prisma.rentalDocument.findMany({
    where: { orgId: contract.orgId, ownerType: "contract", ownerId: contract.id },
    orderBy: { createdAt: "desc" },
  });
  const docData = docDataFromContract(contract, {
    attachments: contractDocs.map((d) => d.label?.trim() || "เอกสารแนบ"),
  });
  const signed = contract.tenantSigned;

  return (
    <div className="rs-scope min-h-screen pb-10" style={{ background: "var(--rs-bg-2)" }}>
      {/* header */}
      <div
        className="px-5 py-5 text-white"
        style={{ background: "linear-gradient(135deg, var(--rs-brand), var(--rs-navy))" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-[13px] opacity-90">
            <FileText className="h-4 w-4" /> สัญญาเช่า · {contract.project.name}
          </div>
          <h1 className="text-xl font-bold mt-1">สัญญาเลขที่ {contract.contractNo}</h1>
          <p className="text-[12.5px] opacity-90 mt-1">
            กรุณาอ่านสัญญาฉบับเต็มด้านล่างให้ครบถ้วนก่อนลงลายมือชื่อ
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* สัญญาฉบับเต็ม — เอกสารเดียวกับที่ผู้ให้เช่าเห็น (พรีวิวก่อนเซ็น) */}
        <div className="rs-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: "var(--rs-border)", color: "var(--rs-text)" }}>
            <FileText className="h-4 w-4" style={{ color: "var(--rs-brand)" }} />
            <h2 className="font-bold text-[14px]">เอกสารสัญญา (A4)</h2>
          </div>
          <RentalContractDocument data={docData} />
        </div>

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

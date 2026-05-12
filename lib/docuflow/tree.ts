// DocuFlow — Tree data builder for /docuflow/browse
// ────────────────────────────────────────────────────────────────────
// Server-side: build hierarchical tree from ownership data.
//   🌐 ทั้งกลุ่ม                  (docs at level='group')
//   🏢 บริษัท
//     📁 ของบริษัท (no biz/branch)  (docs at level='company')
//     ⛽ ประเภทธุรกิจ
//       📁 ของประเภทธุรกิจ          (docs at level='business_type')
//       🏪 สาขา
//         (docs at level='branch')
//   👤 บุคคล (collapsed list)        (docs at level='person')
//
// Multi-ownership: doc with ownership=[company=POIL, branch=KKN-001] shows
// up at BOTH locations — natural for navigation, intentional duplication.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export interface DocLite {
  id: string;
  name: string;
  expiryDate: Date | null;
  /** "ok" | "watch" | "critical" | "expired" | "none" */
  expiryStatus: "ok" | "watch" | "critical" | "expired" | "none";
}

export interface BranchNode {
  id: string;
  code: string;
  name: string;
  docs: DocLite[];
}

export interface BizTypeNode {
  type: string;
  label: string;
  emoji: string;
  directDocs: DocLite[]; // owned at business_type (no specific branch)
  branches: BranchNode[];
  totalDocCount: number;
  expiringCount: number;
}

export interface CompanyNode {
  id: string;
  code: string;
  name: string;
  directDocs: DocLite[]; // owned at company (no biz_type/branch)
  bizTypes: BizTypeNode[];
  totalDocCount: number;
  expiringCount: number;
}

export interface PersonNode {
  id: string;
  name: string;
  docs: DocLite[];
}

export interface DocumentTree {
  groupDocs: DocLite[];
  companies: CompanyNode[];
  persons: PersonNode[];
  totals: {
    docCount: number;
    expiringCount: number;
  };
}

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛢️",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "🍵",
  massage_chair: "💺",
  claw_machine: "🎰",
  training_center: "🎓",
  transport: "🚛",
  gas_fleet: "🛻",
};

const TYPE_LABEL: Record<string, string> = {
  fuel_station: "ปั๊มน้ำมัน",
  lpg_station: "ปั๊มแก๊ส",
  lpg_retail: "ร้านค้าแก๊ส",
  bottling_plant: "โรงบรรจุก๊าซ",
  hotel: "โรงแรม",
  convenience_store: "ร้านสะดวกซื้อ",
  ev_station: "EV Station",
  cafe: "Café Amazon",
  cafe_punthai: "พันธุ์ไทย",
  massage_chair: "เก้าอี้นวด",
  claw_machine: "ตู้คีบ",
  training_center: "ศูนย์ฝึกอบรม",
  transport: "ขนส่ง",
  gas_fleet: "Fleet ก๊าซ",
};

function classifyExpiry(expiryDate: Date | null, today: Date): DocLite["expiryStatus"] {
  if (!expiryDate) return "none";
  const days = Math.floor(
    (expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days < 0) return "expired";
  if (days <= 30) return "critical";
  if (days <= 90) return "watch";
  return "ok";
}

export async function buildDocumentTree(orgId: string): Promise<DocumentTree> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [companies, branches, docs, ownerships, users] = await Promise.all([
    prisma.company.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.branch.findMany({
      where: { orgId, isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        businessType: true,
        companyId: true,
      },
    }),
    prisma.document.findMany({
      where: { orgId, isActive: true },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        name: true,
        renewals: {
          orderBy: { expiryDate: "asc" },
          take: 1,
          select: { expiryDate: true },
        },
      },
    }),
    prisma.documentOwnership.findMany({
      where: { orgId, document: { isActive: true } },
      select: {
        documentId: true,
        level: true,
        companyId: true,
        branchId: true,
        businessType: true,
        personId: true,
      },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Index DocLite by id
  const docLiteById = new Map<string, DocLite>();
  for (const d of docs) {
    const expiryDate = d.renewals[0]?.expiryDate ?? null;
    docLiteById.set(d.id, {
      id: d.id,
      name: d.name,
      expiryDate,
      expiryStatus: classifyExpiry(expiryDate, today),
    });
  }

  // Group ownerships by level into bucket maps
  const groupDocSet = new Set<string>();
  const companyDocs = new Map<string, Set<string>>(); // companyId → docIds
  const bizTypeDocs = new Map<string, Set<string>>(); // businessType → docIds
  const branchDocs = new Map<string, Set<string>>(); // branchId → docIds
  const personDocs = new Map<string, Set<string>>(); // personId → docIds

  for (const c of companies) companyDocs.set(c.id, new Set());
  for (const b of branches) branchDocs.set(b.id, new Set());

  for (const o of ownerships) {
    if (!docLiteById.has(o.documentId)) continue;
    if (o.level === "group") {
      groupDocSet.add(o.documentId);
    } else if (o.level === "company" && o.companyId) {
      const set = companyDocs.get(o.companyId);
      if (set) set.add(o.documentId);
    } else if (o.level === "business_type" && o.businessType) {
      let set = bizTypeDocs.get(o.businessType);
      if (!set) {
        set = new Set();
        bizTypeDocs.set(o.businessType, set);
      }
      set.add(o.documentId);
    } else if (o.level === "branch" && o.branchId) {
      const set = branchDocs.get(o.branchId);
      if (set) set.add(o.documentId);
    } else if (o.level === "person" && o.personId) {
      let set = personDocs.get(o.personId);
      if (!set) {
        set = new Set();
        personDocs.set(o.personId, set);
      }
      set.add(o.documentId);
    }
  }

  // Build company nodes
  const companyNodes: CompanyNode[] = companies.map((c) => {
    const directDocs = Array.from(companyDocs.get(c.id) ?? [])
      .map((id) => docLiteById.get(id))
      .filter((d): d is DocLite => Boolean(d));

    // Branches grouped by businessType (only the ones in this company)
    const companyBranches = branches.filter((b) => b.companyId === c.id);
    const bizTypesInCompany = Array.from(
      new Set(companyBranches.map((b) => b.businessType)),
    ).sort();

    const bizTypeNodes: BizTypeNode[] = bizTypesInCompany.map((bt) => {
      const branchesOfType = companyBranches.filter(
        (b) => b.businessType === bt,
      );
      const branchNodes: BranchNode[] = branchesOfType.map((b) => {
        const docIds = Array.from(branchDocs.get(b.id) ?? []);
        const docList = docIds
          .map((id) => docLiteById.get(id))
          .filter((d): d is DocLite => Boolean(d));
        return {
          id: b.id,
          code: b.code,
          name: b.name,
          docs: docList,
        };
      });

      const directBizDocs = Array.from(bizTypeDocs.get(bt) ?? [])
        .map((id) => docLiteById.get(id))
        .filter((d): d is DocLite => Boolean(d));

      // Aggregate counts at the biz_type level — direct + sum of branches
      const totalDocCount =
        directBizDocs.length +
        branchNodes.reduce((sum, br) => sum + br.docs.length, 0);
      const expiringCount =
        directBizDocs.filter(
          (d) => d.expiryStatus === "critical" || d.expiryStatus === "expired",
        ).length +
        branchNodes.reduce(
          (sum, br) =>
            sum +
            br.docs.filter(
              (d) =>
                d.expiryStatus === "critical" || d.expiryStatus === "expired",
            ).length,
          0,
        );

      return {
        type: bt,
        label: TYPE_LABEL[bt] ?? bt,
        emoji: TYPE_EMOJI[bt] ?? "📁",
        directDocs: directBizDocs,
        branches: branchNodes,
        totalDocCount,
        expiringCount,
      };
    });

    const totalDocCount =
      directDocs.length +
      bizTypeNodes.reduce((sum, bt) => sum + bt.totalDocCount, 0);
    const expiringCount =
      directDocs.filter(
        (d) => d.expiryStatus === "critical" || d.expiryStatus === "expired",
      ).length +
      bizTypeNodes.reduce((sum, bt) => sum + bt.expiringCount, 0);

    return {
      id: c.id,
      code: c.code,
      name: c.name,
      directDocs,
      bizTypes: bizTypeNodes,
      totalDocCount,
      expiringCount,
    };
  });

  // Group-level docs
  const groupDocList = Array.from(groupDocSet)
    .map((id) => docLiteById.get(id))
    .filter((d): d is DocLite => Boolean(d));

  // Person nodes (only users that have at least one doc)
  const personNodes: PersonNode[] = users
    .map((u) => {
      const docIds = Array.from(personDocs.get(u.id) ?? []);
      const docList = docIds
        .map((id) => docLiteById.get(id))
        .filter((d): d is DocLite => Boolean(d));
      return docList.length > 0
        ? { id: u.id, name: u.name, docs: docList }
        : null;
    })
    .filter((p): p is PersonNode => p !== null);

  // Org totals (unique docs across all locations)
  const docCount = docLiteById.size;
  const expiringCount = Array.from(docLiteById.values()).filter(
    (d) => d.expiryStatus === "critical" || d.expiryStatus === "expired",
  ).length;

  return {
    groupDocs: groupDocList,
    companies: companyNodes,
    persons: personNodes,
    totals: { docCount, expiringCount },
  };
}

import { PageSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function MissingLoading() {
  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
      <PageSkeleton title="สาขาที่ยังไม่กรอก" />
      <div className="mt-4">
        <TableSkeleton rows={6} />
      </div>
    </div>
  );
}

import { PageSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function ShortagesLoading() {
  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-5xl mx-auto pb-24">
      <PageSkeleton title="เงินขาด" />
      <div className="mt-4">
        <TableSkeleton rows={8} />
      </div>
    </div>
  );
}

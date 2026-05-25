// Backward-compat redirect · old `/chairops/collect/[id]` → `/chairops/m/collect/[id]`.
// W6 cutover · slated for delete +1 week per IA plan.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DeprecatedCollectDetailRedirect({
  params,
}: Props): Promise<never> {
  const { id } = await params;
  redirect(`/chairops/m/collect/${id}`);
}

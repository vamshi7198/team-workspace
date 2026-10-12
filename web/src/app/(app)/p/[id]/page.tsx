import { Suspense } from "react";
import { PageView } from "@/components/page/page-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <PageView key={id} id={id} />
    </Suspense>
  );
}

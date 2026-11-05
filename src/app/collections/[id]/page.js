import { Suspense } from "react";
import CollectionView from "@/components/CollectionView";

export const metadata = { title: "Collection — ornaml" };

export default function CollectionPage({ params }) {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-stone-400">Loading…</p>}>
      <CollectionChat params={params} />
    </Suspense>
  );
}

async function CollectionChat({ params }) {
  const { id } = await params;
  return <CollectionView id={id} />;
}

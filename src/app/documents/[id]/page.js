import { Suspense } from "react";
import ChatView from "@/components/ChatView";

export const metadata = { title: "Ask — ornaml" };

export default function DocumentPage({ params }) {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-stone-400">Loading…</p>}>
      <DocumentChat params={params} />
    </Suspense>
  );
}

async function DocumentChat({ params }) {
  const { id } = await params;
  return <ChatView id={id} />;
}

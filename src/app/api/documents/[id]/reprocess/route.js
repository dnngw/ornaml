import { getDocument, notFound } from "@/lib/documents";
import { processDocument } from "@/lib/ingest";

export async function POST(_request, { params }) {
  const { id } = await params;
  if (!getDocument(id)) return notFound();
  processDocument(id);
  return Response.json({ ok: true });
}

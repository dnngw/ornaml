import { connection } from "next/server";
import {
  CollectionError,
  collectionDocuments,
  collectionNotFound,
  collectionStrategy,
  deleteCollection,
  getCollection,
  updateCollection,
} from "@/lib/collections";
import { prepareCollection } from "@/lib/prepare";
import { DEEP_COMPARE_MAX_PAPERS, MAX_COLLECTION_PAPERS } from "@/lib/limits";

function payload(collection) {
  const docs = collectionDocuments(collection.id);
  const { strategy } = collectionStrategy(docs);
  return {
    collection,
    documents: docs.map(({ card, ...d }) => ({ ...d, has_card: Boolean(card) })),
    strategy,
    limits: { maxPapers: MAX_COLLECTION_PAPERS, deepCompareMaxPapers: DEEP_COMPARE_MAX_PAPERS },
  };
}

export async function GET(_request, { params }) {
  await connection();
  const { id } = await params;
  const collection = getCollection(id);
  return collection ? Response.json(payload(collection)) : collectionNotFound();
}

// Body: { name?, documentIds? (full member list), addDocumentIds? }
export async function PATCH(request, { params }) {
  const { id } = await params;
  if (!getCollection(id)) return collectionNotFound();
  const body = await request.json().catch(() => ({}));
  try {
    updateCollection(id, body);
  } catch (err) {
    if (err instanceof CollectionError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  prepareCollection(id);
  return Response.json(payload(getCollection(id)));
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!getCollection(id)) return collectionNotFound();
  deleteCollection(id); // papers stay in the library
  return Response.json({ ok: true });
}

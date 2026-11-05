import { connection } from "next/server";
import { CollectionError, createCollection, listCollections } from "@/lib/collections";
import { prepareCollection } from "@/lib/prepare";

export async function GET() {
  await connection();
  return Response.json({ collections: listCollections() });
}

// Body: { name, documentIds? }
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const id = createCollection({ name: body.name, documentIds: body.documentIds });
    prepareCollection(id);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof CollectionError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

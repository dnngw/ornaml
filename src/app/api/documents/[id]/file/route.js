import fs from "node:fs/promises";
import { connection } from "next/server";
import { documentPath } from "@/lib/db";
import { getDocument, notFound } from "@/lib/documents";

export async function GET(_request, { params }) {
  await connection();
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return notFound();
  const data = await fs.readFile(documentPath(id));
  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

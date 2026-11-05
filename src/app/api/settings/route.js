import { connection } from "next/server";
import { getPublicSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  await connection();
  return Response.json({ settings: getPublicSettings() });
}

export async function PUT(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  saveSettings(body);
  return Response.json({ settings: getPublicSettings() });
}

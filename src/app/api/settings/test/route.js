import { testChat, testEmbed } from "@/lib/ai";
import { chatConfig, embedConfig } from "@/lib/settings";

// Tests the *saved* settings. Body: { kind: "chat" | "embed" }
export async function POST(request) {
  const { kind } = await request.json().catch(() => ({}));
  try {
    if (kind === "chat") {
      const reply = await testChat(chatConfig());
      return Response.json({ ok: true, message: `Chat model replied: "${reply.slice(0, 40)}"` });
    }
    if (kind === "embed") {
      const dims = await testEmbed(embedConfig());
      return Response.json({ ok: true, message: `Embedding OK (${dims} dimensions)` });
    }
    return Response.json({ ok: false, message: "Unknown test" }, { status: 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err?.message || err) });
  }
}

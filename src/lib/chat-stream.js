// Shared plumbing for the chat routes: NDJSON events to the browser and
// streaming the model's answer.
//
// Events: {type:"user"} -> {type:"status"}* -> {type:"thinking"}? -> {type:"delta"}*
//         -> {type:"done"} | {type:"error"}

import { streamChat } from "./ai";
import { chatConfig } from "./settings";

const encoder = new TextEncoder();

/** Wraps a ReadableStream controller; ignores writes after the client went away. */
export function ndjson(controller) {
  return {
    send(obj) {
      try {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      } catch {}
    },
    close() {
      try {
        controller.close();
      } catch {}
    },
  };
}

export const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" };

/**
 * Stream the model's answer to the browser. Returns the raw text (answer plus
 * the hidden <quotes> block) and the error, if any.
 */
export async function streamModelAnswer({ messages, signal, out, label }) {
  let raw = "";
  let failure = null;
  let thinking = false;
  try {
    for await (const d of streamChat(messages, chatConfig(), { signal })) {
      if (d.kind === "usage") {
        const u = d.usage;
        // DeepSeek reports cache hits as prompt_cache_hit_tokens; OpenAI-style APIs as prompt_tokens_details.cached_tokens.
        const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
        console.info(`[chat] ${label} · tokens in=${u.prompt_tokens} (cached ${cached}) out=${u.completion_tokens}`);
        continue;
      }
      if (d.kind === "reasoning") {
        if (!thinking) out.send({ type: "thinking" });
        thinking = true;
        continue;
      }
      raw += d.text;
      out.send({ type: "delta", text: d.text });
    }
  } catch (err) {
    failure = err;
  }
  return { raw, failure };
}

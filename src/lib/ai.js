// Minimal clients for OpenAI-compatible APIs (DeepSeek, OpenRouter, OpenAI, Ollama, ...).

import { pool } from "./async";

const EMBED_BATCH = 16;
const EMBED_CONCURRENCY = 4;
const EMBED_TIMEOUT_MS = 60_000;
// Largest batch size each model accepted (learned when a batch is rejected).
const maxBatchByModel = (globalThis.__ornamlEmbedBatch ??= new Map());

function endpoint(baseUrl, path) {
  return baseUrl.replace(/\/+$/, "") + path;
}

function headers(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  // OpenRouter attribution headers; ignored by other providers.
  h["HTTP-Referer"] = "http://localhost";
  h["X-Title"] = "ornaml";
  return h;
}

async function errorFromResponse(res, label) {
  let detail = "";
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j.error?.message || j.message || body;
    } catch {
      detail = body;
    }
  } catch {}
  const err = new Error(`${label} failed (HTTP ${res.status}): ${String(detail).slice(0, 300)}`);
  err.status = res.status;
  return err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mark which service an error came from, so messages point to the right Settings section. */
function tag(err, service) {
  const e = err instanceof Error ? err : new Error(String(err));
  e.service ??= service;
  return e;
}

class BatchRejected extends Error {}

async function postEmbeddings(input, cfg) {
  return fetch(endpoint(cfg.baseUrl, "/embeddings"), {
    method: "POST",
    headers: headers(cfg.apiKey),
    body: JSON.stringify({ model: cfg.model, input }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
}

async function embedBatch(input, cfg) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await postEmbeddings(input, cfg);
    } catch (err) {
      // Timeout or network error: retry a couple of times.
      if (attempt < 2) continue;
      throw new Error(`Embedding request failed: ${err.message}`);
    }
    if (res.ok) {
      const json = await res.json();
      const data = json.data;
      if (!Array.isArray(data) || data.length !== input.length) {
        if (input.length > 1) throw new BatchRejected();
        throw new Error(`Embedding response had ${data?.length ?? 0} vectors for ${input.length} inputs`);
      }
      return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    // Some models (e.g. nemotron-3.5 free) reject multi-input requests. A 5xx
    // can also be transient, so retry the batch once before splitting it.
    if (input.length > 1 && (res.status === 400 || res.status === 413 || (res.status >= 500 && attempt >= 1))) {
      throw new BatchRejected();
    }
    if (res.status === 429) {
      const err = await errorFromResponse(res, "Embedding request");
      // A daily quota won't recover by waiting a minute: fail fast.
      if (/per-day|daily/i.test(err.message)) {
        err.code = "quota";
        throw err;
      }
      if (attempt < 8) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 3000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
    // Transient server errors: back off and retry.
    if (res.status >= 500 && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 3000 * 2 ** attempt));
      continue;
    }
    throw await errorFromResponse(res, "Embedding request");
  }
}

/**
 * Embed texts. Returns arrays of numbers in input order. Sends batches; if the
 * provider rejects a batch it is split in half (recursively), and the smaller
 * size is remembered per model for the rest of the process.
 */
export async function embedTexts(texts, cfg, onProgress) {
  try {
    return await embedAll(texts, cfg, onProgress);
  } catch (err) {
    throw tag(err, "embedding");
  }
}

async function embedAll(texts, cfg, onProgress) {
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
    throw Object.assign(new Error("Embedding API key is not set."), { code: "missing_key" });
  }
  const key = `${cfg.baseUrl}|${cfg.model}`;
  const size = maxBatchByModel.get(key) ?? EMBED_BATCH;
  const groups = [];
  for (let i = 0; i < texts.length; i += size) groups.push(texts.slice(i, i + size));

  let done = 0;
  const embedGroup = async (group) => {
    try {
      const vecs = await embedBatch(group, cfg);
      done += group.length;
      onProgress?.(done, texts.length);
      return vecs;
    } catch (err) {
      if (!(err instanceof BatchRejected)) throw err;
      const half = Math.ceil(group.length / 2);
      maxBatchByModel.set(key, Math.min(maxBatchByModel.get(key) ?? EMBED_BATCH, half));
      return [...(await embedGroup(group.slice(0, half))), ...(await embedGroup(group.slice(half)))];
    }
  };

  const results = await pool(groups, EMBED_CONCURRENCY, embedGroup);
  return results.flat();
}

/** Stream a chat completion. Yields { kind: "content" | "reasoning", text } and finally { kind: "usage", usage }. */
export async function* streamChat(messages, cfg, { signal } = {}) {
  try {
    yield* streamChatRaw(messages, cfg, { signal });
  } catch (err) {
    throw tag(err, "chat");
  }
}

async function* streamChatRaw(messages, cfg, { signal }) {
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
    throw Object.assign(new Error("Chat API key is not set."), { code: "missing_key" });
  }
  const res = await fetch(endpoint(cfg.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: headers(cfg.apiKey),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
    }),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res, "Chat request");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new Error(json.error.message || "Chat stream error");
        const delta = json.choices?.[0]?.delta || {};
        // Reasoning models (e.g. deepseek-flash) think before answering.
        const reasoning = delta.reasoning_content || delta.reasoning;
        if (reasoning) yield { kind: "reasoning", text: reasoning };
        if (delta.content) yield { kind: "content", text: delta.content };
        if (json.usage) yield { kind: "usage", usage: json.usage };
      } catch (e) {
        if (e instanceof SyntaxError) continue; // keep-alive / partial noise
        throw e;
      }
    }
  }
}

/** Quick connectivity checks for the Settings page. */
export async function testChat(cfg) {
  let text = "";
  for await (const d of streamChat([{ role: "user", content: "Reply with the single word: OK" }], cfg)) {
    if (d.kind !== "content") continue;
    text += d.text;
    if (text.length > 50) break;
  }
  return text.trim();
}

export async function testEmbed(cfg) {
  const [vec] = await embedTexts(["hello world"], cfg);
  return vec.length;
}

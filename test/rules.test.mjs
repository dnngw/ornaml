// Limits, modes, error messages and small helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMode,
  estimateTokens,
  isLongDocument,
  FULL_DOC_MAX_PAGES,
  FULL_DOC_MAX_TOKENS,
} from "../src/lib/limits.js";
import { describeError } from "../src/lib/errors.js";
import { cosine, toBlob, toFloat32 } from "../src/lib/vectors.js";
import { pool } from "../src/lib/async.js";
import { formatBytes, shortName } from "../src/lib/format.js";

test("answer mode: papers are read whole; long or very dense documents use search", () => {
  assert.equal(chooseMode(15, 11_000), "full");
  assert.equal(chooseMode(FULL_DOC_MAX_PAGES, FULL_DOC_MAX_TOKENS), "full");
  assert.equal(chooseMode(FULL_DOC_MAX_PAGES + 1, 10_000), "search");
  assert.equal(chooseMode(100, FULL_DOC_MAX_TOKENS + 1), "search");
  assert.equal(estimateTokens(4000), 1000);
});

test("long-document note: stored mode wins, older documents fall back to page count", () => {
  assert.equal(isLongDocument({ mode: "search" }), true);
  assert.equal(isLongDocument({ mode: "full", num_pages: 400 }), false);
  assert.equal(isLongDocument({ mode: null, num_pages: 200 }), true);
  assert.equal(isLongDocument({ mode: null, num_pages: 20 }), false);
});

test("errors become plain-language messages with a code", () => {
  const e = (message, extra = {}) => Object.assign(new Error(message), extra);
  const cases = [
    [e("x", { code: "missing_key" }), "missing_key"],
    [e("HTTP 429: free-models-per-day", { status: 429 }), "quota"],
    [e("HTTP 429: per-min", { status: 429 }), "busy"],
    [e("HTTP 401", { status: 401 }), "auth"],
    [e("HTTP 400: model foo does not exist", { status: 400 }), "model"],
    [e("HTTP 502", { status: 502 }), "service"],
    [e("fetch failed"), "connection"],
    [e("x", { code: "no_text" }), "no_text"],
    [e("x", { name: "PasswordException" }), "bad_pdf"],
    [e("x", { code: "too_many_pages" }), "too_many_pages"],
    [e("something odd"), "unknown"],
  ];
  for (const [err, code] of cases) assert.equal(describeError(err).code, code, err.message);
  assert.match(describeError(e("odd"), "chat").message, /answering/);
  assert.match(describeError(e("odd"), "embedding").message, /preparing/);
});

test("errors name the service they came from, whatever the caller guessed", async () => {
  const { embedTexts, streamChat } = await import("../src/lib/ai.js");
  const noKey = { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "" };

  // Raised before any network call, so no API is needed.
  const embedErr = await embedTexts(["x"], noKey).catch((e) => e);
  assert.equal(embedErr.service, "embedding");
  const chatErr = await (async () => {
    for await (const _ of streamChat([{ role: "user", content: "x" }], noKey));
  })().catch((e) => e);
  assert.equal(chatErr.service, "chat");

  // Deep compare reads papers with the chat model, but a long paper needs embeddings:
  // the message must point to the embedding model even though the caller says "chat".
  assert.match(describeError(embedErr, "chat").message, /embedding model/);
  assert.match(describeError(chatErr, "embedding").message, /chat model/);
});

test("vectors: cosine similarity and BLOB round trip", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
  assert.deepEqual([...toFloat32(toBlob([0.5, -1, 2]))], [0.5, -1, 2]);
});

test("pool keeps input order and limits concurrency", async () => {
  let running = 0;
  let peak = 0;
  const out = await pool([30, 10, 20, 5], 2, async (ms, i) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test("format helpers", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2_215_244), "2.1 MB");
  assert.equal(shortName("attention.pdf"), "attention");
  assert.equal(shortName("a-very-long-file-name-for-a-paper.pdf", 12), "a-very-lon…");
});

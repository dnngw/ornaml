import { test } from "node:test";
import assert from "node:assert/strict";
import { matchQuote } from "../src/lib/match.js";

const lines = [
  {
    t: "Encoder: The encoder is composed of a stack of N = 6 identical layers. Each layer has two",
    r: [0, 0, 1, 0.01],
  },
  { t: "sub-layers. The first is a multi-head self-attention mecha-", r: [0, 0.02, 1, 0.01] },
  { t: "nism, and the second is a simple, position-wise fully connected", r: [0, 0.04, 1, 0.01] },
  { t: "feed-forward network.", r: [0, 0.06, 1, 0.01] },
];

test("finds an exact quote on one line", () => {
  assert.deepEqual(matchQuote(lines, "The encoder is composed of a stack of N = 6 identical layers."), [0]);
});

test("ignores spacing and punctuation differences", () => {
  assert.deepEqual(matchQuote(lines, "encoder is composed of a stack of N=6 identical layers"), [0]);
});

test("follows a quote across lines and joins words hyphenated at a line break", () => {
  assert.deepEqual(matchQuote(lines, "multi-head self-attention mechanism, and the second"), [1, 2]);
});

test("strips accents on both sides", () => {
  const accented = [{ t: "Résumé of the café results", r: [0, 0, 1, 0.01] }];
  assert.deepEqual(matchQuote(accented, "resume of the cafe results"), [0]);
});

test("falls back to word overlap for a lightly paraphrased quote", () => {
  const idx = matchQuote(lines, "The encoder is composed of a stack of six identical layers, each layer has two");
  assert.deepEqual(idx, [0]);
});

test("returns nothing for unrelated or empty quotes", () => {
  assert.deepEqual(matchQuote(lines, "bananas grow on tall tropical plants"), []);
  assert.deepEqual(matchQuote(lines, ""), []);
});

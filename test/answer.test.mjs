import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCitations, parseAnswer } from "../src/lib/answer.js";
import { citationLabels, labeledSources } from "../src/lib/cite.js";

test("parseAnswer: splits the answer, quotes and found flag", () => {
  const raw = 'Eight heads [S14].\n\n<quotes>\n{"found": true, "quotes": {"S14": ["we employ h = 8"]}}\n</quotes>';
  assert.deepEqual(parseAnswer(raw), {
    answer: "Eight heads [S14].",
    quotes: { S14: ["we employ h = 8"] },
    found: true,
  });
});

test("parseAnswer: handles small talk (no block), code fences, old format and broken JSON", () => {
  assert.deepEqual(parseAnswer("Hi there!"), { answer: "Hi there!", quotes: {}, found: null });
  const fenced = 'Not covered.\n<quotes>\n```json\n{"found": false, "quotes": {}}\n```\n</quotes>';
  assert.equal(parseAnswer(fenced).found, false);
  const old = 'A [S1].\n<quotes>\n{"S1": ["x"]}\n</quotes>';
  assert.deepEqual(parseAnswer(old).quotes, { S1: ["x"] });
  assert.deepEqual(parseAnswer("A [S1].\n<quotes>\n{not json\n</quotes>").quotes, {});
});

const lines = [
  { t: "The encoder is composed of a stack of N = 6 identical layers.", r: [0.1, 0.2, 0.8, 0.01] },
  { t: "Each layer has two sub-layers.", r: [0.1, 0.22, 0.5, 0.01] },
];
const sources = [
  { n: 1, page: 3, text: "The encoder is composed…", lines },
  { n: 2, page: 4, text: "Unrelated chunk", lines },
  { n: 3, page: 5, text: "Never cited", lines, docId: "d2", docName: "bert.pdf" },
];

test("buildCitations: only cited sources, exact quotes highlight their lines", () => {
  const citations = buildCitations(
    "Six layers [S1]. Also [S2, S1].",
    { S1: ["stack of N = 6 identical layers"] },
    sources,
  );
  assert.deepEqual(
    citations.map((c) => c.n),
    [1, 2],
  );
  assert.equal(citations[0].exact, true);
  assert.deepEqual(citations[0].rects, [lines[0].r]);
});

test("buildCitations: without a matching quote the whole chunk is highlighted (approximate)", () => {
  const [c] = buildCitations("See [S2].", { S2: ["text that is not in the chunk at all"] }, sources);
  assert.equal(c.exact, false);
  assert.equal(c.rects.length, lines.length);
});

test("buildCitations: carries the paper for collection sources", () => {
  const [c] = buildCitations("From BERT [S3].", {}, sources);
  assert.equal(c.docId, "d2");
  assert.equal(c.docName, "bert.pdf");
});

test("citation labels: 1, 2, 3 in order of first appearance", () => {
  const content = "Heads [S42]. Size [S14][S42]. Big model [S30, S14].";
  assert.deepEqual(
    [...citationLabels(content)],
    [
      [42, 1],
      [14, 2],
      [30, 3],
    ],
  );
  const ordered = labeledSources({ content, sources: [{ n: 14 }, { n: 30 }, { n: 42 }] });
  assert.deepEqual(
    ordered.map((s) => [s.label, s.n]),
    [
      [1, 42],
      [2, 14],
      [3, 30],
    ],
  );
});

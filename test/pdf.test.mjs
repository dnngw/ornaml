import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPages, extractPdf, joinLines } from "../src/lib/pdf.js";
import { makePdf } from "./support/make-pdf.mjs";

test("extractPdf: lines with normalized boxes on every page", async () => {
  const pdf = makePdf([["First page, first line.", "First page, second line."], ["Second page only line."]]);
  const { numPages, pages } = await extractPdf(pdf);
  assert.equal(numPages, 2);
  assert.deepEqual(
    pages.map((p) => p.lines.map((l) => l.t)),
    [["First page, first line.", "First page, second line."], ["Second page only line."]],
  );
  for (const { r } of pages.flatMap((p) => p.lines)) {
    for (const v of r) assert.ok(v >= 0 && v <= 1, `box values are page fractions: ${r}`);
  }
  // Reading order: the second line sits below the first.
  assert.ok(pages[0].lines[1].r[1] > pages[0].lines[0].r[1]);
});

test("joinLines: joins words hyphenated across a line break", () => {
  assert.equal(joinLines([{ t: "self-atten-" }, { t: "tion works" }]), "self-attention works");
  assert.equal(joinLines([{ t: "one" }, { t: "two" }]), "one two");
});

test("chunkPages: chunks stay within one page and overlap a little", () => {
  const line = (i) => ({ t: `Line ${i} ${"x".repeat(80)}`, r: [0, 0, 1, 0.01] });
  const pages = [
    { page: 1, lines: Array.from({ length: 30 }, (_, i) => line(i)) },
    { page: 2, lines: [line(100)] },
  ];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.lines.length > 0 && c.text.length > 20));
  assert.deepEqual([...new Set(chunks.map((c) => c.page))], [1, 2]);
  // Consecutive chunks on the same page share their boundary lines.
  const [a, b] = chunks;
  assert.equal(b.lines[0].t, a.lines.at(-2).t);
});

test("chunkPages: drops near-empty chunks", () => {
  assert.deepEqual(chunkPages([{ page: 1, lines: [{ t: "p. 3", r: [0, 0, 0.1, 0.01] }] }]), []);
});

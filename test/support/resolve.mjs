// Module resolution for tests (see register.mjs): adds the missing ".js" and
// maps "@/..." to src/. Written so it works both as a synchronous hook
// (module.registerHooks) and as an async loader hook (module.register).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(fileURLToPath(new URL("../../src/", import.meta.url)));

export function rewrite(specifier, parentURL) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  const isPath = spec.startsWith(".") || spec.startsWith("file:");
  if (!isPath || path.extname(spec) || !parentURL) return spec;
  const base = spec.startsWith("file:") ? fileURLToPath(spec) : fileURLToPath(new URL(spec, parentURL));
  for (const candidate of [`${base}.js`, path.join(base, "index.js")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return spec;
}

export function resolve(specifier, context, nextResolve) {
  return nextResolve(rewrite(specifier, context.parentURL), context);
}

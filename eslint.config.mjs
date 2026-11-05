import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // Plain JavaScript project: catch typos and leftovers that a type checker would.
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true, caughtErrors: "none" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied from pdfjs-dist by scripts/copy-pdf-worker.mjs (not our code).
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;

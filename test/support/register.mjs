// Lets plain Node load the app's modules in tests: they use Next.js-style
// imports without file extensions ("./match") and the "@/..." alias for src/.
import * as nodeModule from "node:module";
import { resolve } from "./resolve.mjs";

if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({ resolve }); // Node 22.15+ / 23.5+
} else {
  nodeModule.register("./resolve.mjs", import.meta.url); // older Node
}

/**
 * Vendored from Ink 8 (`ink/build/parse-keypress.js`, MIT) so compiled binaries bundle key parsing
 * without runtime `createRequire` or blocked package subpath exports.
 */
import parseKeypress from "./vendor/parse-keypress.js";

export type InkKeypress = ReturnType<typeof parseKeypress>;

export { parseKeypress };

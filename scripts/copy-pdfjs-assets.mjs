// Copies the runtime assets pdf.js needs (CMaps, standard fonts, WASM image decoders, ICC
// profiles) into public/pdfjs so the app works fully offline. Runs before dev/build.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");
const version = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
const stamp = join(dest, ".version");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`pdf.js ${version} assets copied to public/pdfjs`);

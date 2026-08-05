/**
 * Inlines posters.json into tv.html and writes the publishable tv.build.html.
 *
 * tv.html keeps an empty POSTERS object so it stays readable and works on its
 * own; this step swaps in the base64 covers the Actions run produced.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const html = readFileSync("tv.html", "utf8");

if (!existsSync("posters.json")) {
  console.error("posters.json not found — run the 'Fetch cover art' workflow first.");
  process.exit(1);
}

const posters = JSON.parse(readFileSync("posters.json", "utf8"));
const marker = /\/\*POSTERS_START\*\/[\s\S]*?\/\*POSTERS_END\*\//;

if (!marker.test(html)) {
  console.error("POSTERS marker missing from tv.html.");
  process.exit(1);
}

const out = html.replace(
  marker,
  "/*POSTERS_START*/" + JSON.stringify(posters) + "/*POSTERS_END*/"
);

writeFileSync("tv.build.html", out);

const mb = (Buffer.byteLength(out) / 1024 / 1024).toFixed(2);
console.log(`tv.build.html — ${Object.keys(posters).length} covers, ${mb} MB`);

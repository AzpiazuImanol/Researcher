/**
 * Inlines the catalog and the downloaded covers into tv.html and writes the
 * publishable tv.build.html.
 *
 * tv.html keeps empty placeholders so it stays readable and editable on its
 * own; this step swaps in the real data.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CATALOG } from "./catalog.mjs";

const html = readFileSync("tv.html", "utf8");
const posters = existsSync("posters.json")
  ? JSON.parse(readFileSync("posters.json", "utf8"))
  : {};

if (!existsSync("posters.json")) {
  console.warn("posters.json no está — la página sale con pósters tipográficos.");
}

const ids = new Set();
for (const entry of CATALOG) {
  if (ids.has(entry.id)) throw new Error(`id duplicado en el catálogo: ${entry.id}`);
  ids.add(entry.id);
}

function inject(source, name, value) {
  const marker = new RegExp(`/\\*${name}_START\\*/[\\s\\S]*?/\\*${name}_END\\*/`);
  if (!marker.test(source)) throw new Error(`falta el marcador ${name} en tv.html`);
  return source.replace(marker, `/*${name}_START*/${JSON.stringify(value)}/*${name}_END*/`);
}

const out = inject(inject(html, "DATA", CATALOG), "POSTERS", posters);
writeFileSync("tv.build.html", out);

const withArt = CATALOG.filter((e) => posters[e.id]).length;
const mb = (Buffer.byteLength(out) / 1024 / 1024).toFixed(2);
console.log(`tv.build.html — ${CATALOG.length} títulos, ${withArt} con portada, ${mb} MB`);

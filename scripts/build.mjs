/**
 * Builds the two publishable copies of the page.
 *
 *   tv.build.html      bare fragment for the Artifact tool, which supplies
 *                      its own doctype and head
 *   TV-repositorio.html  a complete standalone document
 *
 * Both are pre-rendered. The page draws itself from JavaScript, and some
 * viewers — iOS Quick Look in particular — show local HTML without running
 * any, which left the file looking empty. So the build loads the page in a
 * real browser and bakes the resulting markup in: without JavaScript you
 * still get the whole catalog, and with it the filters take over as usual.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG } from "./catalog.mjs";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const template = readFileSync("tv.html", "utf8");
const posters = existsSync("posters.json")
  ? JSON.parse(readFileSync("posters.json", "utf8"))
  : {};

if (!Object.keys(posters).length) {
  console.warn("posters.json vacío o ausente — la página sale con pósters tipográficos.");
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

let page = inject(inject(template, "DATA", CATALOG), "POSTERS", posters);

/** Replaces the inner HTML of an element, matched by its id, in the source. */
function fillById(source, id, inner) {
  const open = new RegExp(`(<[a-z]+[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</[a-z]+>)`);
  if (!open.test(source)) throw new Error(`no encuentro #${id} para pre-renderizar`);
  return source.replace(open, (_m, start, end) => start + inner + end);
}

/* ── Pre-render ── */
let prerendered = false;
try {
  const { chromium } = await import("playwright");
  const dir = mkdtempSync(join(tmpdir(), "tvbuild-"));
  const scratch = join(dir, "page.html");
  writeFileSync(scratch, page);

  const browser = await chromium.launch({ executablePath: CHROME });
  const tab = await browser.newPage();
  const errors = [];
  tab.on("pageerror", (e) => errors.push(String(e)));
  await tab.goto("file://" + scratch);
  await tab.waitForSelector(".card", { timeout: 15000 });

  const snap = await tab.evaluate(() => ({
    now: document.getElementById("now-grid").innerHTML,
    board: document.getElementById("board").innerHTML,
    chips: document.getElementById("genre-chips").innerHTML,
    count: document.getElementById("filter-count").textContent,
    total: document.getElementById("s-total").textContent,
    seen: document.getElementById("s-seen").textContent,
    left: document.getElementById("s-left").textContent,
    nowN: document.getElementById("s-now").textContent,
    bar: document.getElementById("s-bar").style.width,
  }));
  await browser.close();

  if (errors.length) throw new Error("errores de JS: " + errors.join(" | "));

  page = fillById(page, "now-grid", snap.now);
  page = fillById(page, "board", snap.board);
  page = fillById(page, "genre-chips", snap.chips);
  page = fillById(page, "filter-count", snap.count);
  page = fillById(page, "s-total", snap.total);
  page = fillById(page, "s-seen", snap.seen);
  page = fillById(page, "s-left", snap.left);
  page = fillById(page, "s-now", snap.nowN);
  page = page.replace('id="s-bar" style="width:0%"', `id="s-bar" style="width:${snap.bar}"`);

  // Las portadas ya viajan en el HTML pre-renderizado, así que se saca la
  // segunda copia del script: el archivo pesa la mitad y la página la
  // reconstruye leyendo el DOM al cargar.
  page = inject(page, "POSTERS", {});
  prerendered = true;
} catch (err) {
  console.warn(`sin pre-render (${err.message}) — la página va a necesitar JavaScript.`);
}

writeFileSync("tv.build.html", page);

/* ── Copia autónoma ── */
const splitAt = page.indexOf("</style>") + "</style>".length;
const standalone =
  '<!doctype html>\n<html lang="es">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<meta name="color-scheme" content="light dark">\n' +
  page.slice(0, splitAt) +
  "\n</head>\n<body>\n" +
  page.slice(splitAt) +
  "\n</body>\n</html>\n";

writeFileSync("TV-repositorio.html", standalone);

const withArt = CATALOG.filter((e) => posters[e.id]).length;
const mb = (n) => (Buffer.byteLength(n) / 1024 / 1024).toFixed(2);
console.log(
  `${CATALOG.length} títulos, ${withArt} con portada` +
  `${prerendered ? ", pre-renderizado" : ", SIN pre-render"}\n` +
  `  tv.build.html       ${mb(page)} MB  (para el artifact)\n` +
  `  TV-repositorio.html ${mb(standalone)} MB  (para abrir en cualquier lado)`
);

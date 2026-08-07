/**
 * Downloads cover art for every title in the catalog and writes posters.json
 * as base64 data URIs.
 *
 * Runs on a GitHub Actions runner because this repo's dev sandbox cannot
 * reach Wikimedia. Three things this has to get right:
 *
 *  - pilicense=any. By default pageimages returns only freely-licensed
 *    images, and film/TV posters are non-free, so the default silently
 *    yields nothing for almost every title here.
 *  - Batching. Actions runners share a heavily rate-limited IP pool, so
 *    metadata goes out 20 titles per request rather than one at a time.
 *  - Thumbnail width by status. Watched titles render small and desaturated,
 *    so they get a narrow thumbnail; the whole set has to fit under the
 *    16 MB ceiling for a published page.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { CATALOG } from "./catalog.mjs";

const API = "https://en.wikipedia.org/w/api.php";
const API_ES = "https://es.wikipedia.org/w/api.php";
const WIDTH_PENDING = 300;
const WIDTH_SEEN = 150;
const BATCH = 20;
const UA = "tv-watchlist-poster-fetcher/1.0 (https://github.com/AzpiazuImanol/Researcher)";

const widthFor = (entry) => (entry.seen ? WIDTH_SEEN : WIDTH_PENDING);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with backoff, because Wikimedia answers 429 to bursts from CI ranges. */
async function get(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 && attempt < 5) {
    const wait = 2000 * Math.pow(2, attempt);
    console.log(`   429 — esperando ${wait / 1000}s`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function api(params, base = API) {
  const res = await get(`${base}?${new URLSearchParams({ ...params, format: "json" })}`);
  return res.json();
}

/**
 * Covers already downloaded are kept as-is: they have been recompressed
 * locally and re-fetching would both undo that and burn rate limit on
 * titles that are already done. Set REFETCH_ALL=1 to start over.
 */
const existing =
  process.env.REFETCH_ALL === "1" || !existsSync("posters.json")
    ? {}
    : JSON.parse(readFileSync("posters.json", "utf8"));

const TODO = CATALOG.filter((e) => !existing[e.id]);
console.log(`${TODO.length} por bajar, ${Object.keys(existing).length} ya presentes\n`);
if (!TODO.length) {
  writeFileSync("posters.json", JSON.stringify(existing, null, 0));
  console.log("nada que hacer");
  process.exit(0);
}

/**
 * MediaWiki rewrites requested titles through normalization and redirects,
 * so follow that chain to know which returned page belongs to which entry.
 */
function buildAliasMap(query) {
  const alias = new Map();
  for (const list of [query.normalized, query.redirects]) {
    for (const { from, to } of list || []) alias.set(from, to);
  }
  return (title) => {
    let cur = title;
    for (let i = 0; i < 5 && alias.has(cur); i++) cur = alias.get(cur);
    return cur;
  };
}

const found = new Map();

/* Pass 1 — batched lookups, grouped by the width each entry needs. */
for (const seen of [false, true]) {
  const group = TODO.filter((e) => e.wiki && !!e.seen === seen);
  const pithumbsize = String(seen ? WIDTH_SEEN : WIDTH_PENDING);

  for (let i = 0; i < group.length; i += BATCH) {
    const chunk = group.slice(i, i + BATCH);
    const json = await api({
      action: "query",
      titles: chunk.map((c) => c.wiki).join("|"),
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize,
      pilicense: "any",
    });

    const query = json.query || {};
    const resolve = buildAliasMap(query);
    const byTitle = new Map(
      Object.values(query.pages || {}).map((p) => [p.title, p.thumbnail?.source])
    );

    for (const entry of chunk) {
      const src = byTitle.get(resolve(entry.wiki));
      if (src) found.set(entry.id, src);
    }
    await sleep(1000);
  }
  console.log(`lotes ${seen ? "vistas" : "pendientes"}: ${found.size} acumuladas`);
}

/**
 * Pass 2 — for the stragglers, parse the article's lead section and take the
 * first upload.wikimedia.org image, which is the infobox poster. pageimages
 * selects nothing on a fair number of TV series articles even with
 * pilicense=any, and the rendered HTML sidesteps that heuristic entirely.
 */
async function viaLeadHtml(entry, base = API, title = null) {
  const json = await api({
    action: "parse",
    page: title || entry.wiki,
    prop: "text",
    section: "0",
    redirects: "1",
    formatversion: "2",
  }, base);
  const html = json.parse?.text || "";
  const match = html.match(/<img[^>]+src="([^"]*upload\.wikimedia\.org[^"]+)"/i);
  if (!match) return null;
  // Se toma la miniatura tal cual la sirve el artículo. Reescribir el ancho
  // en la URL devuelve 400: los pósters no libres se suben en baja
  // resolución, así que el tamaño pedido a menudo no existe. sharp la
  // redimensiona después, que además es donde se decide el tamaño final.
  return match[1].startsWith("//") ? "https:" + match[1] : match[1];
}

/** El mismo truco contra es.wikipedia, para lo que no tiene artículo en inglés. */
function viaSpanishInfobox(entry) {
  return viaLeadHtml(entry, API_ES, entry.wikiEs || entry.t);
}

/** Pass 3 — last resort: full-text search for whatever is still missing. */
async function viaSearch(entry) {
  const json = await api({
    action: "query",
    generator: "search",
    gsrsearch: entry.search || entry.wiki || entry.t,
    gsrlimit: "1",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: String(widthFor(entry)),
    pilicense: "any",
  });
  const page = Object.values(json.query?.pages || {})[0];
  return page?.thumbnail?.source || null;
}

/** Cuarto intento: la Wikipedia en español suele tener el póster con otro nombre. */
async function viaSpanish(entry) {
  const json = await api({
    action: "query", generator: "search",
    gsrsearch: entry.t, gsrlimit: "1",
    prop: "pageimages", piprop: "thumbnail",
    pithumbsize: String(widthFor(entry)), pilicense: "any",
  }, API_ES);
  const page = Object.values(json.query?.pages || {})[0];
  return page?.thumbnail?.source || null;
}

for (const [label, resolver, needsWiki] of [
  ["infobox", viaLeadHtml, true],
  ["infobox es", viaSpanishInfobox, false],
  ["búsqueda", viaSearch, false],
  ["es.wikipedia", viaSpanish, false],
]) {
  for (const entry of TODO) {
    if (found.has(entry.id) || (needsWiki && !entry.wiki)) continue;
    try {
      const src = await resolver(entry);
      if (src) {
        found.set(entry.id, src);
        console.log(`   ${label} resolvió ${entry.id}`);
      }
    } catch (err) {
      console.log(`   ${label} falló ${entry.id}: ${err.message}`);
    }
    await sleep(900);
  }
}

/**
 * Pass 4 — download, then normalise to JPEG at the width the entry actually
 * renders at. Wikimedia serves whatever the article holds, often a PNG far
 * wider than requested, and unprocessed that pushed the page past its 16 MB
 * ceiling. Only new downloads pass through here, so nothing already stored
 * gets re-encoded.
 */
const byId = new Map(CATALOG.map((e) => [e.id, e]));
const out = { ...existing };

for (const [id, url] of found) {
  try {
    const res = await get(url);
    const raw = Buffer.from(await res.arrayBuffer());
    // Una búsqueda que erra puede devolver un icono o un placeholder. A este
    // tamaño no hay póster real, así que se descarta en vez de guardarlo.
    if (raw.length < 3000) throw new Error(`imagen de ${raw.length} bytes, no es un póster`);
    const jpeg = await sharp(raw)
      .resize({ width: widthFor(byId.get(id)), withoutEnlargement: true })
      .flatten({ background: "#1a1a1a" })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    out[id] = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    console.log(`ok ${id}: ${Math.round(jpeg.length / 1024)}kb`);
  } catch (err) {
    console.log(`!  ${id}: ${err.message} — ${url}`);
  }
  await sleep(200);
}

writeFileSync("posters.json", JSON.stringify(out, null, 0));

const missing = CATALOG.filter((e) => !out[e.id]);
const mb = (JSON.stringify(out).length / 1024 / 1024).toFixed(2);
console.log(`\n${Object.keys(out).length}/${CATALOG.length} portadas, ${mb} MB`);
if (missing.length) console.log(`faltan: ${missing.map((e) => e.id).join(", ")}`);

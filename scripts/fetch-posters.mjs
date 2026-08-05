/**
 * Downloads cover art for every title in the watchlist and writes them to
 * posters.json as base64 data URIs.
 *
 * Runs on a GitHub Actions runner because this repo's dev sandbox cannot
 * reach Wikimedia. Two things this has to get right:
 *
 *  - pilicense=any. By default pageimages returns only freely-licensed
 *    images, and film/TV posters are non-free, so the default silently
 *    yields nothing for almost every title here.
 *  - Batching. Actions runners share a heavily rate-limited IP pool, so
 *    metadata goes out 20 titles per request rather than one at a time.
 */

import { writeFileSync, readFileSync } from "node:fs";

const API = "https://en.wikipedia.org/w/api.php";
const THUMB_WIDTH = 320;
const BATCH = 20;
const UA = "tv-watchlist-poster-fetcher/1.0 (https://github.com/AzpiazuImanol/Researcher)";

const titles = JSON.parse(readFileSync(new URL("./titles.json", import.meta.url), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with backoff, because Wikimedia answers 429 to bursts from CI ranges. */
async function get(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } });
  if (res.status === 429 && attempt < 5) {
    const wait = 2000 * Math.pow(2, attempt);
    console.log(`   429 — esperando ${wait / 1000}s`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function api(params) {
  const res = await get(`${API}?${new URLSearchParams({ ...params, format: "json" })}`);
  return res.json();
}

const IMAGE_PARAMS = {
  prop: "pageimages",
  piprop: "thumbnail",
  pithumbsize: String(THUMB_WIDTH),
  pilicense: "any",
};

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

/* Pass 1 — batched lookups for every entry that names an article. */
const named = titles.filter((t) => t.wiki);

for (let i = 0; i < named.length; i += BATCH) {
  const chunk = named.slice(i, i + BATCH);
  const json = await api({
    action: "query",
    titles: chunk.map((c) => c.wiki).join("|"),
    redirects: "1",
    ...IMAGE_PARAMS,
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

  console.log(`lote ${i / BATCH + 1}: ${found.size} acumuladas`);
  await sleep(1200);
}

/* Pass 2 — search fallback for whatever the article lookup missed. */
for (const entry of titles) {
  if (found.has(entry.id)) continue;
  try {
    const json = await api({
      action: "query",
      generator: "search",
      gsrsearch: entry.search || entry.wiki || entry.id,
      gsrlimit: "1",
      ...IMAGE_PARAMS,
    });
    const page = Object.values(json.query?.pages || {})[0];
    if (page?.thumbnail?.source) {
      found.set(entry.id, page.thumbnail.source);
      console.log(`   búsqueda resolvió ${entry.id} → ${page.title}`);
    }
  } catch (err) {
    console.log(`   búsqueda falló ${entry.id}: ${err.message}`);
  }
  await sleep(1200);
}

/**
 * Pass 2b — for the stragglers, parse the article's lead section and take the
 * first upload.wikimedia.org image, which is the infobox poster. pageimages
 * selects nothing on a fair number of TV series articles even with
 * pilicense=any, and the rendered HTML sidesteps that heuristic entirely.
 */
async function viaLeadHtml(entry) {
  const json = await api({
    action: "parse",
    page: entry.wiki,
    prop: "text",
    section: "0",
    redirects: "1",
    formatversion: "2",
  });
  const html = json.parse?.text || "";
  const match = html.match(/<img[^>]+src="([^"]*upload\.wikimedia\.org[^"]+)"/i);
  if (!match) return null;
  return match[1].startsWith("//") ? "https:" + match[1] : match[1];
}

for (const entry of titles) {
  if (found.has(entry.id) || !entry.wiki) continue;
  try {
    const src = await viaLeadHtml(entry);
    if (src) {
      found.set(entry.id, src);
      console.log(`   infobox resolvió ${entry.id}`);
    } else {
      console.log(`   infobox sin imagen para ${entry.id} (${entry.wiki})`);
    }
  } catch (err) {
    console.log(`   infobox falló ${entry.id}: ${err.message}`);
  }
  await sleep(1200);
}

/* Pass 3 — download and encode. */
const out = {};

for (const [id, url] of found) {
  try {
    const res = await get(url);
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    out[id] = `data:${type};base64,${buf.toString("base64")}`;
    console.log(`ok ${id}: ${Math.round(buf.length / 1024)}kb`);
  } catch (err) {
    console.log(`!  ${id}: ${err.message}`);
  }
  await sleep(300);
}

writeFileSync("posters.json", JSON.stringify(out, null, 0));

const missing = titles.filter((t) => !out[t.id]).map((t) => t.id);
console.log(`\n${Object.keys(out).length}/${titles.length} portadas, ${Math.round(JSON.stringify(out).length / 1024)}kb`);
if (missing.length) console.log(`faltan: ${missing.join(", ")}`);

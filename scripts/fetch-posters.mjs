/**
 * Downloads cover art for every title in the watchlist and writes them to
 * posters.json as base64 data URIs.
 *
 * Runs on a GitHub Actions runner because this repo's dev sandbox cannot
 * reach Wikimedia. Uses the keyless MediaWiki API: an exact article lookup
 * first, then a search fallback for titles whose article name we don't know.
 */

import { writeFileSync, readFileSync } from "node:fs";

const API = "https://en.wikipedia.org/w/api.php";
const THUMB_WIDTH = 320;
const UA = "tv-watchlist-poster-fetcher/1.0 (personal watchlist; contact via repo)";

const titles = JSON.parse(readFileSync(new URL("./titles.json", import.meta.url), "utf8"));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", origin: "*" })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} on ${params.titles || params.gsrsearch}`);
  return res.json();
}

/** Pull the pageimage thumbnail out of a query response, if there is one. */
function thumbFrom(json) {
  const pages = json?.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    if (page?.thumbnail?.source) return page.thumbnail.source;
  }
  return null;
}

async function findThumb(entry) {
  if (entry.wiki) {
    const exact = await api({
      action: "query",
      titles: entry.wiki,
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: String(THUMB_WIDTH),
      redirects: "1",
    });
    const hit = thumbFrom(exact);
    if (hit) return hit;
  }

  const search = await api({
    action: "query",
    generator: "search",
    gsrsearch: entry.search || `${entry.wiki || entry.id} film`,
    gsrlimit: "1",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: String(THUMB_WIDTH),
  });
  return thumbFrom(search);
}

async function toDataUri(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} fetching image`);
  const type = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

const out = {};
const missing = [];

for (const entry of titles) {
  try {
    const thumb = await findThumb(entry);
    if (!thumb) {
      missing.push(entry.id);
      console.log(`—  ${entry.id}: no image`);
      continue;
    }
    out[entry.id] = await toDataUri(thumb);
    const kb = Math.round(out[entry.id].length / 1024);
    console.log(`ok ${entry.id}: ${kb}kb`);
  } catch (err) {
    missing.push(entry.id);
    console.log(`!  ${entry.id}: ${err.message}`);
  }
  // Stay well inside the MediaWiki rate limit.
  await new Promise((r) => setTimeout(r, 250));
}

writeFileSync("posters.json", JSON.stringify(out, null, 0));

const totalKb = Math.round(JSON.stringify(out).length / 1024);
console.log(`\n${Object.keys(out).length}/${titles.length} covers, ${totalKb}kb total`);
if (missing.length) console.log(`missing: ${missing.join(", ")}`);

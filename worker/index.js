/**
 * Sirve la página y guarda qué está visto, compartido entre dispositivos.
 *
 * El estado vive en un único registro de KV: un objeto por id de título con
 * quién lo marcó y cuándo. Son dos personas, así que gana la última
 * escritura y no hace falta nada más elaborado.
 *
 * Quién sos lo dice Cloudflare Access en la cabecera; el Worker nunca ve
 * una contraseña. Sin Access delante (por ejemplo en local) queda "local".
 */

const CLAVE = "estado";
const PAGINA = "/TV-repositorio.html";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function quienEs(request) {
  return request.headers.get("Cf-Access-Authenticated-User-Email") || "local";
}

async function leer(env) {
  const raw = await env.ESTADO.get(CLAVE);
  return raw ? JSON.parse(raw) : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/estado") {
      const quien = quienEs(request);

      if (request.method === "GET") {
        return json({ quien, items: await leer(env) });
      }

      if (request.method === "POST") {
        let cuerpo;
        try {
          cuerpo = await request.json();
        } catch {
          return json({ error: "el cuerpo no es JSON" }, 400);
        }

        const { id, visto } = cuerpo || {};
        if (typeof id !== "string" || !id) {
          return json({ error: "falta id" }, 400);
        }

        const items = await leer(env);
        items[id] = { visto: !!visto, por: quien, cuando: new Date().toISOString() };
        await env.ESTADO.put(CLAVE, JSON.stringify(items));
        return json({ ok: true, id, item: items[id] });
      }

      return json({ error: "método no permitido" }, 405);
    }

    // La página vive en la raíz; el resto sale de los assets tal cual.
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL(PAGINA, url), request));
    }
    return env.ASSETS.fetch(request);
  },
};

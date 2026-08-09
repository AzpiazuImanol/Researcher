# 📺 TV — Repositorio

Listado de series y películas: qué está visto, qué falta, y qué vale la pena.

Se usa desde la URL del Worker. Los tildes se comparten entre todos los
dispositivos, y sólo entran los mails habilitados en Cloudflare Access.

## Cómo se arma

| Archivo | Qué es |
|---|---|
| `scripts/catalog.mjs` | El catálogo. Es lo único que se edita para sumar o cambiar títulos |
| `tv.html` | La plantilla: estilos y comportamiento, sin datos |
| `posters.json` | Las portadas en base64, generadas |
| `public/TV-repositorio.html` | La página final, generada |
| `worker/index.js` | Sirve la página y guarda qué está visto |

```
node scripts/build.mjs      # arma la página
npx wrangler deploy         # la publica
```

Las portadas las baja un workflow de GitHub Actions desde Wikipedia, porque
sale de una IP con acceso a Wikimedia. Se dispara solo al tocar `catalog.mjs`,
y sólo busca las que faltan.

Se trabaja siempre sobre estos mismos archivos: se sobrescriben, no se duplican.

## Puesta en marcha

Una sola vez:

1. Crear cuenta gratuita en Cloudflare.
2. `npx wrangler login`
3. `npx wrangler kv namespace create ESTADO` y pegar el `id` que devuelve en
   `wrangler.toml`, donde dice `COMPLETAR`.
4. `npx wrangler deploy` — devuelve la URL, algo como
   `tv-repositorio.<subdominio>.workers.dev`.
5. En el panel de Cloudflare: **Workers & Pages → tv-repositorio → Settings →
   Domains & Routes → Enable Cloudflare Access**, y cargar los mails que pueden
   entrar. Cualquier otro no ve ni la página.

Después de eso, cada cambio es `node scripts/build.mjs && npx wrangler deploy`.

## Cómo guarda el estado

Un único registro en KV, con un objeto por título: si está visto, quién lo marcó
y cuándo. Ganan las escrituras más recientes, que para dos personas alcanza.

La página consulta el servidor al abrirse, al volver a primer plano, y cada 25
segundos. `localStorage` queda como caché: si se cae la conexión se sigue
pudiendo marcar, y el indicador del encabezado avisa que quedó local.

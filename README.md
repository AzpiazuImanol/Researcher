# 📺 TV — Repositorio

Listado de series y películas: qué está visto, qué falta, y qué vale la pena.

**El archivo es [`TV-repositorio.html`](TV-repositorio.html)** — descargalo y abrilo
en cualquier navegador. Va todo adentro: portadas, datos y estilos. No necesita
internet ni instalar nada. Al pie de la página dice de qué versión es.

Los tildes de "visto" se guardan en el navegador donde lo abras.

## Cómo se arma

| Archivo | Qué es |
|---|---|
| `scripts/catalog.mjs` | El catálogo. Es lo único que se edita para sumar o cambiar títulos |
| `tv.html` | La plantilla: estilos y comportamiento, sin datos |
| `posters.json` | Las portadas en base64, generadas |
| `TV-repositorio.html` | La página final, generada |

```
node scripts/build.mjs      # arma TV-repositorio.html
```

Las portadas las baja un workflow de GitHub Actions desde Wikipedia, porque
salen de una IP con acceso a Wikimedia. Se dispara solo al tocar `catalog.mjs`,
y sólo busca las que faltan.

Se trabaja siempre sobre estos mismos archivos: se sobrescriben, no se duplican.

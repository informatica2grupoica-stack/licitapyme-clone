// Genera app/lib/chile-mapa-datos.ts (contornos de las 16 regiones listos para pintar en SVG) a partir de un GeoJSON de regiones.
// Fuente usada: maxfindel/chile-map-geojson, maps/cl-continental.js (datos de OpenStreetMap, © colaboradores de OpenStreetMap, ODbL).
// Uso: node scripts/generar-mapa-chile.mjs <ruta a cl-continental.js>
// El archivo descargado se lee SOLO como datos (se le quitan las líneas comentadas y se parsea como JSON); nunca se ejecuta.
import { readFileSync, writeFileSync } from 'node:fs';

const ruta = process.argv[2];
if (!ruta) { console.error('Falta la ruta del archivo cl-continental.js'); process.exit(1); }

const texto = readFileSync(ruta, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const geo = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));

const CLAVE = {
  'cl-ap': 'arica y parinacota', 'cl-ta': 'tarapacá', 'cl-an': 'antofagasta', 'cl-at': 'atacama', 'cl-co': 'coquimbo',
  'cl-vs': 'valparaíso', 'cl-rm': 'metropolitana', 'cl-li': "o'higgins", 'cl-ml': 'maule', 'cl-nb': 'ñuble', 'cl-bi': 'biobío',
  'cl-ar': 'araucanía', 'cl-lr': 'los ríos', 'cl-ll': 'los lagos', 'cl-ai': 'aysén', 'cl-ma': 'magallanes',
};

const K = 18;                         // píxeles por grado de latitud
const COS = Math.cos((35 * Math.PI) / 180); // la longitud se achica con la latitud media de Chile
const TOL = 0.28;                     // tolerancia de simplificación en píxeles

// Caja del mapa completo para que todas las regiones compartan escala.
let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
const todos = [];
for (const f of geo.features) {
  const g = f.geometry;
  const poligonos = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  todos.push({ key: CLAVE[f.properties['hc-key']], poligonos });
  for (const p of poligonos) for (const anillo of p) for (const [lon, lat] of anillo) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
}
const MARGEN = 4;
const proy = ([lon, lat]) => [(lon - minLon) * COS * K + MARGEN, (maxLat - lat) * K + MARGEN];
const ancho = Math.ceil((maxLon - minLon) * COS * K + MARGEN * 2);
const alto = Math.ceil((maxLat - minLat) * K + MARGEN * 2);

// Douglas-Peucker
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function simplificar(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = distSeg(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplificar(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplificar(pts.slice(idx), tol)];
}

const regiones = todos.map(({ key, poligonos }) => {
  let d = '';
  for (const p of poligonos) for (const anillo of p) {
    const pts = simplificar(anillo.map(proy), TOL);
    if (pts.length < 4) continue; // islotes que quedan en una línea
    d += `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
  }
  return { key, d };
});

const orden = Object.values(CLAVE);
regiones.sort((a, b) => orden.indexOf(a.key) - orden.indexOf(b.key));

const salida = `// GENERADO por scripts/generar-mapa-chile.mjs — no editar a mano.
// Contornos de las 16 regiones de Chile. Fuente: maxfindel/chile-map-geojson (https://github.com/maxfindel/chile-map-geojson),
// "Based on data from openstreetmap.org & polygons.openstreetmap.fr" — © colaboradores de OpenStreetMap (ODbL, https://www.openstreetmap.org/copyright).
// Proyección plana simple y simplificado para pintar en SVG.
export const MAPA_CHILE_ANCHO = ${ancho};
export const MAPA_CHILE_ALTO = ${alto};
export const MAPA_CHILE_REGIONES: Array<{ key: string; d: string }> = ${JSON.stringify(regiones, null, 2)};
`;
writeFileSync('app/lib/chile-mapa-datos.ts', salida);
console.log(`OK: ${regiones.length} regiones · ${ancho}x${alto} · ${(salida.length / 1024).toFixed(1)} KB`);

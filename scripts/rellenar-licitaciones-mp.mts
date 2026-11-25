// Rellena lo que falta de Mercado Público en la BD, SIN IA: por cada licitación pide UNA vez el detalle a la API oficial y guarda
//   · licitaciones_cache: comuna, items y la respuesta completa (raw_json, migration-207)
//   · adjudicacion_cache: el detalle de la adjudicación (quién ganó, montos por línea, acta) si la licitación ya está adjudicada
// Orden: primero las adjudicadas SIN adjudicacion_cache, después las que no tienen raw_json. Se puede cortar y volver a correr: retoma donde quedó.
//
//   npx tsx scripts/rellenar-licitaciones-mp.mts                       → solo cuenta lo pendiente (no llama a MP ni escribe)
//   npx tsx scripts/rellenar-licitaciones-mp.mts --aplicar --limite 200 → procesa hasta 200 códigos (cada llamada gasta cuota del ticket de MP)
//   opciones: --solo-adjudicadas  --espera 1500 (ms entre llamadas)  --max-min 60 (tope de minutos)
// Escribe en la BD de .env.local (hoy: la de producción por el túnel). Requiere migration-207 aplicada.
import fs from 'fs';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = v.replace(/^["']|["']$/g, '');
  }
}

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const aplicar = process.argv.includes('--aplicar');
const soloAdjudicadas = process.argv.includes('--solo-adjudicadas');
const solo_nuestras = process.argv.includes('--solo-nuestras');
const limite = Number(arg('--limite')) || 100;
const espera = Number(arg('--espera')) || 1500;
const tope = (Number(arg('--max-min')) || 60) * 60_000;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const pool = (await import('@/app/lib/db')).default;
  const { getMercadoPublicoClient } = await import('@/app/lib/mercado-publico');
  const { guardarCache } = await import('@/app/lib/licitaciones-cache');
  const adj = await import('@/app/lib/adjudicacion');

  const [col]: any = await pool.query(`SHOW COLUMNS FROM licitaciones_cache LIKE 'raw_json'`);
  if (!col.length) { console.error('Falta migration-207: node scripts/aplicar-migration-207.mjs --produccion'); process.exit(1); }

  const esAdj = `l.estado = 'Adjudicada'`;
  const [[c]]: any = await pool.query(
    `SELECT SUM(${esAdj} AND a.licitacion_codigo IS NULL) adj_sin_detalle, SUM(l.raw_json IS NULL) sin_raw, COUNT(*) total
       FROM licitaciones_cache l LEFT JOIN adjudicacion_cache a ON a.licitacion_codigo = l.codigo`);
  console.log(`Pendiente: ${c.adj_sin_detalle} adjudicadas sin detalle de adjudicación · ${c.sin_raw} sin raw_json · de ${c.total} licitaciones`);
  if (!aplicar) { console.log('Solo conteo. Para procesar: --aplicar --limite N'); await pool.end(); return; }

  // --solo-nuestras: únicamente licitaciones que la empresa toca (negocios, viabilidad, análisis, checklist, OC, competencia…), incluso las que aún no están en el caché.
  const NUESTRAS = ['negocios', 'viabilidad_licitacion', 'analisis_ia_licitacion', 'checklist_comercial', 'ordenes_compra', 'oferta_competencia', 'licitacion_apertura', 'compras_asignacion', 'entrega_proyecto', 'negocio_lineas_oferta']
    .map(t => `SELECT licitacion_codigo k FROM ${t}`).join(' UNION ');
  const [filas]: any = solo_nuestras
    ? await pool.query(
      `SELECT u.k AS codigo, (l.estado = 'Adjudicada' AND a.licitacion_codigo IS NULL) AS falta_adj
         FROM (${NUESTRAS}) u LEFT JOIN licitaciones_cache l ON l.codigo = u.k LEFT JOIN adjudicacion_cache a ON a.licitacion_codigo = u.k
        WHERE u.k IS NOT NULL AND (l.codigo IS NULL OR l.raw_json IS NULL OR (l.estado = 'Adjudicada' AND a.licitacion_codigo IS NULL))
        ORDER BY falta_adj DESC, u.k LIMIT ?`, [limite])
    : await pool.query(
    `SELECT l.codigo, (${esAdj} AND a.licitacion_codigo IS NULL) AS falta_adj
       FROM licitaciones_cache l LEFT JOIN adjudicacion_cache a ON a.licitacion_codigo = l.codigo
      WHERE ${soloAdjudicadas ? `(${esAdj} AND a.licitacion_codigo IS NULL)` : `((${esAdj} AND a.licitacion_codigo IS NULL) OR l.raw_json IS NULL)`}
      ORDER BY falta_adj DESC, l.updated_at DESC LIMIT ?`, [limite]);
  console.log(`Procesando ${filas.length} códigos (espera ${espera} ms)…`);

  const cliente = getMercadoPublicoClient();
  const t0 = Date.now();
  let ok = 0, adjGuardadas = 0, sinRespuesta = 0, seguidos429 = 0, demora = espera;
  for (const f of filas) {
    if (Date.now() - t0 > tope) { console.log('Tope de tiempo alcanzado.'); break; }
    const { lic, status } = await cliente.obtenerDetalleConEstado(f.codigo, 10_000);
    if (status === 429) {
      seguidos429++; demora = Math.min(Math.round(demora * 1.7), 8000); await dormir(demora);
      if (seguidos429 >= 5) { console.log('MP responde 429 seguido (cuota o ritmo): se detiene. Reintenta más tarde.'); break; }
      continue;
    }
    seguidos429 = 0;
    if (!lic) { sinRespuesta++; await dormir(demora); continue; }
    await guardarCache([lic]);
    ok++;
    if (f.falta_adj || /adjudicad/i.test(lic.EstadoNombre || '')) {
      try {
        const r = await adj.construirConReadjudicacion(lic, f.codigo);
        if (r.esAdjudicada) { await adj.guardarCache(f.codigo, r); adjGuardadas++; }
      } catch (e) { console.log(`  ${f.codigo}: adjudicación no guardada (${e instanceof Error ? e.message : e})`); }
    }
    if (ok % 25 === 0) console.log(`  ${ok}/${filas.length}…`);
    await dormir(demora);
  }
  console.log(`Listo en ${((Date.now() - t0) / 60000).toFixed(1)} min: ${ok} licitaciones guardadas, ${adjGuardadas} adjudicaciones, ${sinRespuesta} sin respuesta de MP.`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

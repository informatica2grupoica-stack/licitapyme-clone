// Backfill único: corre refrescarEstadosAsignadas (reutiliza la función real, con el fix nuevo
// de persistirCambioFechaCierre) con presupuesto ampliado, para corregir de inmediato cualquier
// `negocios.licitacion_cierre` desactualizado (caso 552975-50-LE26: quedó en 23-jul, MP lo movió
// a 27-jul) en vez de esperar el próximo ciclo natural (cron cada ~4h / negocio abierto).
// Uso: npx tsx scripts/backfill-fecha-cierre.mts
import fs from 'fs';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = v.replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const { refrescarEstadosAsignadas } = await import('@/app/lib/refrescar-estados');
  const pool = (await import('@/app/lib/db')).default;

  const [[antes]]: any = await pool.query(
    `SELECT licitacion_cierre FROM negocios WHERE licitacion_codigo='552975-50-LE26' AND activo=TRUE`);
  console.log('552975-50-LE26 ANTES:', antes?.licitacion_cierre);

  const t0 = Date.now();
  const r = await refrescarEstadosAsignadas({ presupuestoMs: 280_000, timeoutMs: 6_000, notificar: true });
  console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(1)}s:`, r);

  const [[despues]]: any = await pool.query(
    `SELECT licitacion_cierre FROM negocios WHERE licitacion_codigo='552975-50-LE26' AND activo=TRUE`);
  console.log('552975-50-LE26 DESPUÉS:', despues?.licitacion_cierre);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

// Backfill único: corre refrescarEstadosAsignadas (la MISMA función que ya usa el botón
// "Actualizar" y el refresco en background) con presupuesto ampliado, para que los negocios
// activos existentes reciban `fecha_fin_preguntas` de inmediato (recién agregada en migración 46)
// en vez de esperar el próximo ciclo natural de 2h. No hay lógica nueva: solo se le da más tiempo.
// Uso: npx tsx scripts/backfill-fecha-fin-preguntas.mts
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

  const t0 = Date.now();
  const r = await refrescarEstadosAsignadas({ presupuestoMs: 280_000, timeoutMs: 6_000, notificar: false });
  console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(1)}s:`, r);

  const [[cnt]]: any = await pool.query(
    `SELECT COUNT(*) AS n FROM negocios WHERE activo=TRUE AND fecha_fin_preguntas IS NOT NULL`);
  console.log('negocios activos con fecha_fin_preguntas ya guardada:', cnt.n);
  const [[cntFuturo]]: any = await pool.query(
    `SELECT COUNT(*) AS n FROM negocios WHERE activo=TRUE AND fecha_fin_preguntas >= NOW()`);
  console.log('de esas, con fecha en el FUTURO:', cntFuturo.n);
  const [[cnt48h]]: any = await pool.query(
    `SELECT COUNT(*) AS n FROM negocios WHERE activo=TRUE AND fecha_fin_preguntas >= NOW() AND fecha_fin_preguntas <= NOW() + INTERVAL 2 DAY`);
  console.log('de esas, dentro de las próximas 48h (lo que dispara la alerta):', cnt48h.n);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

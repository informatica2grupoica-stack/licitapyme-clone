// Orquestador de descarga/prefiltro por SETS (todos los perfiles). Modos:
//   --counts            solo cuenta (no descarga)
//   --test-negocios     descarga 1 sola licitación de negocios (valida IP chilena)
//   --paso1             descarga docs de NEGOCIOS activos sin docs (+pipeline forzado)
//   --paso2             prefiltra el RADAR completo (alertas sin decisión)
//   --paso3             descarga docs del RADAR con prefiltro PASA sin docs (+pipeline)
//   --limite=N          tope de licitaciones a procesar en el paso (para pruebas)
import { readFileSync } from 'fs';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const limite = (() => { const a = args.find(x => x.startsWith('--limite=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectionLimit: 3,
});

async function codigos(sql: string): Promise<string[]> {
  const [r] = await pool.query(sql) as any[];
  return (r as any[]).map(x => x.licitacion_codigo as string);
}

const SQL_NEG_SIN_DOCS =
  `SELECT DISTINCT n.licitacion_codigo
   FROM negocios n
   WHERE n.activo = TRUE
     AND NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = n.licitacion_codigo)
   ORDER BY n.updated_at DESC`;

const SQL_RADAR_SIN_PREF =
  `SELECT DISTINCT al.licitacion_codigo
   FROM alertas_licitaciones al
   WHERE NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)
   ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC`;

const SQL_RADAR_PASA_SIN_DOCS =
  `SELECT DISTINCT al.licitacion_codigo
   FROM alertas_licitaciones al
   JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = al.licitacion_codigo AND pf.decision = 'PASA'
   WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)
   ORDER BY al.licitacion_cierre DESC`;

async function descargarLote(lista: string[], forzarPipeline: boolean) {
  const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
  const { procesarLicitacionCompleta } = await import('@/app/lib/pipeline-licitacion');
  let ok = 0, err = 0, docs = 0;
  const total = Math.min(lista.length, limite);
  for (let i = 0; i < total; i++) {
    const codigo = lista[i];
    try {
      const res = await descargarDocumentosLicitacion(codigo);
      if (res.exito) { ok++; docs += res.nuevos; } else { err++; }
      const marca = res.exito ? '✓' : '✗';
      console.log(`[${i + 1}/${total}] ${marca} ${codigo} · nuevos=${res.nuevos}${res.error ? ' · ' + res.error : ''}`);
      if (res.exito) {
        try { await procesarLicitacionCompleta(codigo, { forzar: forzarPipeline }); }
        catch (e: any) { console.log(`      pipeline: ${String(e.message).slice(0, 120)}`); }
      }
    } catch (e: any) {
      err++; console.log(`[${i + 1}/${total}] ✗ ${codigo} · EXCEPCIÓN: ${String(e.message).slice(0, 150)}`);
    }
  }
  console.log(`\n==> lote terminado: ${ok} ok · ${err} con error · ${docs} documentos nuevos`);
}

async function main() {
  if (has('--counts')) {
    const [a, b, c] = await Promise.all([codigos(SQL_NEG_SIN_DOCS), codigos(SQL_RADAR_SIN_PREF), codigos(SQL_RADAR_PASA_SIN_DOCS)]);
    console.log(`negocios sin docs: ${a.length} · radar sin prefiltro: ${b.length} · radar PASA sin docs: ${c.length}`);
  } else if (has('--test-negocios')) {
    const lista = await codigos(SQL_NEG_SIN_DOCS);
    if (!lista.length) { console.log('No hay negocios sin docs.'); }
    else { console.log(`TEST 1 descarga (valida IP chilena) → ${lista[0]}`); await descargarLote([lista[0]], true); }
  } else if (has('--paso1')) {
    const lista = await codigos(SQL_NEG_SIN_DOCS);
    console.log(`PASO 1 · NEGOCIOS sin docs: ${lista.length} (procesando ${Math.min(lista.length, limite)})`);
    await descargarLote(lista, true);
  } else if (has('--paso2')) {
    const { prefiltrarYGuardar } = await import('@/app/lib/prefiltro');
    let lista = await codigos(SQL_RADAR_SIN_PREF);
    lista = lista.slice(0, limite);
    console.log(`PASO 2 · RADAR sin prefiltro: ${lista.length}`);
    const LOTE = 30;
    for (let i = 0; i < lista.length; i += LOTE) {
      const chunk = lista.slice(i, i + LOTE);
      const res = await prefiltrarYGuardar(chunk);
      const pasa = res.filter(r => r.decision === 'PASA').length;
      const exc = res.filter(r => r.decision === 'EXCLUIDO').length;
      console.log(`  lote ${i / LOTE + 1}: ${res.length} listas · ${pasa} PASA · ${exc} EXCLUIDO`);
    }
    console.log('==> prefiltro terminado');
  } else if (has('--paso3')) {
    const lista = await codigos(SQL_RADAR_PASA_SIN_DOCS);
    console.log(`PASO 3 · RADAR PASA sin docs: ${lista.length} (procesando ${Math.min(lista.length, limite)})`);
    await descargarLote(lista, false);
  } else {
    console.log('Modo requerido: --counts | --test-negocios | --paso1 | --paso2 | --paso3  [--limite=N]');
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

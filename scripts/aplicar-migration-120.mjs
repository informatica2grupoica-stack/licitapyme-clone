// Aplica migration-120: preguntas Sí/No de las tareas de Compras pasan a selector (campos_json del
// catálogo) y se normalizan los registros ya guardados de "Fabricante identificable" ("si" → "Sí").
// Ver docs/migration-120-compras-tareas-si-no.sql. Idempotente.
// Uso: node scripts/aplicar-migration-120.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const OBS = { clave: 'observaciones', etiqueta: 'Observaciones', tipo: 'parrafo' };
const FORMULARIOS = {
  validacion_tecnica_real: [
    { clave: 'producto', etiqueta: 'Producto que se va a comprar', tipo: 'texto', placeholder: 'Marca y modelo' },
    { clave: 'fabricante', etiqueta: '¿Hay un fabricante identificable?', tipo: 'si_no' },
    { clave: 'ficha_real', etiqueta: '¿La ficha corresponde a un producto que existe de verdad?', tipo: 'si_no' },
    { clave: 'producto_correcto', etiqueta: '¿El producto cotizado es el que se ofertó y el que cumple?', tipo: 'si_no' },
    { clave: 'fuente', etiqueta: 'Dónde se verificó', tipo: 'texto', placeholder: 'Sitio del fabricante, distribuidor oficial...' },
    OBS,
  ],
  boleta_fiel_cumplimiento: [
    { clave: 'entregada', etiqueta: '¿Se entregó la boleta de fiel cumplimiento?', tipo: 'si_no' },
    OBS,
  ],
  firma_contrato: [
    { clave: 'firmado', etiqueta: '¿Se firmó el contrato?', tipo: 'si_no' },
    OBS,
  ],
};

try {
  console.log('\n  Aplicando migration-120 (tareas de Compras: Sí/No como selector)...');
  for (const [clave, campos] of Object.entries(FORMULARIOS)) {
    const [r] = await pool.query('UPDATE compras_tarea_catalogo SET campos_json = ? WHERE clave = ?', [JSON.stringify({ campos }), clave]);
    console.log(`    catálogo ${clave}: ${r.affectedRows} fila(s)`);
  }

  // "si"/"SI"/"sí" escrito a mano → "Sí"; "no" → "No". Otro texto (ej. "Trotec") no se toca.
  const [regs] = await pool.query(
    `SELECT id, registro_json FROM compras_tarea WHERE catalogo_clave = 'validacion_tecnica_real' AND registro_json IS NOT NULL`);
  for (const r of regs) {
    let reg; try { reg = JSON.parse(r.registro_json); } catch { continue; }
    const v = typeof reg.fabricante === 'string' ? reg.fabricante.trim().toLowerCase() : '';
    const nuevo = v === 'si' || v === 'sí' ? 'Sí' : v === 'no' ? 'No' : null;
    if (!nuevo || reg.fabricante === nuevo) continue;
    reg.fabricante = nuevo;
    await pool.query('UPDATE compras_tarea SET registro_json = ? WHERE id = ?', [JSON.stringify(reg), r.id]);
    console.log(`    tarea ${r.id}: fabricante → ${nuevo}`);
  }

  const [ver] = await pool.query(
    `SELECT clave, campos_json FROM compras_tarea_catalogo WHERE clave IN ('validacion_tecnica_real','boleta_fiel_cumplimiento','firma_contrato')`);
  for (const v of ver) {
    const n = JSON.parse(v.campos_json).campos.filter(c => c.tipo === 'si_no').length;
    console.log(`  Verificación: ${v.clave} → ${n} campo(s) Sí/No`);
  }
  console.log();
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }

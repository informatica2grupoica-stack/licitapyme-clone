// Verificación end-to-end (solo lectura + 1 escritura de prueba) del Auditor Técnico Fase 1.
// Busca un negocio real en ANEXOS+ cuyo informe de viabilidad traiga productos.items con
// caracteristicas[], simula lo que hace generarItemsDesdeViabilidad + el Agente Técnico, y borra
// lo que insertó al final (no deja basura en la BD real).
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const { generarItemsDesdeViabilidad } = await import('../app/lib/checklist-comercial.ts');
const { lineasTecnicasDelInforme, clasificarCaracteristicasLinea } = await import('../app/lib/auditor-tecnico.ts');

try {
  const [rows] = await pool.query(`
    SELECT v.licitacion_codigo, v.informe_ejecutivo, n.id AS negocio_id, n.estado_pipeline
      FROM viabilidad_licitacion v
      JOIN negocios n ON n.licitacion_codigo = v.licitacion_codigo AND n.activo = TRUE
     WHERE n.estado_pipeline IN ('ANEXOS','ANEXO_LISTO','VISADO','POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA')
     ORDER BY v.id DESC LIMIT 60
  `);

  let candidato = null;
  for (const r of rows) {
    let ie; try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; } catch { continue; }
    const informe = ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
    if (!informe) continue;
    const lineas = lineasTecnicasDelInforme(informe);
    if (lineas.some(l => l.caracteristicas.length > 0)) { candidato = { ...r, informe, lineas }; break; }
  }

  if (!candidato) {
    console.log('\n  No se encontró ningún negocio en ANEXOS+ con caracteristicas[] en productos.items (entre los 60 más recientes). Nada que verificar en vivo.\n');
    process.exit(0);
  }

  console.log(`\n  Candidato: ${candidato.licitacion_codigo} (negocio ${candidato.negocio_id}, estado ${candidato.estado_pipeline})`);
  console.log(`  Líneas técnicas detectadas: ${candidato.lineas.filter(l => l.caracteristicas.length > 0).length}`);

  // 1) generarItemsDesdeViabilidad genera la(s) cabecera(s) linea_tecnica correctamente.
  const items = generarItemsDesdeViabilidad(candidato.informe);
  const tecnicas = items.filter(i => i.tipo === 'linea_tecnica');
  console.log(`  generarItemsDesdeViabilidad → ${tecnicas.length} cabecera(s) linea_tecnica:`);
  for (const t of tecnicas) console.log(`    - ${t.claveOrigen} · "${t.titulo}" · criticidad=${t.criticidad}`);
  if (tecnicas.length === 0) throw new Error('Se esperaba al menos 1 cabecera linea_tecnica y no se generó ninguna.');

  // 2) Agente Técnico real (1 llamada IA, la línea con más características) — prueba real de
  //    extremo a extremo del prompt/parseo, no solo de la lógica determinista.
  const lineaDePrueba = [...candidato.lineas].filter(l => l.caracteristicas.length > 0).sort((a, b) => b.caracteristicas.length - a.caracteristicas.length)[0];
  console.log(`\n  Llamando al Agente Técnico (glm-5.2) sobre línea ${lineaDePrueba.linea} — ${lineaDePrueba.nombre} (${lineaDePrueba.caracteristicas.length} característica(s))...`);
  const clasificadas = await clasificarCaracteristicasLinea(lineaDePrueba, { licitacionCodigo: candidato.licitacion_codigo });
  console.log(`  Agente Técnico devolvió ${clasificadas.length} característica(s) clasificada(s):`);
  for (const c of clasificadas.slice(0, 8)) {
    console.log(`    - [${c.tipo}] ${c.descripcion.slice(0, 70)} → exigido: ${c.valorRequeridoNumero ?? c.valorRequeridoTexto ?? '—'}${c.unidadRequerida ? ' ' + c.unidadRequerida : ''} (confianza ${c.confianza})`);
  }
  if (clasificadas.length === 0) throw new Error('El Agente Técnico no clasificó ninguna característica (respuesta vacía o JSON no parseable).');

  console.log('\n  ✅ Verificación OK: generación de cabeceras + Agente Técnico funcionando de extremo a extremo.');
  console.log('  (No se escribió nada en checklist_comercial ni checklist_comercial_caracteristicas — esto fue solo en memoria.)\n');
} catch (e) {
  console.error('\n  ❌ ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }

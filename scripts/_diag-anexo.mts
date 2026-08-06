// Diagnóstico detallado del Anexo Creator sobre UN documento real.
//   npx tsx scripts/_diag-penalolen.mts [idDocumento]
// Muestra, celda por celda (incluidas las de tabla), qué etiqueta detectó y cómo la resolvió.
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado } = await import('@/app/lib/anexos-docx');

const idDoc = Number(process.argv[2] || 22110);
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [docs]: any = await pool.query(`SELECT * FROM documentos_cache WHERE id = ?`, [idDoc]);
const d = docs[0];
const [neg]: any = await pool.query(
  `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND empresa_id IS NOT NULL LIMIT 1`, [d.licitacion_codigo]);
const [emp]: any = await pool.query(`SELECT * FROM empresas WHERE id = ?`, [neg[0].empresa_id]);
const empresa = conCamposDerivados(emp[0]);
console.log(`DOC ${idDoc} · ${d.licitacion_codigo} · ${d.documento_nombre}`);
console.log(`EMPRESA: ${empresa.razon_social} / rep ${empresa.representante_nombre} ${empresa.representante_rut} / tel ${empresa.telefono1} / mail ${empresa.email1} / firma ${empresa.firma_url ? 'SÍ' : 'NO'} / timbre ${empresa.timbre_url ? 'SÍ' : 'NO'}`);

const buffer = Buffer.from(await (await fetch(d.documento_url_local)).arrayBuffer());

// ── Detección cruda (sin IA) ──────────────────────────────────────────────────
const { xml: x0 } = await abrirDocx(buffer);
const xml = unificarRunsDeMarcadores(normalizarParaIds(eliminarRespaldoVmlDuplicado(x0)).xml);
const det = analizarAnexo(xml);
console.log(`\n=== DETECCIÓN CRUDA ===`);
console.log(`candidatosCelda=${det.candidatosCelda.length} inline=${det.blancosInline.length} dosPuntos=${det.camposConDosPuntos.length} firmas=${det.lineasFirma.length}`);
console.log(`\n-- camposConDosPuntos (patrón 5, se AUTOCOMPLETAN sin quedar visibles) --`);
for (const c of det.camposConDosPuntos) console.log(`  [${c.indice}] "${c.etiqueta}"`);
console.log(`\n-- lineasFirma --`);
for (const f of det.lineasFirma) console.log(`  [${f.indice}] "${f.contexto}" timbre=${!!f.pideTimbre} sinRaya=${!!f.sinRaya}`);

// Todos los párrafos que mencionan FIRMA o RUT, para ver qué se perdió
console.log(`\n-- párrafos con "FIRMA" / "RUT:" --`);
det.parrafos.forEach(p => {
  if (/firma|^\s*rut\s*:/i.test(p.texto) && p.texto.length < 120) console.log(`  [${p.indice}] centrado=${p.centrado} "${p.texto}"`);
});

// ── Análisis completo (con IA) ────────────────────────────────────────────────
const a = await analizarAnexoParaUI(buffer, empresa);
console.log(`\n=== RESULTADO ===`);
console.log(`\n-- AUTO (${a.completadosAuto.length}) --`);
for (const c of a.completadosAuto) console.log(`  ✓ "${c.etiqueta}" → ${c.campo} = "${c.valor}" (${c.via})`);
console.log(`\n-- TABLAS --`);
a.tablas.forEach((t, i) => {
  console.log(`  tabla ${i} · ${t.titulo || t.formulario || ''}`);
  t.filas.forEach(f => {
    const linea = f.map(c => c.auto ? `[✓${c.auto.valor}]` : c.input ? `[__${c.input.id}]` : (c.texto || '·').slice(0, 28)).join(' | ');
    console.log(`     ${linea}`);
  });
});
console.log(`\n-- PENDIENTES CELDA (${a.pendientesCelda.length}) --`);
for (const p of a.pendientesCelda) console.log(`  · "${p.etiqueta}" [${p.categoria}]`);
console.log(`\n-- PENDIENTES INLINE (${a.pendientesInline.length}) --`);
for (const p of a.pendientesInline) console.log(`  · "${p.contexto}" [${p.categoria}] :: ${(p.parrafoCompleto || '').slice(0, 110)}`);
console.log(`\n-- FIRMA --`, JSON.stringify(a.firma, null, 1));

await pool.end();

// Diagnóstico: corre analizarAnexoParaUI() de verdad contra los anexos Word reales de la
// licitación 1738-18-LE26 (BD + R2 de producción, SOLO LECTURA — no sube ni modifica nada) para
// confirmar si los 3 fixes de esta sesión (numeración "1.- ", IA que se cortaba, y — aunque este
// es de generarAnexoFinal, no de analizar — el divisor de tablas) realmente resuelven lo que
// reportó el usuario.
// Uso: npx tsx scripts/_diag-anexo-1738.mts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const CODIGO = '1738-18-LE26';
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [negRows]: any = await pool.query(
  `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND empresa_id IS NOT NULL LIMIT 1`, [CODIGO],
);
const empresaId = negRows[0]?.empresa_id;
if (!empresaId) { console.log('No hay empresa asignada a', CODIGO, '— no se puede probar.'); process.exit(1); }
console.log('empresaId:', empresaId);

const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
     FROM empresas WHERE id = ?`, [empresaId],
);
const empresa = empRows[0];
console.log('Empresa:', empresa?.razon_social, '| campos con dato:', Object.entries(empresa || {}).filter(([, v]) => v).map(([k]) => k).join(', '));

const [docs]: any = await pool.query(
  `SELECT id, documento_nombre, documento_url_local FROM documentos_cache
     WHERE licitacion_codigo = ? AND (documento_nombre LIKE '%.doc' OR documento_nombre LIKE '%.docx')`,
  [CODIGO],
);
console.log(`\n${docs.length} documento(s) Word encontrados para ${CODIGO}:`);
for (const d of docs) console.log(` - [${d.id}] ${d.documento_nombre}`);

for (const d of docs) {
  console.log(`\n${'='.repeat(70)}\n${d.documento_nombre} (id ${d.id})\n${'='.repeat(70)}`);
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) { console.log('  no se pudo bajar:', res.status); continue; }
    let buffer: Buffer = Buffer.from(await res.arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buffer = Buffer.from(await convertirDocADocx(buffer));

    // Debug: ¿el documento usa "ANEXO N°X" en vez de "FORMULARIO N°X" como separador de secciones?
    const { xml: xmlCrudo } = await abrirDocx(buffer);
    const posiblesEncabezados = [...xmlCrudo.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map(m => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('').trim())
      .filter(t => t.length > 0 && t.length <= 80 && /^(ANEXO|FORMULARIO)\b/i.test(t));
    console.log(`  Encabezados "ANEXO"/"FORMULARIO" encontrados en el texto (${posiblesEncabezados.length}):`);
    for (const h of posiblesEncabezados) console.log(`    "${h}"`);

    // Debug: contexto de texto alrededor de "FIRMA" para entender por qué no se detecta la línea de firma.
    const todosParrafos = [...xmlCrudo.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map(m => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('').trim());
    console.log(`  Contexto alrededor de "FIRMA" (párrafos):`);
    todosParrafos.forEach((t, i) => {
      if (/firma/i.test(t)) {
        const desde = Math.max(0, i - 3), hasta = Math.min(todosParrafos.length, i + 3);
        console.log(`    [${i}] rango ${desde}-${hasta}:`);
        for (let j = desde; j < hasta; j++) console.log(`      ${j === i ? '>> ' : '   '}[${j}] "${todosParrafos[j]}"`);
      }
    });

    const analisis = await analizarAnexoParaUI(buffer, empresa);
    writeFileSync('scripts/_out-anexo-1738/analisis.json', JSON.stringify(analisis, null, 2));
    console.log(`  Se completa solo: ${analisis.completadosAuto.length}`);
    for (const c of analisis.completadosAuto) console.log(`    [${c.via}] "${c.etiqueta}" → ${c.campo} = "${c.valor}"`);
    console.log(`  Pendientes (celda, fuera de tabla): ${analisis.pendientesCelda.length}`);
    console.log(`  Tablas con pendientes: ${(analisis as any).tablas.length}`);
    for (const t of (analisis as any).tablas.slice(0, 2)) {
      console.log(`    --- tabla (formulario: ${t.formulario || '(sin grupo)'}, ${t.filas.length} filas) ---`);
      for (const fila of t.filas.slice(0, 6)) {
        console.log('      ' + fila.map((c: any) => c.input ? `[INPUT]` : c.auto ? `[AUTO:${c.auto.valor}]` : `"${c.texto}"`).join(' | '));
      }
    }
    console.log(`  Pendientes (inline): ${analisis.pendientesInline.length}`);
    console.log(`  Firma: detectada=${analisis.firma.detectada} disponible=${analisis.firma.disponible}`);

    // Prueba también el flujo de generación completo + divisor, para validar integridad y que
    // las tablas sobrevivan si el documento se divide en formularios.
    const generado = await generarAnexoFinal(buffer, empresa, {});
    console.log(`  Integridad (párrafos iguales): ${generado.integridad.parrafosIguales} (${generado.integridad.parrafosAntes} → ${generado.integridad.parrafosDespues})`);
    const { xml: xmlFinal } = await abrirDocx(generado.buffer);
    const formularios = await dividirPorFormularios(generado.buffer, xmlFinal);
    console.log(`  Formularios detectados para dividir: ${formularios.length}`);
    for (const f of formularios) {
      const { xml: xmlFrag } = await abrirDocx(f.buffer);
      const tieneTabla = /<w:tbl/.test(xmlFrag);
      const numCeldas = (xmlFrag.match(/<w:tc>/g) || []).length;
      console.log(`    - ${f.titulo} → ${f.nombreSufijo} | tabla=${tieneTabla} celdas=${numCeldas} | ${f.buffer.length} bytes`);
    }

    // Guarda el .docx generado (SOLO local, no se sube a R2 ni se registra en documentos_cache
    // — eso solo lo hace la ruta /api/anexos/generar, no esta función pura) para que se pueda
    // abrir en Word y verificar visualmente.
    const dirSalida = 'scripts/_out-anexo-1738';
    mkdirSync(dirSalida, { recursive: true });
    const nombreSalida = `${dirSalida}/ANEXO_${d.documento_nombre.replace(/\.doc$/i, '.docx')}`;
    writeFileSync(nombreSalida, generado.buffer);
    console.log(`  Guardado en: ${nombreSalida}`);
    if (formularios.length >= 2) {
      for (const f of formularios) {
        const nombreFrag = `${dirSalida}/ANEXO_${f.nombreSufijo}_${d.documento_nombre.replace(/\.doc$/i, '.docx')}`;
        writeFileSync(nombreFrag, f.buffer);
        console.log(`  Guardado en: ${nombreFrag}`);
      }
    }
  } catch (e: any) {
    console.log('  ERROR:', e?.message || e);
  }
}

await pool.end();

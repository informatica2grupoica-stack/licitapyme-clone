// Diagnóstico puntual: verificar el relleno automático del anexo de 2908-16-LE26 antes del
// cierre de hoy. Usa el .docx ya convertido a mano (Word COM, conversor-doc no disponible en
// este entorno local) y corre exactamente el mismo camino que /api/anexos/analizar.
// Uso: npx tsx scripts/_diag-2908-16-le26.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { obtenerItemsCosteoParaAnexo, obtenerTextoBasesParaAnexo } = await import('@/app/lib/anexos-datos');

const CODIGO = '2908-16-LE26';
const EMPRESA_ID = 1;
const DOCX_PATH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/aa86d70f-a793-492f-9f25-44997cf92b81/scratchpad/anexo-2908-16-LE26.docx';

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
          banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
     FROM empresas WHERE id = ?`, [EMPRESA_ID],
);
const empresaCruda = empRows[0];
const empresa = conCamposDerivados(empresaCruda);

const itemsCosteo = await obtenerItemsCosteoParaAnexo(CODIGO);
const basesTexto = await obtenerTextoBasesParaAnexo(CODIGO);
console.log(`itemsCosteo=${itemsCosteo.length} basesTexto=${basesTexto.length} chars`);

const buffer = readFileSync(DOCX_PATH);
const analisis = await analizarAnexoParaUI(buffer, empresa, itemsCosteo, basesTexto);

console.log(`\n=== RESUMEN ===`);
console.log(`completadosAuto=${analisis.completadosAuto.length}`);
console.log(`tablas=${analisis.tablas.length}`);
console.log(`pendientesCelda(fuera de tabla)=${analisis.pendientesCelda.length}`);
console.log(`pendientesInline=${analisis.pendientesInline.length}`);

console.log(`\n=== COMPLETADOS AUTO (lo que el sistema escribiría solo) ===`);
for (const c of analisis.completadosAuto) {
  console.log(`  [${c.via}] idx=${c.indice} form="${c.formulario}" "${c.etiqueta}" => "${c.valor}"`);
}

console.log(`\n=== PENDIENTES FUERA DE TABLA ===`);
for (const p of analisis.pendientesCelda) console.log(`  - "${p.etiqueta}"`);
for (const p of analisis.pendientesInline) console.log(`  - inline: "${p.contexto}"`);

console.log(`\n=== TABLAS ===`);
for (const t of analisis.tablas) {
  console.log(`\n--- Tabla (${t.filas?.length ?? '?'} filas) ---`);
  console.log(JSON.stringify(t, null, 1).slice(0, 4000));
}

await pool.end();

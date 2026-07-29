// Corre analizarAnexoParaUI() contra varios anexos reales de licitaciones DISTINTAS (no solo
// 1738-18-LE26) para revisar si el filtro de "título vs campo real" generaliza, o si el
// problema de títulos-como-pendiente sigue apareciendo en otros documentos/organismos.
// Uso: npx tsx scripts/_diag-anexos-varios.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const IDS = [21451, 21450, 21390, 21384, 21383, 21381, 21370, 21369, 21295, 21281, 21278];

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// Empresa cualquiera con datos cargados, solo para probar la DETECCIÓN estructural (no importa
// si es la empresa real asignada a esa licitación específica).
const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
     FROM empresas WHERE id = 2`,
);
const empresa = empRows[0];

for (const id of IDS) {
  const [docs]: any = await pool.query(
    `SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id = ?`, [id],
  );
  const d = docs[0];
  if (!d) { console.log(`[${id}] no encontrado`); continue; }
  console.log(`\n${'='.repeat(70)}\n[${d.licitacion_codigo}] ${d.documento_nombre} (id ${id})\n${'='.repeat(70)}`);
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) { console.log('  no se pudo bajar:', res.status); continue; }
    let buffer: Buffer = Buffer.from(await res.arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buffer = Buffer.from(await convertirDocADocx(buffer));

    const analisis = await analizarAnexoParaUI(buffer, empresa);
    console.log(`  completadosAuto=${analisis.completadosAuto.length} tablas=${analisis.tablas.length} pendientesCelda(fuera de tabla)=${analisis.pendientesCelda.length} pendientesInline=${analisis.pendientesInline.length}`);
    if (analisis.pendientesCelda.length > 0) {
      console.log('  pendientesCelda (revisar si son campos reales o títulos colados):');
      for (const p of analisis.pendientesCelda) console.log(`    - "${p.etiqueta}"`);
    }
  } catch (e: any) {
    console.log('  ERROR:', e?.message || e);
  }
}

await pool.end();

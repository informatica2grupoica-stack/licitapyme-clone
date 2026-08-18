// End-to-end real de 2296-48-LE26: separa FORMATOS_EDITABLES.docx en sus 7 formatos y, para cada
// uno, corre el MISMO análisis que ve el modal de relleno (analizarAnexoParaUI) con la empresa
// realmente asignada al negocio. Reporta auto vs pendiente por anexo y por categoría.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { analizarAnexoParaUI, generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

const [er]: any = await pool.query(`SELECT * FROM empresas WHERE id = 2`);
const empresa = conCamposDerivados(er[0]);
const [dr]: any = await pool.query(`SELECT documento_url_local FROM documentos_cache WHERE id = 22869`);
const buf = Buffer.from(await (await fetch(dr[0].documento_url_local)).arrayBuffer());
const { xml: crudo } = await abrirDocx(buf);
const { xml } = normalizarParaIds(crudo);
const formularios = await dividirPorFormularios(buf, xml);
mkdirSync('scripts/_out-2296', { recursive: true });
for (const f of formularios) {
  const a = await analizarAnexoParaUI(f.buffer, empresa);
  const autoTabla = a.tablas.flatMap((t: any) => t.filas.flatMap((fi: any) => fi.filter((c: any) => c.auto)));
  const pendTabla = a.tablas.flatMap((t: any) => t.filas.flatMap((fi: any) => fi.filter((c: any) => c.input)));
  const auto = a.completadosAuto.length + autoTabla.length;
  const pend = a.pendientesCelda.length + a.pendientesInline.length + pendTabla.length;
  console.log(`\n── [${f.categoria}] ${f.nombreArchivo}`);
  console.log(`   auto ${auto} · pendiente ${pend}${a.noAplica ? `  ⚑ NO APLICA: ${a.noAplica.motivo?.slice(0,80)}` : ''}`);
  for (const p of a.pendientesCelda) console.log(`   · pend celda: "${p.etiqueta}" [${p.categoria || '-'}]`);
  for (const p of a.pendientesInline) console.log(`   · pend inline: "${(p.contexto||'').trim().slice(0,70)}" [${p.categoria || '-'}]`);
  if (pendTabla.length) console.log(`   · pend en tablas: ${pendTabla.length} celdas`);
  const gen = await generarAnexoFinal(f.buffer, empresa, {});
  console.log(`   integridad: ${gen.integridad.parrafosIguales ? 'OK' : 'FALLÓ'} (${gen.integridad.parrafosAntes}→${gen.integridad.parrafosDespues})`);
  writeFileSync(`scripts/_out-2296/${f.nombreArchivo}.docx`, gen.buffer);
}
await pool.end();

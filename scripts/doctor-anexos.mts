// DOCTOR DE ANEXOS — barre los documentos Word de las licitaciones y lista aquellos donde el motor
// NO entendió el formato. Es la lista de trabajo del motor de anexos, generada sola.
//
// POR QUÉ EXISTE (18-ago-2026): todos los bugs graves de este motor se descubrieron porque un HUMANO
// abrió un .docx y vio que faltaba algo — "FORMATO" en vez de "FORMULARIO" (7 anexos, 0 detectados),
// marcadores con un solo par de ángulos (7 marcadores, 0 detectados), el costeo leído como $0. En
// todos, el sistema respondió algo indistinguible de "este documento no pide nada". Este script
// hace esa pregunta por sí solo, sobre todas las licitaciones, y ordena el resultado por gravedad.
//
//   npx tsx scripts/doctor-anexos.mts                 → solo licitaciones ABIERTAS (lo urgente)
//   npx tsx scripts/doctor-anexos.mts --todas         → también las cerradas
//   npx tsx scripts/doctor-anexos.mts --limite 400
//   npx tsx scripts/doctor-anexos.mts --json salida.json
//
// Lo que reporta:
//   🔴 CIEGO    el documento está lleno de marcas de relleno y el motor no detectó ninguna casilla.
//               Es SIEMPRE un formato que no reconocemos. Arreglar esto sirve para todas las
//               licitaciones que usen ese mismo formato, no solo para una.
//   🟡 REVISAR  detectó bastante menos de lo que el texto sugiere, o no supo completar nada.
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const todas = process.argv.includes('--todas');
const limite = Number(arg('limite')) || 200;
const salidaJson = arg('json');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// La empresa importa poco para el diagnóstico (lo que se mide es la DETECCIÓN, no qué dato entra),
// pero se usa la realmente asignada cuando existe, para que el conteo de "resueltas" sea el real.
const [empresas]: any = await pool.query('SELECT * FROM empresas ORDER BY id');
const porId = new Map<number, any>(empresas.map((e: any) => [e.id, conCamposDerivados(e)]));
const porDefecto = porId.get(empresas[0]?.id);

const [docs]: any = await pool.query(
  `SELECT d.id, d.licitacion_codigo, d.documento_nombre, d.documento_url_local,
          (SELECT n.empresa_id FROM negocios n WHERE n.licitacion_codigo = d.licitacion_codigo AND n.activo = TRUE LIMIT 1) AS empresa_id,
          (SELECT MAX(a.licitacion_cierre) FROM alertas_licitaciones a
            WHERE a.licitacion_codigo = CONVERT(d.licitacion_codigo USING utf8) COLLATE utf8_unicode_ci) AS cierre
     FROM documentos_cache d
    WHERE (d.documento_nombre LIKE '%.docx' OR d.documento_nombre LIKE '%.doc')
      AND d.categoria <> 'DOCUMENTOS_PROPIOS'
    ORDER BY d.id DESC LIMIT ?`, [limite]);

const ahora = Date.now();
const hallazgos: any[] = [];
let revisados = 0, saltados = 0;

for (const d of docs) {
  if (!todas && !(d.cierre && new Date(d.cierre).getTime() > ahora)) { saltados++; continue; }
  const empresa = porId.get(d.empresa_id) ?? porDefecto;
  try {
    let buf: Buffer = Buffer.from(await (await fetch(d.documento_url_local)).arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buf = Buffer.from(await convertirDocADocx(buf));
    const { xml: crudo } = await abrirDocx(buf);
    const { xml } = normalizarParaIds(crudo);
    const partes = await dividirPorFormularios(buf, xml);
    const anexos: any[] = partes.length >= 2 ? partes : [{ nombreArchivo: d.documento_nombre, buffer: buf }];
    for (const f of anexos) {
      const a: any = await analizarAnexoParaUI(f.buffer, empresa);
      revisados++;
      const c = a.cobertura;
      if (c.severidad === 'ok') continue;
      hallazgos.push({
        severidad: c.severidad, codigo: d.licitacion_codigo, documento: String(f.nombreArchivo),
        cierre: d.cierre, motivo: c.motivo, senales: c.senales,
        detectadas: c.casillasDetectadas, resueltas: c.casillasResueltas,
      });
    }
  } catch (e: any) {
    hallazgos.push({ severidad: 'error', codigo: d.licitacion_codigo, documento: d.documento_nombre, motivo: String(e?.message || e).slice(0, 140) });
  }
}

// Los CIEGOS primero: son los que delatan un formato nuevo, y arreglarlos sirve para todas las
// licitaciones que lo usen. Dentro de cada grupo, primero lo que cierra antes.
const peso: Record<string, number> = { ciego: 0, revisar: 1, error: 2 };
hallazgos.sort((a, b) => (peso[a.severidad] - peso[b.severidad])
  || (new Date(a.cierre || 0).getTime() - new Date(b.cierre || 0).getTime()));

console.log(`\n${revisados} anexo(s) revisados · ${saltados} documento(s) de licitaciones ya cerradas omitidos${todas ? ' (ninguno: --todas)' : ''}\n`);
if (!hallazgos.length) {
  console.log('✅ Ningún documento quedó sin entender. Nada que arreglar.');
} else {
  for (const h of hallazgos) {
    const marca = h.severidad === 'ciego' ? '🔴 CIEGO  ' : h.severidad === 'revisar' ? '🟡 REVISAR' : '⚠️  ERROR  ';
    const cierra = h.cierre ? ` · cierra ${String(new Date(h.cierre).toISOString()).slice(0, 10)}` : '';
    console.log(`${marca} ${h.codigo}${cierra}\n           ${String(h.documento).slice(0, 70)}\n           ${h.motivo}\n`);
  }
  const ciegos = hallazgos.filter(h => h.severidad === 'ciego').length;
  console.log(`=== ${ciegos} ciego(s) · ${hallazgos.filter(h => h.severidad === 'revisar').length} a revisar · ${hallazgos.filter(h => h.severidad === 'error').length} error(es)`);
  if (ciegos) console.log('Los CIEGOS son formatos que no reconocemos: arreglar uno sirve para todas las licitaciones que lo usen.');
}
if (salidaJson) { writeFileSync(salidaJson, JSON.stringify(hallazgos, null, 2)); console.log(`\n→ ${salidaJson}`); }
await pool.end();

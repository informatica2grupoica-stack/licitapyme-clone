// Sana los documentos cuyo texto cacheado quedó con páginas sin OCR (marca OCR_NO_DISPONIBLE).
//
// POR QUÉ EXISTE (18-ago-2026): una página que no se leyó NO es una página vacía, pero para todo
// lo que consume el texto (viabilidad, checklist del auditor, chat, anexos) es indistinguible de
// una que no dice nada. Peor: la IA rellena el vacío con datos plausibles. Caso real 2296-48-LE26,
// 5 páginas sin leer → el informe inventó una "garantía de fiel cumplimiento" citando un numeral
// que en realidad es de multas, y un presupuesto por línea que las bases nunca fijaron.
//
// El respaldo local (Tesseract) YA existe en el flujo normal (document-extraction.ts), pero los
// documentos procesados ANTES de que ese respaldo existiera quedaron con el hueco pegado en caché.
// Este script los recupera sin volver a llamar a Z.AI: baja el PDF, manda SOLO las páginas huecas
// a Tesseract local (sin red, sin cuota, sin rate-limit) y reescribe el texto cacheado.
//
//   npx tsx scripts/sanar-ocr-huecos.mts                 → LISTA lo que haría, no escribe nada
//   npx tsx scripts/sanar-ocr-huecos.mts --aplicar       → escribe el texto sanado
//   npx tsx scripts/sanar-ocr-huecos.mts --codigo 2296-48-LE26 --aplicar
//   npx tsx scripts/sanar-ocr-huecos.mts --limite 10 --aplicar
//
// Es idempotente: un documento ya sano no trae la marca y no entra en la consulta.
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { paginasConHueco, rellenarHuecos, ocrTieneHuecos } = await import('@/app/lib/zai-ocr');
const { ocrPaginasLocalTesseract } = await import('@/app/lib/tesseract-ocr');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const aplicar = process.argv.includes('--aplicar');
const soloCodigo = arg('codigo');
const limite = Number(arg('limite')) || 200;

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// `--abiertas`: solo las licitaciones que TODAVÍA no cierran. Sanar una licitación que ya cerró no
// cambia nada (la oferta se presentó o se perdió) y cuesta ~30 s de CPU por documento; sanar una
// que sigue viva evita ofertar sobre un informe hecho con texto incompleto — que es exactamente lo
// que en 2296-48-LE26 produjo garantías inventadas y una alerta falsa de presupuesto. Medido
// 18-ago-2026: de 40 licitaciones con huecos, 23 ya habían cerrado y 16 seguían abiertas.
const soloAbiertas = process.argv.includes('--abiertas');
const [docs]: any = await pool.query(
  `SELECT d.id, d.licitacion_codigo, d.documento_nombre, d.documento_url_local, d.texto_extraido, d.metodo_extraccion
     FROM documentos_cache d
    WHERE d.texto_extraido LIKE '%OCR_NO_DISPONIBLE%'
      ${soloCodigo ? 'AND d.licitacion_codigo = ?' : ''}
      ${soloAbiertas ? `AND (SELECT MAX(a.licitacion_cierre) FROM alertas_licitaciones a
                              WHERE a.licitacion_codigo = CONVERT(d.licitacion_codigo USING utf8) COLLATE utf8_unicode_ci) > NOW()` : ''}
    ORDER BY d.id DESC LIMIT ?`,
  soloCodigo ? [soloCodigo, limite] : [limite],
);

console.log(`${docs.length} documento(s) con páginas sin OCR${aplicar ? '' : '  — MODO PRUEBA, no se escribe nada (usa --aplicar)'}\n`);

let sanados = 0, parciales = 0, fallidos = 0, paginasRecuperadas = 0;
for (const d of docs) {
  const faltantes = paginasConHueco(d.texto_extraido);
  if (!faltantes.length) continue;
  const etiqueta = `${d.licitacion_codigo} · ${String(d.documento_nombre).slice(0, 46)}`;
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const recuperadas = await ocrPaginasLocalTesseract(buffer, faltantes);
    if (!recuperadas.size) { fallidos++; console.log(`  ✖ ${etiqueta} — Tesseract no recuperó ninguna de ${faltantes.length}`); continue; }

    const textoNuevo = rellenarHuecos(d.texto_extraido, recuperadas);
    const quedanHuecos = ocrTieneHuecos(textoNuevo);
    paginasRecuperadas += recuperadas.size;
    if (quedanHuecos) parciales++; else sanados++;
    const marca = quedanHuecos ? '◐' : '✔';
    console.log(`  ${marca} ${etiqueta} — ${recuperadas.size}/${faltantes.length} pág(s) recuperadas${quedanHuecos ? ' (quedan huecos)' : ''}`);

    if (aplicar) {
      // `metodo_extraccion` refleja lo que REALMENTE se usó: los consumidores lo miran para
      // decidir si el texto es confiable (ver cargarDocumentoBaseParaSeparar, que rechaza
      // convertir un PDF que no sea 'pdf-text'). Un documento que sigue con huecos conserva el
      // método '-incompleto' para que se vuelva a intentar; uno sano pasa a '+tesseract-relleno'.
      await pool.query(
        `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ? WHERE id = ?`,
        [textoNuevo, quedanHuecos ? 'pdf-glm-ocr-incompleto' : 'pdf-glm-ocr+tesseract-relleno', d.id],
      );
    }
  } catch (e: any) {
    fallidos++;
    console.log(`  ✖ ${etiqueta} — ${String(e?.message || e).slice(0, 110)}`);
  }
}

console.log(`\n=== ${sanados} sano(s) · ${parciales} parcial(es) · ${fallidos} fallido(s) · ${paginasRecuperadas} páginas recuperadas`);
if (!aplicar) console.log('(modo prueba: no se escribió nada — repite con --aplicar)');
else console.log('OJO: las licitaciones sanadas conviene RE-ANALIZARLAS, su informe se generó con el texto incompleto.');
await pool.end();

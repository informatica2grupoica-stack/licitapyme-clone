// scripts/sanar-lectura-documentos.mts
// SANEADOR DE LECTURA — lee los documentos que ya están descargados y quedaron sin texto.
//
// Por qué existe (26-ago-2026): la auditoría encontró 1.889 documentos en formato legible sin
// texto extraído, en 375 licitaciones que igual entregaron informe. Al probar el lector sobre una
// muestra, 9 de cada 10 se leyeron sin problema en menos de 3 segundos — nunca estuvieron rotos,
// solo nadie los volvió a mirar.
//
// ESTO NO ES UN RE-ANÁLISIS. Solo extrae texto y lo guarda. No llama al modelo de viabilidad, así
// que no gasta IA de análisis: deja el texto listo para que el PRÓXIMO análisis lo encuentre en
// caché. Word, Excel y PDF con capa de texto se leen 100% en local y son gratis; solo los PDF
// escaneados necesitan OCR (eso sí consume cuota), y por eso van en una pasada aparte.
//
// Se corre desde el equipo de desarrollo: la base (Bluehost) y los archivos (R2) son remotos, así
// que no hace falta estar en el VPS — que además no tiene Node en el shell del host.
//
//   medir sin tocar nada:        npx tsx scripts/sanar-lectura-documentos.mts
//   sanar solo lo GRATIS:        npx tsx scripts/sanar-lectura-documentos.mts --aplicar
//   incluir escaneados (OCR):    npx tsx scripts/sanar-lectura-documentos.mts --aplicar --con-ocr
//   incluir el radar completo:   --todas      (~13.500 docs; por defecto solo informe/negocio)
//   limitar el lote:             --limite=200
import { readFileSync, existsSync } from 'node:fs';
// El entorno de desarrollo usa .env.local y el despliegue en el VPS usa .env (docker-compose).
// Se leen los dos: el primero que exista manda, y si ya vienen del entorno (contenedor) no se pisan.
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const l of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}
if (!process.env.DB_HOST) {
  console.error('Falta la configuración de base de datos: no encontré DB_HOST en el entorno, ni en .env.local ni en .env.');
  process.exit(1);
}
const APLICAR = process.argv.includes('--aplicar');
const CON_OCR = process.argv.includes('--con-ocr');
const LIMITE = Number(process.argv.find(a => a.startsWith('--limite='))?.split('=')[1] || 0);

const mysql = (await import('mysql2/promise')).default;
const { descargarYExtraerTexto } = await import('../app/lib/document-extraction.js');
const { esFormatoLegible, esDocumentoCritico } = await import('../app/lib/lectura-documentos.js');
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 30000,
  connectionLimit: 2,   // script de mantenimiento: no compite con la app por conexiones
});

// ALCANCE. Por defecto solo las licitaciones que IMPORTAN: las que ya tienen informe de
// viabilidad o un negocio abierto. Sanear el radar entero son ~13.500 documentos (≈2,6 h de
// descarga) y la mayoría son de licitaciones excluidas por el prefiltro que nunca se van a
// analizar: trabajo y ancho de banda tirados. Con --todas se procesan igual.
const TODAS = process.argv.includes('--todas');
const filtroAlcance = TODAS ? '' : `
    AND (EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo = d.licitacion_codigo)
      OR EXISTS (SELECT 1 FROM negocios n WHERE n.licitacion_codigo = d.licitacion_codigo))`;

const [rows]: any = await pool.query(`
  SELECT d.licitacion_codigo, d.documento_nombre, d.documento_url_local, d.categoria, d.size_bytes
  FROM documentos_cache d
  WHERE (d.texto_extraido IS NULL OR CHAR_LENGTH(d.texto_extraido) < 50)
    AND COALESCE(d.categoria,'') <> 'DOCUMENTOS_PROPIOS'
    AND d.documento_url_local IS NOT NULL AND d.documento_url_local <> ''
    ${filtroAlcance}
  ORDER BY d.licitacion_codigo`);

// Solo lo que DEBERÍA poder leerse; los críticos primero (son los que invalidan un informe).
const pend = rows
  .filter((r: any) => esFormatoLegible(r.documento_nombre))
  .map((r: any) => ({ ...r, critico: esDocumentoCritico(r.categoria, r.documento_nombre) }))
  .sort((a: any, b: any) => Number(b.critico) - Number(a.critico));
const lote = LIMITE ? pend.slice(0, LIMITE) : pend;

console.log(`\ndocumentos legibles sin texto: ${pend.length} (${pend.filter((p: any) => p.critico).length} críticos)`);
console.log(`alcance: ${TODAS ? 'TODAS las licitaciones del radar' : 'licitaciones con informe o negocio abierto (usa --todas para el radar completo)'}`);
console.log(`modo: ${APLICAR ? 'APLICAR' : 'MEDICIÓN (no escribe)'} · OCR de escaneados: ${CON_OCR ? 'SÍ (consume cuota)' : 'NO (solo lo gratis)'}`);
console.log(`tiempo estimado: ~${Math.max(1, Math.round((LIMITE || pend.length) * 0.7 / 60))} min`);
console.log(`a procesar en esta corrida: ${lote.length}\n`);

let ok = 0, fallo = 0, saltados = 0;
const porMetodo: Record<string, number> = {};
const irrecuperables: any[] = [];
const t0 = Date.now();

for (let i = 0; i < lote.length; i++) {
  const d = lote[i];
  // omitirOCR = true evita gastar cuota: un PDF escaneado devuelve poco texto y se salta.
  const r = await descargarYExtraerTexto(d.documento_url_local, d.documento_nombre, { omitirOCR: !CON_OCR })
    .catch(() => null);
  const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
  const metodo = r?.metodo || 'error';
  porMetodo[metodo] = (porMetodo[metodo] || 0) + 1;

  if (texto.length >= 50) {
    ok++;
    if (APLICAR) {
      await pool.query(
        `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
         WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [texto, metodo, d.licitacion_codigo, d.documento_nombre]).catch(() => {});
    }
  } else if (!CON_OCR && metodo === 'pdf-sin-ocr') {
    saltados++;   // escaneado: recuperable, pero necesita la pasada con OCR
  } else {
    fallo++;
    if (irrecuperables.length < 15) irrecuperables.push({ ...d, metodo });
    // Deja constancia del intento fallido: sin esto vuelve a quedar indistinguible de
    // "nunca se intentó", que es justo como se acumuló este agujero.
    if (APLICAR) {
      await pool.query(
        `UPDATE documentos_cache SET metodo_extraccion = ?, texto_extraido_at = NOW()
         WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [metodo, d.licitacion_codigo, d.documento_nombre]).catch(() => {});
    }
  }
  if ((i + 1) % 25 === 0 || i === lote.length - 1) {
    const seg = (Date.now() - t0) / 1000;
    console.log(`  ${i + 1}/${lote.length} · leídos ${ok} · escaneados pendientes ${saltados} · sin recuperar ${fallo} · ${seg.toFixed(0)}s (${(seg / (i + 1)).toFixed(1)}s c/u)`);
  }
}

console.log(`\n── RESULTADO ${APLICAR ? '(aplicado)' : '(medición)'}`);
console.log(`   recuperados:            ${ok}`);
console.log(`   escaneados (piden OCR): ${saltados}${saltados && !CON_OCR ? '  → volver a correr con --con-ocr' : ''}`);
console.log(`   sin recuperar:          ${fallo}`);
console.log(`\n── por método`);
for (const [m, n] of Object.entries(porMetodo).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${m}`);
if (irrecuperables.length) {
  console.log(`\n── muestra de los que no se pudieron leer`);
  for (const x of irrecuperables) console.log(`   [${x.metodo}] ${x.licitacion_codigo} · ${String(x.documento_nombre).slice(0, 60)}`);
}
await pool.end();

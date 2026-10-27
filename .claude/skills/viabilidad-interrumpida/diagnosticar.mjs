// Diagnóstico de SOLO LECTURA de un análisis de viabilidad que se cortó.
// Uso: npx tsx .claude/skills/viabilidad-interrumpida/diagnosticar.mjs <codigo>
// Necesita el túnel a la BD del VPS (puerto 3307, ver docs/memoria/infra.md). No escribe nada.
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
}
const codigo = process.argv[2];
if (!codigo) { console.error('Uso: diagnosticar.mjs <codigo>'); process.exit(1); }

const z = await import('../../../app/lib/zai-ocr.ts');
const mysql = (await import('mysql2/promise')).default;
const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306) });

const [[bd]] = await c.query('SELECT @@hostname h');
console.log(`BD: ${bd.h} (el VPS responde con el id del contenedor Docker)\n`);

const [[job]] = await c.query(
  // Las columnas están en UTC; se formatean en SQL porque mysql2 las corre de hora al leerlas.
  // Así se comparan directo con el StartedAt (UTC) de `docker inspect`.
  `SELECT estado, fase, error, run_id,
          DATE_FORMAT(iniciado_at, '%Y-%m-%d %H:%i:%s') inicio_utc,
          DATE_FORMAT(actualizado_at, '%H:%i:%s') ultimo_utc,
          TIMESTAMPDIFF(SECOND, iniciado_at, actualizado_at) dur_seg,
          TIMESTAMPDIFF(SECOND, actualizado_at, UTC_TIMESTAMP()) edad_seg
     FROM viabilidad_jobs WHERE licitacion_codigo = ?`, [codigo]);
console.log('── Job (viabilidad_jobs)');
console.log(job
  ? `estado=${job.estado} · fase=${job.fase} · empezó ${job.inicio_utc} UTC · última escritura ${job.ultimo_utc} UTC · corrió ${job.dur_seg}s\nerror: ${job.error || '—'}`
  : 'sin fila: terminó bien (se borra al terminar) o nunca corrió');

const [intentos] = await c.query(
  `SELECT created_at, usuario_id, descripcion FROM actividad_usuario
    WHERE entidad_id = ? AND accion = 'viabilidad' ORDER BY id DESC LIMIT 6`, [codigo]);
console.log('\n── Últimos intentos (actividad_usuario)');
for (const a of intentos) console.log(`${a.created_at.toISOString()} · usuario ${a.usuario_id} · ${a.descripcion}`);

const [docs] = await c.query(
  `SELECT documento_nombre n, categoria, size_bytes, metodo_extraccion m, texto_extraido t, texto_extraido_at
     FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`, [codigo]);
console.log('\n── Documentos, en el orden en que los lee el análisis (de a 2)');
for (const [i, d] of docs.entries()) {
  const t = (d.t || '').trim();
  const real = t.replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, '').trim().length;
  // Misma regla que cargarDocumentos() en app/lib/viabilidad-ia.ts: ¿se reusa el caché o se vuelve a leer?
  const motivos = [];
  if (real < 50) motivos.push('sin texto en caché');
  if (z.ocrTieneHuecos(t)) motivos.push('marca de hueco OCR');
  if (t && z.esTextoBasuraOCR(t)) motivos.push('texto basura');
  if (z.leidoConOcrLocal(d.m)) motivos.push('leído con Tesseract');
  if (d.m !== 'pdf-glm-ocr' && z.numeracionTablaIncompleta(t)) motivos.push('numeración de tabla incompleta');
  const mb = ((d.size_bytes || 0) / 1e6).toFixed(1);
  console.log(`${String(i + 1).padStart(2)}. ${d.n} · ${mb} MB · método=${d.m ?? 'NULL'} · ${t.length} chars`
    + (motivos.length ? `\n    → SE VUELVE A LEER: ${motivos.join(', ')}` : '\n    → caché'));
}
await c.end();

console.log(`
── Cómo leerlo (detalle en SKILL.md)
· fase=leyendo_documentos y algún «SE VUELVE A LEER» en un PDF grande → la lectura de ese PDF es lo que se cortó.
  Si se repite en cada intento, es un bucle de re-lectura: corregir la regla que lo marca, no reintentar.
· fase=analizando_ia o verificando → mirar los logs del contenedor (cadena de modelos, timeouts, memoria).
· Para saber si fue un despliegue o una caída por memoria, ver los logs del VPS (comando en SKILL.md).`);

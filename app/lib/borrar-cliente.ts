// app/lib/borrar-cliente.ts
// BAJA DE UNA EMPRESA-CLIENTE (multiempresa, Etapa 4 — Ley 21.719, rige desde el 2026-12-01; docs/memoria/multiempresa.md).
// Cuando una empresa deja LICITANK, el superusuario puede:
//   · planBorrado()      → vista previa: qué tablas y cuántas filas se borran / anonimizan / conservan (no cambia nada).
//   · exportarCliente()  → todos sus datos en un JSON (portabilidad), sin secretos (claves, credenciales cifradas).
//   · borrarCliente()    → borra todo en UNA transacción (si algo falla, no se borra nada).
//
// Las tablas se DESCUBREN en la BD (information_schema), así una tabla nueva con cliente_id / negocio_id queda incluida sola:
//   1. tablas con negocio_id → filas de los negocios de la empresa;
//   2. tablas con empresa_id (sin cliente_id) → filas de sus razones sociales;
//   3. tablas con usuario_id (sin cliente_id ni negocio_id) → filas de sus usuarios;
//   4. tablas con cliente_id → sus filas.
// Excepciones: `ia_uso` se anonimiza (se conserva el costo, sin nombre ni usuario); `mp_api_uso_cliente` se conserva (solo
// conteos); `clientes` queda como ficha de baja sin datos de contacto; `clientes_bitacora` se reemplaza por una sola línea del borrado.
// Grupo ICA (1) nunca. La empresa tiene que estar SUSPENDIDA o de BAJA antes de borrar.
// Archivos en R2 (logos, firmas, documentos, cotizaciones…): las keys van por código de licitación, no por empresa, así que un
// archivo podría estar referenciado por otra empresa. Se juntan las URLs de R2 que aparecen en CUALQUIER texto de sus filas
// (también JSON) y, DESPUÉS de borrar los datos, se borra de R2 solo lo que ya no aparece en ninguna columna de archivos de la BD.
// Si falla un archivo no se deshace nada: queda contado como «fallido» en la bitácora.
import pool from '@/app/lib/db';
import { borrarDocumentoR2 } from '@/app/lib/r2';

const CLIENTE_ICA = 1;
type Accion = 'borrar' | 'anonimizar' | 'conservar';
export interface PasoBorrado { tabla: string; accion: Accion; filas: number; where: string; params: unknown[] }

// Orden de borrado: lo que referencia a otra tabla va antes (FK alertas→palabras_clave→etiquetas, *→usuarios; hijos→negocios/empresas).
const AL_FINAL: Record<string, number> = { alertas_licitaciones: 1, documentos_cache: 1, analisis_cache: 1, palabras_clave: 2, etiquetas: 3, negocios: 4, empresas: 5, usuarios: 9 };
const ESPECIALES = new Set(['clientes', 'clientes_bitacora', 'ia_uso', 'mp_api_uso_cliente', 'reportes_error_adjuntos']);
// Columnas que nunca salen en la exportación.
const NO_EXPORTAR: Record<string, string[]> = { usuarios: ['password_hash'], cliente_integracion: ['datos_cifrados'], password_resets: ['token', 'token_hash'] };

const lista = (ids: number[]) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');

async function ids(sql: string, p: unknown[]): Promise<number[]> {
  const [r] = await pool.query(sql, p) as any;
  return (r as any[]).map(x => Number(x.id));
}

/** Arma la lista de pasos (con conteos). No cambia nada. */
export async function planBorrado(clienteId: number): Promise<{ pasos: PasoBorrado[]; negocios: number; usuarios: number; empresas: number }> {
  if (!clienteId || clienteId === CLIENTE_ICA) throw new Error('Grupo ICA no se puede borrar');
  const [negIds, usrIds, empIds] = await Promise.all([
    ids('SELECT id FROM negocios WHERE cliente_id = ?', [clienteId]),
    ids('SELECT id FROM usuarios WHERE cliente_id = ?', [clienteId]),
    ids('SELECT id FROM empresas WHERE cliente_id = ?', [clienteId]),
  ]);
  const [cols] = await pool.query(
    `SELECT c.TABLE_NAME t, GROUP_CONCAT(c.COLUMN_NAME) cs FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME IN ('cliente_id','negocio_id','empresa_id','usuario_id')
      GROUP BY c.TABLE_NAME`) as any;

  const pasos: PasoBorrado[] = [];
  for (const { t, cs } of cols as { t: string; cs: string }[]) {
    if (ESPECIALES.has(t) || /_bkp$|_backup$|_respaldo$/.test(t)) continue;
    const c = new Set(cs.split(','));
    if (c.has('negocio_id') && t !== 'negocios') {
      // negocio_id manda: aunque tenga cliente_id, se borra lo de sus negocios (y lo suelto con su cliente_id, abajo).
      pasos.push({ tabla: t, accion: 'borrar', filas: 0, where: `negocio_id IN (${lista(negIds)})`, params: negIds });
      if (c.has('cliente_id')) pasos.push({ tabla: t, accion: 'borrar', filas: 0, where: 'cliente_id = ?', params: [clienteId] });
    } else if (c.has('cliente_id')) {
      pasos.push({ tabla: t, accion: 'borrar', filas: 0, where: 'cliente_id = ?', params: [clienteId] });
    } else if (c.has('empresa_id')) {
      pasos.push({ tabla: t, accion: 'borrar', filas: 0, where: `empresa_id IN (${lista(empIds)})`, params: empIds });
    } else if (c.has('usuario_id')) {
      pasos.push({ tabla: t, accion: 'borrar', filas: 0, where: `usuario_id IN (${lista(usrIds)})`, params: usrIds });
    }
  }
  pasos.sort((a, b) => (AL_FINAL[a.tabla] ?? 0) - (AL_FINAL[b.tabla] ?? 0));
  // Los adjuntos cuelgan del reporte (no tienen cliente_id): van antes que reportes_error.
  pasos.unshift({ tabla: 'reportes_error_adjuntos', accion: 'borrar', filas: 0, where: 'reporte_id IN (SELECT id FROM reportes_error WHERE cliente_id = ?)', params: [clienteId] });
  pasos.push({ tabla: 'ia_uso', accion: 'anonimizar', filas: 0, where: 'cliente_id = ?', params: [clienteId] });
  pasos.push({ tabla: 'mp_api_uso_cliente', accion: 'conservar', filas: 0, where: 'cliente_id = ?', params: [clienteId] });
  pasos.push({ tabla: 'clientes_bitacora', accion: 'borrar', filas: 0, where: 'cliente_id = ?', params: [clienteId] });

  for (const p of pasos) {
    try {
      const [[r]] = await pool.query(`SELECT COUNT(*) n FROM \`${p.tabla}\` WHERE ${p.where}`, p.params) as any;
      p.filas = Number(r?.n) || 0;
    } catch { p.filas = 0; } // tabla sin crear en este ambiente
  }
  return { pasos, negocios: negIds.length, usuarios: usrIds.length, empresas: empIds.length };
}

/** Todos los datos de la empresa en un objeto { tabla: filas[] } (portabilidad). Sin claves ni credenciales. */
export async function exportarCliente(clienteId: number): Promise<Record<string, unknown>> {
  const { pasos } = await planBorrado(clienteId);
  const salida: Record<string, unknown> = {};
  const [[ficha]] = await pool.query('SELECT id, nombre, rut, plan, estado, created_at FROM clientes WHERE id = ?', [clienteId]) as any;
  salida._empresa = ficha ?? null;
  salida._exportado_at = new Date().toISOString();
  for (const p of pasos) {
    if (p.filas === 0 && p.tabla !== 'clientes_bitacora') continue;
    const [filas] = await pool.query(`SELECT * FROM \`${p.tabla}\` WHERE ${p.where}`, p.params) as any;
    const fuera = NO_EXPORTAR[p.tabla] ?? [];
    salida[p.tabla] = (filas as Record<string, unknown>[]).map(f => { const o = { ...f }; for (const k of fuera) delete o[k]; return o; });
  }
  return salida;
}

// ── Archivos en R2 ──────────────────────────────────────────────────────────
const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function baseR2(): string {
  return (process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`).replace(/\/+$/, '');
}

/** URLs de R2 que aparecen en las filas que se van a borrar (en cualquier columna de texto, incluido JSON). */
export async function archivosDelCliente(pasos: PasoBorrado[]): Promise<string[]> {
  const re = new RegExp(`${escaparRegex(baseR2())}/[^\\s"'<>\\\\]+`, 'g');
  const urls = new Set<string>();
  for (const p of pasos) {
    if (p.accion !== 'borrar' || p.filas === 0) continue;
    const [filas] = await pool.query(`SELECT * FROM \`${p.tabla}\` WHERE ${p.where}`, p.params) as any;
    for (const f of filas as Record<string, unknown>[])
      for (const v of Object.values(f)) {
        const t = typeof v === 'string' ? v : v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : '';
        for (const m of t.match(re) ?? []) urls.add(m.replace(/[),.;]+$/, ''));
      }
  }
  return [...urls];
}

/** De estas URLs, las que TODAVÍA aparecen en alguna columna de archivos de la BD (otra empresa u otra fila las usa). */
async function urlsEnUso(urls: string[]): Promise<Set<string>> {
  const enUso = new Set<string>();
  if (!urls.length) return enUso;
  const [cols] = await pool.query(
    `SELECT c.TABLE_NAME t, c.COLUMN_NAME c, c.DATA_TYPE d FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.DATA_TYPE IN ('varchar','text','mediumtext','longtext','json')
        AND (c.COLUMN_NAME LIKE '%url%' OR c.COLUMN_NAME LIKE '%archivo%' OR c.COLUMN_NAME LIKE '%adjunto%' OR c.COLUMN_NAME LIKE '%link%')`) as any;
  for (let i = 0; i < urls.length; i += 50) {
    const lote = urls.slice(i, i + 50);
    for (const { t, c, d } of cols as { t: string; c: string; d: string }[]) {
      // varchar: igualdad; text/json: la URL puede venir dentro de una lista → LIKE.
      const [r] = d === 'varchar'
        ? await pool.query(`SELECT DISTINCT \`${c}\` u FROM \`${t}\` WHERE \`${c}\` IN (${lote.map(() => '?').join(',')})`, lote) as any
        : await pool.query(`SELECT \`${c}\` u FROM \`${t}\` WHERE ${lote.map(() => `\`${c}\` LIKE ?`).join(' OR ')} LIMIT 500`, lote.map(u => `%${u}%`)) as any;
      for (const { u } of r as { u: unknown }[]) {
        const texto = typeof u === 'string' ? u : JSON.stringify(u ?? '');
        for (const x of lote) if (texto.includes(x)) enUso.add(x);
      }
    }
  }
  return enUso;
}

export type ResultadoArchivos = { encontrados: number; borrados: number; compartidos: number; fallidos: number };

/** Borra de R2 las URLs que ya nadie usa. Va DESPUÉS de borrar los datos. De a 5 en paralelo. */
async function borrarArchivos(urls: string[], borrar: (url: string) => Promise<void>): Promise<ResultadoArchivos> {
  const enUso = await urlsEnUso(urls);
  const libres = urls.filter(u => !enUso.has(u));
  let borrados = 0, fallidos = 0;
  for (let i = 0; i < libres.length; i += 5)
    await Promise.all(libres.slice(i, i + 5).map(u => borrar(u).then(() => { borrados++; }, () => { fallidos++; })));
  return { encontrados: urls.length, borrados, compartidos: enUso.size, fallidos };
}

/** Borra todo lo de la empresa en una transacción (y después sus archivos de R2 que nadie más usa). */
export async function borrarCliente(clienteId: number, actorId: number, borrarArchivo: (url: string) => Promise<void> = borrarDocumentoR2):
  Promise<{ hechos: { tabla: string; accion: Accion; filas: number }[]; archivos: ResultadoArchivos }> {
  if (!clienteId || clienteId === CLIENTE_ICA) throw new Error('Grupo ICA no se puede borrar');
  const [[c]] = await pool.query('SELECT estado FROM clientes WHERE id = ?', [clienteId]) as any;
  if (!c) throw new Error('Empresa no encontrada');
  if (c.estado === 'ACTIVO') throw new Error('Primero suspende la empresa; recién ahí se pueden borrar sus datos.');

  const { pasos } = await planBorrado(clienteId);
  const urls = await archivosDelCliente(pasos); // antes de borrar: después ya no se pueden leer
  const hechos: { tabla: string; accion: Accion; filas: number }[] = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of pasos) {
      if (p.accion === 'conservar') { hechos.push({ tabla: p.tabla, accion: p.accion, filas: p.filas }); continue; }
      const sql = p.accion === 'anonimizar'
        ? `UPDATE \`${p.tabla}\` SET usuario_id = NULL, usuario_nombre = NULL WHERE ${p.where}`
        : `DELETE FROM \`${p.tabla}\` WHERE ${p.where}`;
      const [r] = await conn.query(sql, p.params) as any;
      hechos.push({ tabla: p.tabla, accion: p.accion, filas: Number(r?.affectedRows) || 0 });
    }
    await conn.query(
      `UPDATE clientes SET estado = 'BAJA', activo = FALSE, rut = NULL, contacto_nombre = NULL, contacto_email = NULL,
              notas = CONCAT('Datos borrados el ', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i')) WHERE id = ?`, [clienteId]);
    const resumen = hechos.filter(h => h.filas > 0).map(h => `${h.tabla}:${h.accion === 'borrar' ? '' : h.accion + ':'}${h.filas}`);
    await conn.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
      [clienteId, actorId, 'borrado', JSON.stringify({ tablas: resumen })]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  // Archivos: después del commit (si la BD falló, no se toca R2). Best-effort.
  const archivos = await borrarArchivos(urls, borrarArchivo);
  await pool.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
    [clienteId, actorId, 'borrado_archivos', JSON.stringify(archivos)]).catch(() => {});
  return { hechos, archivos };
}

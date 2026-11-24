// app/lib/compras-entrega-archivos.ts
// Escaneos firmados del cierre de entrega (pedido del dueño 18-nov-2026, 2446-240-LE26): el acta de entrega se genera formal en «Gestionar
// documentos», se imprime, la firma el cliente y el escaneo se carga en «Entrega y acta». Lo mismo con la guía de despacho firmada y el
// listado de asistentes a la capacitación. Acta y guía firmadas valen como la firma registrada a mano: cierran las mismas tareas y el ciclo.
// La tabla se crea sola (misma regla que compras_doc_generado) y el SQL queda en docs/migration-198-compras-entrega-archivo.sql.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { aplicarEscaneoFirmado, aplicarLecturaEntrega } from '@/app/lib/compras-entrega';
import { leerDocumentoEntrega } from '@/app/lib/compras-entrega-lectura';
import { borrarDocumentoR2 } from '@/app/lib/r2';

export type TipoEscaneoEntrega = 'acta' | 'guia' | 'capacitacion' | 'otro' | 'foto';
export const TIPOS_ESCANEO: TipoEscaneoEntrega[] = ['acta', 'guia', 'capacitacion', 'otro', 'foto'];
// Tipos que solo se guardan: no se leen ni cierran tareas del ciclo (foto = respaldo fotográfico de la entrega).
const SIN_LECTURA: TipoEscaneoEntrega[] = ['capacitacion', 'otro', 'foto'];

export interface EscaneoEntrega {
  id: number; tipo: TipoEscaneoEntrega; archivoUrl: string; archivoNombre: string; subidoPorNombre: string | null; creadoAt: string;
}

let tablaLista = false;
async function asegurarTabla() {
  if (tablaLista) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_entrega_archivo (
    id INT AUTO_INCREMENT PRIMARY KEY, negocio_id INT NOT NULL, tipo VARCHAR(20) NOT NULL, archivo_url VARCHAR(600) NOT NULL, archivo_nombre VARCHAR(255) NOT NULL,
    subido_por INT NULL, subido_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, KEY ix_negocio (negocio_id, tipo)
  ) DEFAULT CHARSET=utf8mb4`);
  tablaLista = true;
}

export async function listarEscaneosEntrega(negocioId: number): Promise<EscaneoEntrega[]> {
  await asegurarTabla();
  const [rows] = await pool.query(
    `SELECT id, tipo, archivo_url, archivo_nombre, subido_por_nombre, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
       FROM compras_entrega_archivo WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  return (rows as any[]).map(r => ({ id: r.id, tipo: r.tipo, archivoUrl: r.archivo_url, archivoNombre: r.archivo_nombre, subidoPorNombre: r.subido_por_nombre, creadoAt: r.created_at }));
}

const hayEscaneo = (l: EscaneoEntrega[], t: TipoEscaneoEntrega) => l.some(x => x.tipo === t);

export async function registrarEscaneoEntrega(negocioId: number, tipo: TipoEscaneoEntrega, archivo: { url: string; nombre: string; buffer?: Buffer }, actorId: number, actorNombre: string | null): Promise<string[]> {
  if (!TIPOS_ESCANEO.includes(tipo)) throw new Error('Tipo de documento inválido.');
  await asegurarTabla();
  await pool.query(
    `INSERT INTO compras_entrega_archivo (negocio_id, tipo, archivo_url, archivo_nombre, subido_por, subido_por_nombre, created_at) VALUES (?,?,?,?,?,?,?)`,
    [negocioId, tipo, archivo.url, archivo.nombre.slice(0, 255), actorId, actorNombre, ahoraChileSQL()]);
  if (SIN_LECTURA.includes(tipo)) return [];
  const lista = await listarEscaneosEntrega(negocioId);
  await aplicarEscaneoFirmado(negocioId, tipo as 'acta' | 'guia', false, { acta: hayEscaneo(lista, 'acta'), guia: hayEscaneo(lista, 'guia') }, actorId, actorNombre);
  return leerYLlenar(negocioId, tipo as 'acta' | 'guia', archivo.url, archivo.nombre, archivo.buffer);
}

/** Lee el escaneo y llena lo que falta. Si la lectura falla el archivo igual queda cargado (devuelve []). */
async function leerYLlenar(negocioId: number, tipo: 'acta' | 'guia', url: string, nombre: string, buffer?: Buffer): Promise<string[]> {
  try {
    const buf = buffer ?? Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
    const l = await leerDocumentoEntrega(url, nombre, buf);
    return l ? await aplicarLecturaEntrega(negocioId, tipo, l) : [];
  } catch (e) { console.warn('[compras-entrega-archivos] no se pudo leer el documento:', String(e).slice(0, 160)); return []; }
}

/** «Leer datos»: vuelve a leer un escaneo ya cargado (acta o guía) y llena lo que siga vacío. */
export async function releerEscaneoEntrega(negocioId: number, id: number): Promise<string[]> {
  await asegurarTabla();
  const [rows] = await pool.query('SELECT tipo, archivo_url, archivo_nombre FROM compras_entrega_archivo WHERE id = ? AND negocio_id = ? LIMIT 1', [id, negocioId]) as any;
  const r = (rows as any[])[0]; if (!r) throw new Error('Ese archivo no es de este negocio.');
  if (SIN_LECTURA.includes(r.tipo)) return [];
  return leerYLlenar(negocioId, r.tipo, r.archivo_url, r.archivo_nombre);
}

/** Quita un escaneo (solo del propio negocio) y lo borra de R2. Si era el que cerraba el ciclo, el ciclo se reabre. */
export async function quitarEscaneoEntrega(negocioId: number, id: number, actorId: number, actorNombre: string | null): Promise<void> {
  await asegurarTabla();
  const [rows] = await pool.query(`SELECT tipo, archivo_url FROM compras_entrega_archivo WHERE id = ? AND negocio_id = ? LIMIT 1`, [id, negocioId]) as any;
  const r = (rows as any[])[0]; if (!r) throw new Error('Ese archivo no es de este negocio.');
  await pool.query(`DELETE FROM compras_entrega_archivo WHERE id = ? AND negocio_id = ?`, [id, negocioId]);
  // El mismo archivo puede estar cargado dos veces: solo se borra de R2 si ya nadie más lo usa.
  const [otros] = await pool.query(`SELECT 1 FROM compras_entrega_archivo WHERE archivo_url = ? LIMIT 1`, [r.archivo_url]) as any;
  if (!(otros as any[]).length) await borrarDocumentoR2(r.archivo_url).catch(() => {});
  if (SIN_LECTURA.includes(r.tipo)) return;
  const lista = await listarEscaneosEntrega(negocioId);
  await aplicarEscaneoFirmado(negocioId, r.tipo, true, { acta: hayEscaneo(lista, 'acta'), guia: hayEscaneo(lista, 'guia') }, actorId, actorNombre);
}

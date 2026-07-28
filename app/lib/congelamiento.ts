// app/lib/congelamiento.ts
// CONGELAMIENTO Y TRASPASO A COMPRAS (Auditor Técnico, Fase 7, spec §12). Al postular, el
// Auditor se congela: queda como registro histórico inmutable (nunca se reescribe — INSERT
// IGNORE, la primera vez gana) y arma el paquete que alimentaría un futuro módulo de Compras
// (spec §12.2/12.3): producto validado, costeo, plazos comprometidos, matriz técnica aprobada,
// compromisos de postventa y contactos del cliente.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

export interface PaqueteTraspaso {
  productoValidado: Array<{ linea: number | null; titulo: string; caracteristicas: Array<{ descripcion: string; veredicto: string | null; fundamentoCita: string | null }> }>;
  costeo: { totalCostoNeto: number | null; totalPrecioNeto: number | null; archivoNombre: string | null; version: number | null } | null;
  plazosComprometidos: Array<{ titulo: string; valor: string | null }>;
  matrizTecnicaAprobada: { total: number; cumplen: number; noCumplen: number; conComplemento: number };
  compromisosPostventa: Array<{ titulo: string; descripcion: string | null }>;
  contactosCliente: {
    organismo: string | null; unidad: string | null; direccion: string | null;
    comuna: string | null; region: string | null; usuarioNombre: string | null; usuarioCargo: string | null;
  } | null;
}

export async function yaCongelado(negocioId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query(`SELECT 1 FROM checklist_comercial_congelamiento WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
    return (rows as any[]).length > 0;
  } catch { return false; }
}

export async function leerCongelamiento(negocioId: number): Promise<{ congeladoAt: string; congeladoPorNombre: string | null; paquete: PaqueteTraspaso } | null> {
  try {
    const [rows] = await pool.query(
      `SELECT congelado_at, congelado_por_nombre, paquete_traspaso FROM checklist_comercial_congelamiento WHERE negocio_id = ? LIMIT 1`,
      [negocioId],
    ) as any;
    const row = (rows as any[])[0];
    if (!row) return null;
    return { congeladoAt: row.congelado_at, congeladoPorNombre: row.congelado_por_nombre, paquete: JSON.parse(row.paquete_traspaso) };
  } catch { return null; }
}

// Capa técnico-administrativa (spec §5.12): el modelo actual no distingue estos ítems de otros
// TECNICO/ADMINISTRATIVO con una columna propia — se aproximan por título mientras esa
// distinción no exista como campo de primera clase.
const RE_POSTVENTA = /capacitaci|postventa|garant[ií]a|mantenimiento|despacho/i;

async function construirPaquete(negocioId: number, licitacionCodigo: string): Promise<PaqueteTraspaso> {
  const [items] = await pool.query(
    `SELECT id, bloque, tipo, titulo, valor_texto, valor_numero, linea_numero FROM checklist_comercial WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const filas = items as any[];

  const [caract] = await pool.query(
    `SELECT item_id, descripcion, veredicto, fundamento_cita FROM checklist_comercial_caracteristicas WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const caractPorItem = new Map<number, Array<{ descripcion: string; veredicto: string | null; fundamentoCita: string | null }>>();
  for (const c of caract as any[]) {
    const arr = caractPorItem.get(c.item_id) || [];
    arr.push({ descripcion: c.descripcion, veredicto: c.veredicto, fundamentoCita: c.fundamento_cita });
    caractPorItem.set(c.item_id, arr);
  }

  const lineasTecnicas = filas.filter(f => f.tipo === 'linea_tecnica');
  const productoValidado = lineasTecnicas.map(l => ({
    linea: l.linea_numero, titulo: l.titulo, caracteristicas: caractPorItem.get(l.id) || [],
  }));
  const todasCaract = lineasTecnicas.flatMap(l => caractPorItem.get(l.id) || []);
  const matrizTecnicaAprobada = {
    total: todasCaract.length,
    cumplen: todasCaract.filter(c => c.veredicto === 'CUMPLE').length,
    noCumplen: todasCaract.filter(c => c.veredicto === 'NO_CUMPLE').length,
    conComplemento: todasCaract.filter(c => c.veredicto === 'CUMPLE_CON_COMPLEMENTO').length,
  };

  const plazosComprometidos = filas
    .filter(f => f.bloque === 'COMERCIAL' && f.tipo === 'dato')
    .map(f => ({ titulo: f.titulo as string, valor: f.valor_texto as string | null }));

  const compromisosPostventa = filas
    .filter(f => (f.bloque === 'TECNICO' || f.bloque === 'ADMINISTRATIVO') && f.tipo !== 'linea_tecnica' && RE_POSTVENTA.test(f.titulo))
    .map(f => ({ titulo: f.titulo as string, descripcion: f.valor_texto as string | null }));

  let costeo: PaqueteTraspaso['costeo'] = null;
  try {
    const [rows] = await pool.query(
      `SELECT version, archivo_nombre, total_costo_neto, total_precio_neto
         FROM checklist_comercial_costeo WHERE negocio_id = ? AND vigente = 1 LIMIT 1`,
      [negocioId],
    ) as any;
    const r = (rows as any[])[0];
    if (r) costeo = { totalCostoNeto: r.total_costo_neto, totalPrecioNeto: r.total_precio_neto, archivoNombre: r.archivo_nombre, version: r.version };
  } catch { /* migración 53 pendiente */ }

  let contactosCliente: PaqueteTraspaso['contactosCliente'] = null;
  try {
    const lic = await getMercadoPublicoClient().obtenerPorCodigoRapido(licitacionCodigo, 8_000);
    const c = (lic as any)?.Comprador;
    if (c) {
      contactosCliente = {
        organismo: c.NombreOrganismo || null, unidad: c.NombreUnidad || null,
        direccion: c.DireccionUnidad || null, comuna: c.ComunaUnidad || null, region: c.RegionUnidad || null,
        usuarioNombre: c.NombreUsuario || null, usuarioCargo: c.CargoUsuario || null,
      };
    }
  } catch { /* la API de MP puede estar caída — no bloquea el congelamiento */ }

  return { productoValidado, costeo, plazosComprometidos, matrizTecnicaAprobada, compromisosPostventa, contactosCliente };
}

/**
 * Congela el Auditor al postular. Idempotente (INSERT IGNORE sobre PK negocio_id): si ya está
 * congelado, no hace nada — nunca se reescribe, es el registro histórico (spec §12.1).
 * Nunca lanza: un fallo acá no debe bloquear la postulación en sí.
 */
export async function congelarAuditorSiCorresponde(
  negocioId: number, licitacionCodigo: string, userId: number | null, userNombre: string,
): Promise<void> {
  if (await yaCongelado(negocioId)) return;
  try {
    const paquete = await construirPaquete(negocioId, licitacionCodigo);
    await pool.query(
      `INSERT IGNORE INTO checklist_comercial_congelamiento
         (negocio_id, congelado_at, congelado_por, congelado_por_nombre, paquete_traspaso)
       VALUES (?, ?, ?, ?, ?)`,
      [negocioId, ahoraChileSQL(), userId, userNombre, JSON.stringify(paquete)],
    );
  } catch (e) {
    console.error('[congelamiento] falló (no bloquea la postulación):', String(e));
  }
}

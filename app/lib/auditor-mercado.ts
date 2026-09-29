// app/lib/auditor-mercado.ts
// AUDITOR · VERIFICADOR DE COSTO, parte "de mercado" — datos (server-only). Los pasos del Prompt 5 que son del SISTEMA y no del modelo:
// S3 historial del proveedor en MercadoPública, S4 búsqueda de referencias del MISMO producto y S5 precios de mercado público.
// Reutiliza las fuentes que ya usa el Auditor de Compras (auditor-compras-datos.ts) sin tocarlas. Cada corrida queda guardada
// (auditor_verificacion_costo): el panel lee lo guardado, no vuelve a buscar en internet cada vez.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { tokensDeProducto } from '@/app/lib/auditor-compras-core';
import { buscarReferencias, historialProveedorMP, preciosMercadoPublico, esRutPropio } from '@/app/lib/auditor-compras-datos';
import { clasificarReferencias, tokensDeIdentidad, type ResultadoMercado } from '@/app/lib/auditor-mercado-core';

const hostDe = (url: string) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Busca referencias del MISMO producto, el historial del proveedor y los precios de mercado público de UNA opción y lo guarda. */
export async function verificarMercadoOpcion(params: { negocioId: number; opcionId: number; actor: { id: number } }): Promise<ResultadoMercado> {
  const { negocioId, opcionId, actor } = params;
  const [ors] = await pool.query(`SELECT * FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  const o = (ors as any[])[0];
  if (!o) throw new Error('La opción no existe en este negocio.');
  const [rs] = await pool.query(`SELECT url, documento_url FROM auditor_respaldo WHERE opcion_id = ? AND vigente = 1 ORDER BY id DESC`, [opcionId]) as any;
  const hostPropio = (rs as any[]).map(r => hostDe(r.url || '')).find(Boolean) || null;

  const marca = (o.marca || '').trim() || null, modelo = (o.modelo || '').trim() || null, sku = (o.sku_proveedor || '').trim() || null;
  const tokens = tokensDeIdentidad(marca, modelo, sku, tokensDeProducto(modelo, sku));
  const resultado: ResultadoMercado = { consulta: '', referencias: [], descartadas: [], competidor: null, mercadoPublico: null, error: null, creadoAt: ahoraChileSQL() };

  if (!modelo && !sku) {
    resultado.error = 'La opción no identifica modelo ni SKU: sin eso no se puede afirmar que una referencia sea el MISMO producto.';
  } else {
    resultado.consulta = [marca, modelo, sku].filter(Boolean).join(' ');
    const busq = await buscarReferencias(resultado.consulta);
    if (busq.error) resultado.error = busq.error;
    const { validas, descartadas } = clasificarReferencias(busq.candidatas, { marca, tokens }, hostPropio);
    resultado.referencias = validas; resultado.descartadas = descartadas;
    resultado.mercadoPublico = await preciosMercadoPublico(tokens).catch(() => null);
  }
  const rut = (o.proveedor_rut || '').trim();
  if (rut && !(await esRutPropio(rut))) {
    const h = await historialProveedorMP(rut).catch(() => null);
    if (h) resultado.competidor = { venteAlEstado: h.venteAlEstado, nLicitaciones: h.nLicitaciones, nOrdenesCompra: h.nOrdenesCompra, rubros: h.rubros, ejemplos: h.ejemplos.map(e => `${e.licitacion}: ${e.producto}`), limitacion: h.limitacion };
  }
  await pool.query(
    `INSERT INTO auditor_verificacion_costo (negocio_id, opcion_id, resultado_json, error, creado_por, creado_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [negocioId, opcionId, JSON.stringify(resultado), resultado.error, actor.id, resultado.creadoAt]);
  return resultado;
}

export async function ultimosMercados(negocioId: number): Promise<Map<number, ResultadoMercado>> {
  const [rows] = await pool.query(`SELECT opcion_id, resultado_json FROM auditor_verificacion_costo WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  const out = new Map<number, ResultadoMercado>();
  for (const r of rows as any[]) { try { out.set(r.opcion_id, JSON.parse(r.resultado_json)); } catch { /* fila con error */ } }
  return out;
}

/** Opciones cuya referencia más barata (≥ 5%) el asistente ya justificó (V10). */
export async function opcionesConJustificacion(negocioId: number): Promise<Set<number>> {
  const [rows] = await pool.query(`SELECT DISTINCT opcion_id FROM auditor_evento WHERE negocio_id = ? AND tipo = 'justificacion_ahorro'`, [negocioId]) as any;
  return new Set((rows as any[]).map(r => r.opcion_id));
}

export async function justificarAhorro(negocioId: number, opcionId: number, texto: string, actor: { nombre: string }): Promise<void> {
  if (texto.trim().length < 10) throw new Error('Escribe la justificación (por qué no se usó la referencia más barata: plazo, garantía, respaldo formal, confiabilidad…).');
  const [ors] = await pool.query(`SELECT id FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  if (!(ors as any[]).length) throw new Error('La opción no existe en este negocio.');
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'justificacion_ahorro', 'asistente', ?, ?)`,
    [negocioId, opcionId, `${actor.nombre}: ${texto.trim().slice(0, 700)}`, ahoraChileSQL()]);
}

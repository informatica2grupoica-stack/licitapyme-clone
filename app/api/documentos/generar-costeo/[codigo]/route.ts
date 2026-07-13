// app/api/documentos/generar-costeo/[codigo]/route.ts
// Genera el Excel de costeo para una licitación a partir de su informe de viabilidad IA.
// POST → genera el Excel, lo sube a R2 y lo registra en documentos_cache.
// GET  → verifica si ya existe uno generado.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { generarCosteoExcel, adaptarViabilidadACosteo } from '@/app/lib/generar-costeo';
import type { ViabilidadIAResult } from '@/app/lib/viabilidad-ia';
import { parsearPlanillaCosteo } from '@/app/lib/planilla-costeo-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ codigo: string }> };

const NOMBRE_DOC_PREFIX = 'COSTEO_';

async function leerInformeIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const ie = typeof row.informe_ejecutivo === 'string'
      ? JSON.parse(row.informe_ejecutivo)
      : row.informe_ejecutivo;
    // Prefiere el informe v3 (el ACTIVO); cae al v2 (_informe_ia) por compatibilidad.
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

// Refresca el manifiesto con el PARSER de planilla sobre los documentos YA CACHEADOS
// (sin Gemini). Recupera la DESCRIPCIÓN completa, cantidad y —clave— el NÚMERO DE LÍNEA
// real de cada ítem, para que "Regenerar" produzca el costeo por línea correcto aunque el
// informe guardado tenga los ítems con línea=1. Best-effort: si el parser no aplica, deja
// el manifiesto como está.
async function refrescarManifiestoDesdePlanilla(codigo: string, informe: ViabilidadIAResult): Promise<void> {
  let docs: Array<{ nombre: string; categoria: string | null; texto: string; metodo: string | null }> = [];
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
         FROM documentos_cache
        WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL`,
      [codigo],
    );
    docs = (rows as any[]).map(r => ({ nombre: r.nombre, categoria: r.categoria, texto: r.texto || '', metodo: r.metodo }));
  } catch { return; }

  const fuentes = docs.filter(d =>
    (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));
  const planilla = parsearPlanillaCosteo(fuentes);
  const actuales = Array.isArray(informe.manifiesto_productos) ? informe.manifiesto_productos.length : 0;
  // Sin planilla mejor que lo guardado: NO forzamos por_categoria (las categorías que hubiera
  // puesto la IA no parten el costeo).
  if (!planilla || planilla.items.length < Math.max(8, actuales)) { informe.estructura_costeo = null; return; }

  // Solo el parser (rubros A/B/C reales) habilita las pestañas por categoría.
  informe.estructura_costeo = planilla.estructura === 'por_categoria' ? 'por_categoria' : null;
  informe.manifiesto_productos = planilla.items.map(it => ({
    linea: it.linea || 1,
    categoria: it.categoria,
    descripcion: it.descripcion,
    modelo: '',
    cantidad: it.cantidad,
    unidad_medida: it.unidad,
    unidad_inferida: !it.unidad,
    presupuesto_linea: null,
    tipo: 'generico',
    ruta: '',
  }));
}

// GET — ¿ya existe un costeo generado para este código?
export async function GET(request: NextRequest, { params }: Params) {
  if (!(await getAuthedUser(request))) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const [rows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, created_at
     FROM documentos_cache
     WHERE licitacion_codigo = ? AND documento_nombre LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    [codigoDecoded, `${NOMBRE_DOC_PREFIX}%`],
  );
  const doc = (rows as any[])[0];
  return NextResponse.json({ existe: !!doc, doc: doc ?? null });
}

// POST — genera o regenera el Excel de costeo
export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  // 1) Leer el informe IA desde la DB
  const informeIA = await leerInformeIA(codigoDecoded);
  if (!informeIA) {
    return NextResponse.json(
      { error: 'No hay informe de viabilidad IA para esta licitación. Ejecuta el análisis IA primero.' },
      { status: 404 },
    );
  }

  // 2) Refrescar el manifiesto con el parser (docs cacheados, sin Gemini) → recupera la
  //    línea real de cada ítem; luego adaptar informe → datos de costeo.
  await refrescarManifiestoDesdePlanilla(codigoDecoded, informeIA);
  const datosCosteo = adaptarViabilidadACosteo(codigoDecoded, informeIA);

  const totalItems = datosCosteo.grupos.reduce((s, g) => s + g.items.length, 0);
  if (totalItems === 0) {
    return NextResponse.json(
      { error: 'El informe IA no contiene ítems/productos en el manifiesto. Verifica que el análisis haya leído las bases técnicas.' },
      { status: 422 },
    );
  }

  // 2b) PRECIOS DE MERCADO: cotiza cada ítem con el buscador (Serper + caché) y los inyecta.
  //     La búsqueda de productos NO corre en la viabilidad (para no gastar tokens de Serper de más);
  //     se dispara BAJO DEMANDA desde el botón "Productos a costeo" en Negocios, que llama a esta
  //     ruta con ?precios=1. También corre si el flag global COSTEO_PRECIOS_MERCADO=1 está activo.
  //     Disponible para cualquier perfil asignado. Si algo falla, se genera sin precios.
  const forzarPrecios = new URL(request.url).searchParams.get('precios') === '1';
  if ((forzarPrecios || process.env.COSTEO_PRECIOS_MERCADO === '1') && process.env.SERPER_API_KEY) {
    try {
      const { cotizarManifiesto } = await import('@/app/lib/buscador-precios');
      const manifiesto = Array.isArray(informeIA.manifiesto_productos) ? informeIA.manifiesto_productos : [];
      const region = (informeIA as any).meta?.region || '';
      const contexto = (informeIA as any).meta?.linea_negocio || '';
      console.log(`[costeo:regenerar] ${codigoDecoded}: cotizando ${manifiesto.length} ítems (región="${region}")…`);
      const t0 = Date.now();
      const precios = await cotizarManifiesto(manifiesto, { region, contexto });
      const hits = precios.filter(p => p.precio_neto != null).length;
      if (hits > 0) { (datosCosteo as any).precios = precios; }
      console.log(`[costeo:regenerar] ${codigoDecoded}: ${hits}/${precios.length} con precio en ${((Date.now()-t0)/1000).toFixed(1)}s`);
    } catch (e) {
      console.error(`[costeo:regenerar] ${codigoDecoded}: cotización falló (sigue sin precios):`, String(e).slice(0, 200));
    }
  }

  // 3) Generar Excel
  const buffer = await generarCosteoExcel(datosCosteo);

  // 4) Subir a R2
  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `${NOMBRE_DOC_PREFIX}${codigoDecoded}_${fecha}.xlsx`;
  const url = await subirDocumentoR2(codigoDecoded, nombreArchivo, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  // 5) Registrar en documentos_cache. Siempre DOCUMENTOS_PROPIOS: el costeo (con o sin precios
  //    de mercado) es visible para cualquier perfil asignado a la licitación.
  const categoriaDoc = 'DOCUMENTOS_PROPIOS';
  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes),
       categoria           = VALUES(categoria),
       updated_at          = CURRENT_TIMESTAMP`,
    [
      codigoDecoded,
      nombreArchivo,
      url,
      buffer.length,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      categoriaDoc,
      usuario.id,
    ],
  );

  // Bitácora: generó/regeneró el costeo (best-effort). Distingue con o sin precios de mercado.
  const { registrarActividad } = await import('@/app/lib/actividad');
  registrarActividad({
    usuarioId: usuario.id, accion: 'costeo',
    entidadTipo: 'licitacion', entidadId: codigoDecoded,
    descripcion: `Generó el costeo${forzarPrecios ? ' con precios de mercado' : ''} (${totalItems} ítems)`,
    metadata: { licitacion_codigo: codigoDecoded, con_precios: forzarPrecios, items: totalItems },
  });

  return NextResponse.json({
    success: true,
    url,
    nombre: nombreArchivo,
    modalidad: datosCosteo.modalidad,
    hojas: datosCosteo.grupos.length,
    items: totalItems,
  });
}

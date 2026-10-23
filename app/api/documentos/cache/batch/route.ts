// src/app/api/documentos/cache/batch/route.ts
// Versión BATCH de /api/documentos/cache/[codigo]: resuelve MUCHOS códigos en UNA sola
// consulta (evita el N+1 de disparar un fetch por cada tarjeta en Postuladas/listas).
// Body: { codigos: string[], categoria?: string }
// Respuesta: { success, docs: { [codigo]: fila[] } }
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, permisosDeUsuario } from '@/app/lib/api-auth';
import { CLIENTE_ICA, codigoAlmacenDocs } from '@/app/lib/tenant';

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u || !u.clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const clienteId = u.clienteId;

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const codigosRaw: unknown = body?.codigos;
  const categoria: string | undefined = typeof body?.categoria === 'string' ? body.categoria : undefined;

  // Sanea: únicos, no vacíos, límite razonable para no explotar el IN(...).
  const codigos = Array.from(new Set(
    Array.isArray(codigosRaw) ? codigosRaw.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : []
  )).slice(0, 500);

  if (codigos.length === 0) return NextResponse.json({ success: true, docs: {} });

  try {
    // Autorización: admin / ver_otros_negocios / usuario normal → ven todos los solicitados.
    // externo → SOLO los códigos asignados a él (mismo criterio que puedeVerLicitacion).
    let permitidos = codigos;
    if (u.rol !== 'admin') {
      const p = await permisosDeUsuario(u.id, u.rol);
      if (!p.ver_otros_negocios && u.rol === 'externo') {
        const [asig] = await pool.query(
          `SELECT DISTINCT licitacion_codigo FROM negocios
           WHERE asignado_a = ? AND activo = TRUE AND cliente_id = ? AND licitacion_codigo IN (?)`,
          [u.id, clienteId, codigos],
        ) as any[];
        const set = new Set((asig as any[]).map(r => r.licitacion_codigo));
        permitidos = codigos.filter(c => set.has(c));
      }
    }
    if (permitidos.length === 0) return NextResponse.json({ success: true, docs: {} });

    // Multi-cliente: oficiales compartidos (cliente_id 0) + los propios de la empresa, guardados bajo el código con prefijo (ver tenant.ts).
    // Grupo ICA queda igual que siempre: todo lo que está bajo el código a secas.
    const esICA = clienteId === CLIENTE_ICA;
    const propios = esICA ? [] : permitidos.map(c => codigoAlmacenDocs(clienteId, c));
    const filtroCod = esICA
      ? 'licitacion_codigo IN (?)'
      : '((licitacion_codigo IN (?) AND cliente_id = 0) OR licitacion_codigo IN (?))';
    const paramsCod: unknown[] = esICA ? [permitidos] : [permitidos, propios];
    let rows: any[];
    try {
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria, created_at
         FROM documentos_cache
         WHERE ${filtroCod}${categoria ? ' AND UPPER(categoria) = ?' : ''}
         ORDER BY created_at ASC`,
        categoria ? [...paramsCod, categoria.toUpperCase()] : paramsCod,
      ) as any[];
    } catch {
      // columna 'categoria' no existe aún — fallback sin ella (ignora el filtro de categoría)
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, created_at
         FROM documentos_cache
         WHERE ${filtroCod}
         ORDER BY created_at ASC`,
        paramsCod,
      ) as any[];
    }

    // Agrupa por código.
    const docs: Record<string, any[]> = {};
    for (const c of permitidos) docs[c] = [];
    for (const row of rows as any[]) {
      // el código con prefijo de empresa vuelve a ser el código de la licitación para quien consulta
      const cod = String(row.licitacion_codigo).replace(/^c\d+:/, '');
      (docs[cod] ||= []).push({ ...row, licitacion_codigo: cod });
    }

    return NextResponse.json({ success: true, docs });
  } catch (error) {
    console.error('Error batch documentos/cache:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// app/api/reportes-error/route.ts
// POST — cualquier perfil logueado envía un reporte de error desde el botón flotante
// (app/components/ReportarErrorBoton.tsx): captura con marcas + observación detallada.
// Queda en `reportes_error` (migration-123) y se avisa por campana a TODOS los admin, que lo
// gestionan en /admin/errores (API: /api/admin/reportes-error).
// GET — los reportes PROPIOS del usuario, para /mis-reportes (ver cómo se resolvió cada uno).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { registrarEvento } from '@/app/lib/historial';
import { ahoraChileSQL } from '@/app/lib/tz';

const GRAVEDADES = ['bloqueante', 'alta', 'media', 'baja'];
// Mínimos de detalle: el pedido fue "tiene que ser detallado y demostrar el error". Mismos
// valores que valida el formulario, repetidos acá para que no se puedan saltar por API.
const MIN_QUE_PASO = 30;
const MIN_QUE_ESPERABA = 15;
const MAX_IMAGEN = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const [rows] = await pool.query(
      // La solución marcada "solo administradores" (migration-124) NUNCA sale de la BD hacia el
      // perfil: se filtra acá, no en la pantalla.
      `SELECT id, url, titulo, que_paso, que_esperaba, pasos, gravedad, imagen_url, estado,
              IF(solucion_visible = 1, solucion, NULL) AS solucion, (solucion_visible = 0 AND solucion IS NOT NULL) AS solucion_privada,
              resuelto_por_nombre, resuelto_at, created_at
       FROM reportes_error WHERE usuario_id = ? ORDER BY created_at DESC LIMIT 200`,
      [u.id],
    );
    return NextResponse.json({ success: true, reportes: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const fd = await req.formData();
    const txt = (k: string) => String(fd.get(k) ?? '').trim();
    const titulo = txt('titulo').slice(0, 200);
    const quePaso = txt('que_paso');
    const queEsperaba = txt('que_esperaba');
    const pasos = txt('pasos') || null;
    const gravedad = GRAVEDADES.includes(txt('gravedad')) ? txt('gravedad') : 'media';
    const url = txt('url').slice(0, 1000);
    const imagen = fd.get('imagen');

    if (!titulo) return NextResponse.json({ error: 'Falta el título' }, { status: 400 });
    if (quePaso.length < MIN_QUE_PASO) return NextResponse.json({ error: `Describe qué pasó con al menos ${MIN_QUE_PASO} caracteres` }, { status: 400 });
    if (queEsperaba.length < MIN_QUE_ESPERABA) return NextResponse.json({ error: `Describe qué esperabas con al menos ${MIN_QUE_ESPERABA} caracteres` }, { status: 400 });
    if (!(imagen instanceof Blob) || imagen.size === 0) return NextResponse.json({ error: 'Falta la captura marcada' }, { status: 400 });
    if (imagen.size > MAX_IMAGEN) return NextResponse.json({ error: 'La captura pesa demasiado' }, { status: 400 });

    let contexto: unknown = null;
    try { contexto = JSON.parse(txt('contexto') || 'null'); } catch { /* contexto es opcional */ }

    const imagenUrl = await subirDocumentoR2(
      'reportes-error', `reporte_u${u.id}.jpg`, Buffer.from(await imagen.arrayBuffer()), 'image/jpeg',
    );

    const ahora = ahoraChileSQL();
    const [r] = await pool.query(
      `INSERT INTO reportes_error
         (usuario_id, usuario_nombre, usuario_email, url, titulo, que_paso, que_esperaba, pasos, gravedad,
          imagen_url, contexto, estado, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'abierto', ?, ?)`,
      [u.id, u.nombre, u.email, url, titulo, quePaso, queEsperaba, pasos, gravedad,
       imagenUrl, contexto ? JSON.stringify(contexto) : null, ahora, ahora],
    );
    const id = (r as any).insertId as number;

    // Aviso a todos los admin (hoy: el dueño y el asesor). Campana + tiempo real vía historial.
    const [admins] = await pool.query(`SELECT id, nombre FROM usuarios WHERE rol = 'admin' AND activo = TRUE`);
    const quien = u.nombre || u.email;
    for (const a of admins as { id: number; nombre: string | null }[]) {
      await registrarEvento({
        tipo: 'REPORTE_ERROR',
        usuarioId: a.id, usuarioNombre: a.nombre,
        actorId: u.id, actorNombre: quien,
        mensaje: `🐞 ${quien} reportó un error (${gravedad}): ${titulo}`,
        metadata: { reporteId: id, url },
      });
    }

    return NextResponse.json({ success: true, id });
  } catch (e) {
    console.error('[reportes-error] POST falló:', String(e));
    return NextResponse.json({ error: 'No se pudo guardar el reporte' }, { status: 500 });
  }
}

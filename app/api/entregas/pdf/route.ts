// app/api/entregas/pdf/route.ts
// Frente F.1 — descarga del resumen ejecutivo de un proyecto ganado en PDF (o en HTML imprimible).
//
// GET ?negocioId=123        → PDF A4.
// GET ?negocioId=123&html=1 → el mismo documento como HTML. No es un modo de depuración: si el
//   chromium del servidor no está disponible (pasa en algunos entornos), el usuario igual se lleva
//   el documento y lo imprime con Ctrl+P, en vez de quedarse sin nada.
//
// ACCESO: solo quien está en el circuito de entrega de ESE proyecto (tiene fila en entrega_acuse)
// o un admin. El resumen trae contactos de la entidad, costeo y multas — no es información para
// cualquiera que sepa adivinar un negocioId.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, esAdmin } from '@/app/lib/api-auth';
import { construirResumenEntregaHtml } from '@/app/lib/entrega-pdf';
import { generarInformePdf } from '@/app/lib/generar-informe';
import type { ResumenEjecutivo } from '@/app/lib/entrega-proyecto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const negocioId = Number(req.nextUrl.searchParams.get('negocioId'));
  if (!negocioId) return NextResponse.json({ error: 'Falta negocioId' }, { status: 400 });

  try {
    const [rows] = await pool.query(
      `SELECT e.resumen, e.licitacion_codigo,
              (SELECT COUNT(*) FROM entrega_acuse a WHERE a.negocio_id = e.negocio_id AND a.usuario_id = ?) AS en_circuito
         FROM entrega_proyecto e WHERE e.negocio_id = ? LIMIT 1`,
      [u.id, negocioId],
    ) as any;
    const fila = (rows as any[])[0];
    if (!fila) return NextResponse.json({ error: 'Esa entrega no existe' }, { status: 404 });

    if (!Number(fila.en_circuito) && !(await esAdmin(req))) {
      return NextResponse.json({ error: 'No estás en el circuito de entrega de este proyecto' }, { status: 403 });
    }

    const resumen: ResumenEjecutivo = typeof fila.resumen === 'string' ? JSON.parse(fila.resumen) : fila.resumen;
    const html = construirResumenEntregaHtml(resumen, u.nombre || u.email);
    const nombre = `Entrega_${String(fila.licitacion_codigo || negocioId).replace(/[^\w.-]/g, '_')}`;

    if (req.nextUrl.searchParams.get('html') === '1') {
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="${nombre}.html"` },
      });
    }

    const pdf = await generarInformePdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}.pdf"`,
        'Content-Length': String(pdf.length),
      },
    });
  } catch (e: any) {
    // Un fallo de chromium NO debe leerse como "el proyecto no tiene resumen": se dice qué pasó
    // y se ofrece la salida en HTML, que no depende del navegador del servidor.
    console.error('[entregas/pdf]', String(e).slice(0, 300));
    return NextResponse.json({
      error: 'No se pudo generar el PDF en el servidor. Puedes abrir la versión imprimible en HTML.',
      alternativa: `/api/entregas/pdf?negocioId=${negocioId}&html=1`,
    }, { status: 500 });
  }
}

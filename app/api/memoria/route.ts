// app/api/memoria/route.ts
// Frente F.3 — casos de experiencia (OC ↔ factura).
//
// GET    → resumen + listado filtrado.
// POST   → alta/actualización de un caso completo (cabecera + ítems + documentos).
// DELETE → borra un caso (admin).
//
// ACCESO: leer = cualquier perfil interno autenticado (la memoria orienta el trabajo de todos).
// Escribir/borrar = admin: es el registro de respaldo de la experiencia de la empresa, no una
// nota personal — una carga errónea contamina las búsquedas de todo el equipo.
// El rol `externo` queda fuera por completo (solo ve lo suyo, y esto es transversal).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, esAdmin } from '@/app/lib/api-auth';
import {
  listarCasos, guardarCaso, borrarCaso, resumenMemoria, obtenerCaso,
} from '@/app/lib/memoria-historica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (u.rol === 'externo') return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  try {
    const id = sp.get('id');
    if (id) {
      const caso = await obtenerCaso(Number(id));
      if (!caso) return NextResponse.json({ error: 'Caso no encontrado' }, { status: 404 });
      return NextResponse.json({ caso });
    }
    const [casos, resumen] = await Promise.all([
      listarCasos({
        texto:     sp.get('texto') || undefined,
        categoria: sp.get('categoria') || undefined,
        entidad:   sp.get('entidad') || undefined,
        empresaId: sp.get('empresa') ? Number(sp.get('empresa')) : undefined,
        desde:     sp.get('desde') || undefined,
        hasta:     sp.get('hasta') || undefined,
        limite:    sp.get('limite') ? Number(sp.get('limite')) : undefined,
      }),
      resumenMemoria(),
    ]);
    return NextResponse.json({ casos, resumen });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esAdmin(req))) {
    return NextResponse.json({ error: 'Solo un administrador puede cargar experiencia' }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as any;
  if (!body?.ocNumero?.trim() || !body?.entidadNombre?.trim()) {
    // Estos dos son lo que hace que un caso sirva de prueba de experiencia: sin número de OC no
    // hay respaldo, y sin entidad no se puede acreditar ante quién se ejecutó.
    return NextResponse.json({ error: 'El número de OC y la entidad son obligatorios' }, { status: 400 });
  }

  try {
    const id = await guardarCaso(
      {
        empresaId: body.empresaId ? Number(body.empresaId) : null,
        ocNumero: String(body.ocNumero).trim().slice(0, 60),
        ocFecha: body.ocFecha || null,
        monto: body.monto == null || body.monto === '' ? null : Number(body.monto),
        moneda: body.moneda || 'CLP',
        entidadNombre: String(body.entidadNombre).trim().slice(0, 255),
        entidadRut: body.entidadRut || null,
        licitacionCodigo: body.licitacionCodigo || null,
        categoria: body.categoria || null,
        descripcion: body.descripcion || null,
        estado: body.estado || 'CERRADO',
        origen: body.origen || 'MANUAL',
        items: Array.isArray(body.items) ? body.items : [],
        documentos: Array.isArray(body.documentos) ? body.documentos : [],
      },
      { id: u.id, nombre: u.nombre || u.email || null },
    );
    return NextResponse.json({ ok: true, id, caso: await obtenerCaso(id) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await esAdmin(req))) {
    return NextResponse.json({ error: 'Solo un administrador puede borrar experiencia' }, { status: 403 });
  }
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Falta el id del caso' }, { status: 400 });
  try {
    const ok = await borrarCaso(id);
    if (!ok) return NextResponse.json({ error: 'Caso no encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// app/api/debug/descripcion-check/route.ts
// Diagnóstico: ¿la API batch de MP devuelve el campo Descripcion?
// Solo accesible por admins.  GET /api/debug/descripcion-check

import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

export async function GET(request: NextRequest) {
  // Solo admins (middleware inyecta x-user-rol)
  const rol = request.headers.get('x-user-rol');
  if (rol !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  if (!process.env.MERCADO_PUBLICO_TICKET) {
    return NextResponse.json({ error: 'MERCADO_PUBLICO_TICKET no configurado' }, { status: 503 });
  }

  const client = getMercadoPublicoClient();

  // Trae solo 1 día para ser rápido
  const licitaciones = await client.obtenerUltimosDias(1);

  const total        = licitaciones.length;
  const conDesc      = licitaciones.filter(l => l.Descripcion && l.Descripcion.trim().length > 0);
  const sinDesc      = licitaciones.filter(l => !l.Descripcion || l.Descripcion.trim().length === 0);

  // Muestra 5 con descripcion y 5 sin descripcion como muestra
  const muestraConDesc = conDesc.slice(0, 5).map(l => ({
    codigo:     l.Codigo,
    nombre:     l.Nombre.substring(0, 80),
    descripcion: l.Descripcion?.substring(0, 200),
  }));

  const muestraSinDesc = sinDesc.slice(0, 5).map(l => ({
    codigo: l.Codigo,
    nombre: l.Nombre.substring(0, 80),
  }));

  // También verificar Items
  const conItems     = licitaciones.filter(l => l.Items && l.Items.length > 0);
  const muestraItems = conItems.slice(0, 3).map(l => ({
    codigo: l.Codigo,
    nombre: l.Nombre.substring(0, 60),
    items:  l.Items!.slice(0, 3).map(it => ({
      producto:  it.NombreProducto?.substring(0, 80),
      categoria: it.Categoria?.substring(0, 40),
    })),
  }));

  return NextResponse.json({
    descripcion: {
      total_licitaciones:  total,
      con_descripcion:     conDesc.length,
      sin_descripcion:     sinDesc.length,
      porcentaje_con_desc: total > 0 ? `${Math.round(conDesc.length / total * 100)}%` : '0%',
      conclusion: conDesc.length === 0
        ? '⚠️  La API batch NO devuelve Descripcion — el radar solo busca en Nombre'
        : `✅  ${conDesc.length}/${total} traen Descripcion`,
    },
    items: {
      con_items:           conItems.length,
      sin_items:           total - conItems.length,
      porcentaje_con_items: total > 0 ? `${Math.round(conItems.length / total * 100)}%` : '0%',
      conclusion: conItems.length === 0
        ? '⚠️  La API batch NO devuelve Items — sin texto de productos para buscar'
        : `✅  ${conItems.length}/${total} traen Items (nombres de productos/servicios)`,
      muestra: muestraItems,
    },
    muestra_con_descripcion: muestraConDesc,
  });
}

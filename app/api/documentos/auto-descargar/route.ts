// app/api/documentos/auto-descargar/route.ts
// La descarga automática no es posible desde Vercel — WAF de MP bloquea IPs no chilenas.
// Este endpoint ahora simplemente devuelve la URL de la ficha para que el usuario acceda manualmente.
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { licitacionCodigo } = await request.json();

  if (!licitacionCodigo) {
    return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
  }

  const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;

  return NextResponse.json({
    success: false,
    total: 0,
    descargados: 0,
    error: 'Descarga automática no disponible. Use el flujo manual.',
    adjunto_url_mp: fichaUrl,
    ficha_url_mp: fichaUrl,
  });
}

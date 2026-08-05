// app/api/anexos/en-bases/route.ts
// GET /api/anexos/en-bases?codigo=
// SOLO LECTURA. Responde la pregunta "¿esta licitación publicó sus anexos como archivos aparte, o
// vienen impresos DENTRO del PDF de bases?" — ver anexos-en-bases.ts para el caso real que lo
// motiva (1114-12-LE26). Lo consume el selector de documentos del Anexo Creator cuando no
// encuentra ningún Word: sin esto le decía al usuario "descárgalos en la pestaña Documentos",
// mandándolo a buscar un archivo que no existe.
//
// No descarga ni extrae nada: usa el texto que YA está cacheado en documentos_cache. Si un
// documento todavía no tiene texto extraído, simplemente no aporta.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { detectarAnexosEnBases } from '@/app/lib/anexos-en-bases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codigo = new URL(request.url).searchParams.get('codigo');
  if (!codigo) return NextResponse.json({ error: 'Falta el parámetro codigo' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo alcance que el resto del Anexo Creator (admin-only por ahora, pedido explícito jul-2026).
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, documento_nombre, documento_url_local, texto_extraido
         FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria IN ('BASES_ADMINISTRATIVAS', 'BASES_TECNICAS')
          AND texto_extraido IS NOT NULL AND LENGTH(texto_extraido) > 3000
        ORDER BY id ASC`,
      [codigo],
    ) as any;

    // Si más de un documento trae anexos adentro (bases administrativas Y técnicas), gana el que
    // más trae — es el que de verdad los contiene, no el que los menciona de pasada.
    let mejor: any = null;
    for (const doc of rows as any[]) {
      const deteccion = detectarAnexosEnBases(doc.texto_extraido);
      if (deteccion.hay && (!mejor || deteccion.anexos.length > mejor.deteccion.anexos.length)) {
        mejor = { doc, deteccion };
      }
    }
    if (!mejor) return NextResponse.json({ success: true, hay: false });

    return NextResponse.json({
      success: true,
      hay: true,
      documento: {
        id: mejor.doc.id,
        nombre: mejor.doc.documento_nombre,
        url: mejor.doc.documento_url_local,
      },
      paginaInicio: mejor.deteccion.paginaInicio,
      anexos: mejor.deteccion.anexos.map((a: any) => ({ titulo: a.titulo, pagina: a.pagina })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

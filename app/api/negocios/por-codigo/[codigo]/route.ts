// app/api/negocios/por-codigo/[codigo]/route.ts
// Trae el negocio (fila activa de `negocios`) asociado a una licitación por su código —
// lo usa /licitacion/[codigo] para mostrar la MISMA columna de gestión (GestionAside)
// que /negocios/[id], sin tener el `id` de la fila a mano (solo el código de la licitación).
// Mismo shape que la lista de /api/negocios (GET), sin el enrichment de documentos/viabilidad/
// adjudicación que la página de licitación ya trae por su cuenta.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!codigoDecoded) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT
         n.id, n.licitacion_codigo, n.licitacion_monto, n.licitacion_cierre, n.monto_ofertado,
         COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline,
         n.empresa_id, emp.razon_social AS empresa_nombre,
         n.created_at, n.updated_at,
         n.asignado_a, u.nombre AS usuario_nombre, u.email AS usuario_email,
         GROUP_CONCAT(DISTINCT CONCAT(e.id,':',e.nombre,':',e.color) ORDER BY e.nombre SEPARATOR '|') AS etiquetas_raw
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN empresas emp ON emp.id = n.empresa_id
       LEFT JOIN negocios_etiquetas ne ON ne.negocio_id = n.id
       LEFT JOIN etiquetas e ON e.id = ne.etiqueta_id
       WHERE n.licitacion_codigo = ? AND n.activo = TRUE
       GROUP BY n.id
       LIMIT 1`,
      [codigoDecoded]
    );
    const row = (rows as any[])[0];
    if (!row) return NextResponse.json({ success: true, negocio: null });

    const negocio = {
      ...row,
      etiquetas: row.etiquetas_raw
        ? row.etiquetas_raw.split('|').map((e: string) => {
            const [id, nombre, color] = e.split(':');
            return { id: parseInt(id), nombre, color };
          })
        : [],
      etiquetas_raw: undefined,
    };
    return NextResponse.json({ success: true, negocio });
  } catch (error) {
    console.error('Error negocio por código:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

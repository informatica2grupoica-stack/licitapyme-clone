// app/api/licitacion-adjudicacion/[codigo]/route.ts
// ¿Esta licitación ya fue adjudicada? Y en ese caso, ¿quién ganó cada línea y por cuánto?
//
// La usa el apartado "Postuladas": una vez que postulamos, la licitación se queda ahí
// hasta que MP publica el resultado (CodigoEstado 8 = Adjudicada).
//
// CACHE (tabla adjudicacion_cache, migración 35) para no golpear la API de MP en cada
// carga de la página y evitar su rate-limit:
//   · Adjudicada en cache → respuesta desde BD, NUNCA se re-consulta (es un hecho final).
//   · No adjudicada y cache fresco (< TTL) → respuesta desde BD sin tocar MP.
//   · No adjudicada y cache vencido (o sin cache) → consulta en vivo + upsert del cache.
//   · ?force=1 salta el TTL (para un botón "Actualizar" futuro).
//   · Si la tabla no existe (migración pendiente) o la BD falla, degrada a consulta en
//     vivo sin cache — nunca bloquea la funcionalidad.
import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';

// Horas que un "aún no adjudicada" se considera vigente antes de re-consultar MP.
const TTL_HORAS = 3;

interface LineaAdjudicada {
  correlativo?: number;
  producto?: string;
  descripcion?: string;
  cantidad?: number;
  unidad?: string;
  montoUnitario: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
}

interface RespuestaAdjudicacion {
  success: true;
  codigo: string;
  estado: string | null;
  codigoEstado: number | null;
  esAdjudicada: boolean;
  fechaAdjudicacion: string | null;
  adjudicacion: {
    tipo: number | null;
    numeroResolucion: string | null;
    numeroOferentes: number | null;
    urlActa: string | null;
  } | null;
  lineasAdjudicadas: LineaAdjudicada[];
  montoAdjudicadoTotal: number | null;
  desdeCache: boolean;
}

// ── Cache: lectura ────────────────────────────────────────────────────────────
async function leerCache(codigo: string): Promise<{ row: any; frescoHoras: number } | null> {
  try {
    const [rows] = await pool.query(
      `SELECT *, TIMESTAMPDIFF(MINUTE, consultado_en, NOW()) / 60 AS horas
       FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`,
      [codigo],
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    return { row, frescoHoras: Number(row.horas) || 0 };
  } catch {
    return null; // tabla ausente (migración pendiente) o BD caída → sin cache
  }
}

function respuestaDesdeCache(codigo: string, row: any): RespuestaAdjudicacion {
  let lineas: LineaAdjudicada[] = [];
  try { lineas = row.lineas ? JSON.parse(row.lineas) : []; } catch { /* JSON corrupto → sin líneas */ }
  return {
    success: true,
    codigo,
    estado: row.estado ?? null,
    codigoEstado: row.codigo_estado ?? null,
    esAdjudicada: !!row.es_adjudicada,
    fechaAdjudicacion: row.fecha_adjudicacion ? new Date(row.fecha_adjudicacion).toISOString() : null,
    adjudicacion: row.es_adjudicada
      ? {
          tipo: row.tipo_adjudicacion ?? null,
          numeroResolucion: row.numero_resolucion ?? null,
          numeroOferentes: row.numero_oferentes ?? null,
          urlActa: row.url_acta ?? null,
        }
      : null,
    lineasAdjudicadas: lineas,
    montoAdjudicadoTotal: row.monto_adjudicado_total != null ? Number(row.monto_adjudicado_total) : null,
    desdeCache: true,
  };
}

// ── Cache: escritura (best-effort, nunca bloquea la respuesta) ────────────────
async function guardarCache(codigo: string, r: RespuestaAdjudicacion): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO adjudicacion_cache (
         licitacion_codigo, es_adjudicada, estado, codigo_estado, fecha_adjudicacion,
         tipo_adjudicacion, numero_resolucion, numero_oferentes, url_acta,
         monto_adjudicado_total, lineas
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         es_adjudicada = VALUES(es_adjudicada),
         estado = VALUES(estado),
         codigo_estado = VALUES(codigo_estado),
         fecha_adjudicacion = VALUES(fecha_adjudicacion),
         tipo_adjudicacion = VALUES(tipo_adjudicacion),
         numero_resolucion = VALUES(numero_resolucion),
         numero_oferentes = VALUES(numero_oferentes),
         url_acta = VALUES(url_acta),
         monto_adjudicado_total = VALUES(monto_adjudicado_total),
         lineas = VALUES(lineas),
         consultado_en = NOW()`,
      [
        codigo,
        r.esAdjudicada ? 1 : 0,
        r.estado,
        r.codigoEstado,
        r.fechaAdjudicacion ? new Date(r.fechaAdjudicacion) : null,
        r.adjudicacion?.tipo ?? null,
        r.adjudicacion?.numeroResolucion ?? null,
        r.adjudicacion?.numeroOferentes ?? null,
        r.adjudicacion?.urlActa ?? null,
        r.montoAdjudicadoTotal,
        JSON.stringify(r.lineasAdjudicadas || []),
      ],
    );
  } catch { /* migración pendiente o BD caída → seguir sin cache */ }
}

// ── Consulta en vivo a Mercado Público ────────────────────────────────────────
async function consultarMP(codigo: string): Promise<RespuestaAdjudicacion | null> {
  const lic = await getMercadoPublicoClient().obtenerPorCodigo(codigo);
  if (!lic) return null;

  // CodigoEstado 8 = Adjudicada. También lo confirmamos por el nombre por robustez.
  const esAdjudicada =
    Number(lic.CodigoEstado) === 8 ||
    (lic.EstadoNombre || '').toLowerCase().includes('adjudicad');

  // Detalle por línea: solo las que traen proveedor adjudicado.
  const lineasAdjudicadas: LineaAdjudicada[] = (lic.Items || [])
    .filter(it => it.NombreProveedorAdjudicado || it.RutProveedorAdjudicado)
    .map(it => ({
      correlativo:  it.Correlativo,
      producto:     it.NombreProducto,
      descripcion:  it.Descripcion,
      cantidad:     it.Cantidad,
      unidad:       it.Unidad,
      montoUnitario: it.MontoUnitario ?? null,
      rutProveedor:  it.RutProveedorAdjudicado ?? null,
      proveedor:     it.NombreProveedorAdjudicado ?? null,
    }));

  // Monto total adjudicado a partir de las líneas (cantidad × unitario).
  const montoAdjudicadoTotal = lineasAdjudicadas.reduce(
    (acc, l) => acc + (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1),
    0,
  );

  return {
    success: true,
    codigo,
    estado: lic.EstadoNombre || null,
    codigoEstado: lic.CodigoEstado ?? null,
    esAdjudicada,
    fechaAdjudicacion: lic.FechaAdjudicacion || lic.Adjudicacion?.Fecha || null,
    adjudicacion: lic.Adjudicacion
      ? {
          tipo:             lic.Adjudicacion.Tipo ?? null,           // 2 = total, 1 = por línea
          numeroResolucion: lic.Adjudicacion.Numero ?? null,
          numeroOferentes:  lic.Adjudicacion.NumeroOferentes ?? null,
          urlActa:          lic.Adjudicacion.UrlActa ?? null,
        }
      : null,
    lineasAdjudicadas,
    montoAdjudicadoTotal: montoAdjudicadoTotal || null,
    desdeCache: false,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const { codigo } = await params;
  if (!codigo) return NextResponse.json({ error: 'Código requerido' }, { status: 400 });

  const cod = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, cod)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    // 1) Cache primero. Adjudicada = final (siempre válido); no adjudicada = válido < TTL.
    const cache = await leerCache(cod);
    if (cache) {
      if (cache.row.es_adjudicada) return NextResponse.json(respuestaDesdeCache(cod, cache.row));
      if (!force && cache.frescoHoras < TTL_HORAS) return NextResponse.json(respuestaDesdeCache(cod, cache.row));
    }

    // 2) Consulta en vivo + actualizar cache.
    const vivo = await consultarMP(cod);
    if (vivo) {
      await guardarCache(cod, vivo);
      return NextResponse.json(vivo);
    }

    // 3) MP no respondió (rate-limit / caída): servir el cache viejo si existe.
    if (cache) return NextResponse.json(respuestaDesdeCache(cod, cache.row));
    return NextResponse.json({ error: 'No encontrada en Mercado Público' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

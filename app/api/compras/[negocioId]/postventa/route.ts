// app/api/compras/[negocioId]/postventa/route.ts
// §17.1 — los compromisos de postventa vienen del resumen ejecutivo (paquete de traspaso); acá
// solo se marca cuáles ya se resolvieron.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarPostventa, marcarPostventaResuelta, desmarcarPostventa } from '@/app/lib/compras-entrega';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

// Lo que dicen los documentos YA LEÍDOS (documentos_cache.texto_extraido): secciones de garantía / postventa / capacitación
// de las bases, y el canal de postventa y plazo de respuesta que ofertamos en el anexo técnico.
const RE_TITULO_POSTVENTA = /garant[ií]a|post-?venta|capacitaci|manten[cs]i|servicio t[eé]cnico|repuesto/i;
type DatoLeido = { titulo: string; texto: string; fuente: string; fuenteUrl: string | null };
async function leerPostventaDeDocumentos(codigo: string): Promise<DatoLeido[]> {
  const [rows] = await pool.query(
    `SELECT documento_nombre n, documento_url_local u, categoria c, texto_extraido t FROM documentos_cache
      WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND LENGTH(texto_extraido) > 200
        AND (categoria IN ('BASES_TECNICAS','BASES_ADMINISTRATIVAS') OR (categoria = 'DOCUMENTOS_PROPIOS' AND documento_nombre LIKE '%ANEXO%' AND documento_nombre LIKE '%.pdf'))`, [codigo]) as any;
  const out: DatoLeido[] = [];
  for (const r of rows as any[]) {
    const t = String(r.t);
    if (r.c !== 'DOCUMENTOS_PROPIOS') {
      for (const sec of t.split(/\n(?=#{1,4}\s)/)) {
        const m = sec.match(/^#{1,4}\s*([^\n]+)\n([\s\S]*)/);
        if (!m || !RE_TITULO_POSTVENTA.test(m[1])) continue;
        const cuerpo = m[2].replace(/\s+/g, ' ').trim();
        if (cuerpo.length < 40) continue;
        out.push({ titulo: m[1].replace(/^\d+[.)]?\s*/, '').trim(), texto: cuerpo.slice(0, 900), fuente: r.n, fuenteUrl: r.u || null });
      }
    } else {
      const tn = t.replace(/\s+/g, ' ');
      const m = tn.match(/Canal de postventa (.{3,120}?) Plazo de respuesta (.{2,40}?) Exclusiones/i);
      const g = tn.match(/Garant[ií]a com[uú]n ofrecida\s+(\d+\s*meses)/i);
      if (g) out.push({ titulo: 'Garantía ofertada', texto: g[1], fuente: r.n, fuenteUrl: r.u || null });
      const gd = tn.match(/Garant[ií]a (Todos los productos ofertados.{20,500}?)(?= Despacho| Entrega|$)/i);
      if (gd) out.push({ titulo: 'Condiciones de la garantía ofertada', texto: gd[1].replace(/\s+/g, ' ').trim(), fuente: r.n, fuenteUrl: r.u || null });
      if (m) out.push({ titulo: 'Canal de postventa ofertado', texto: `${m[1].trim()} — respuesta en ${m[2].trim()}`, fuente: r.n, fuenteUrl: r.u || null });
    }
  }
  return out;
}

// Los documentos casi no cambian: se leen una vez cada 10 minutos por licitación (antes: 4 textos de hasta 30 KB en cada visita).
const gl = globalThis as any;
const LEIDOS: Map<string, { t: number; d: DatoLeido[] }> = gl.__postventaLeidos || (gl.__postventaLeidos = new Map());
async function leerPostventaCacheado(codigo: string): Promise<DatoLeido[]> {
  const hit = LEIDOS.get(codigo);
  if (hit && Date.now() - hit.t < 600_000) return hit.d;
  const d = await leerPostventaDeDocumentos(codigo).catch(() => null);
  if (!d) return hit?.d ?? [];
  LEIDOS.set(codigo, { t: Date.now(), d });
  return d;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const compromisos = asignacion.resumen ? ((asignacion.resumen as any).compromisosPostventa || []) : [];
    const garantiasResumen = asignacion.resumen ? ((asignacion.resumen as any).garantias || []) : [];
    // El detalle (p. ej. «12 meses…») se lee EN VIVO del Auditor Técnico: el resumen es una foto vieja y llegaba sin descripción (387-55-LE26, 12-nov-2026).
    const [vivos] = await pool.query(
      `SELECT titulo, valor_texto FROM checklist_comercial WHERE negocio_id = ? AND valor_texto IS NOT NULL AND valor_texto <> '' AND (titulo LIKE '%garant%' OR titulo LIKE '%postventa%')`, [id],
    ).catch(() => [[]] as any) as any;
    const valorDe = new Map((vivos as any[]).map(v => [String(v.titulo).trim(), String(v.valor_texto)]));
    // Solo garantías con contenido real: un título suelto («ANEXO N° 5 — …») es el nombre de un documento, no una garantía.
    const garantias = garantiasResumen
      .map((g: any) => ({ titulo: g.titulo, descripcion: valorDe.get(String(g.titulo).trim()) ?? g.descripcion ?? null }))
      .filter((g: any) => g.descripcion && String(g.descripcion).trim());
    const resueltos = await listarPostventa(id);
    const leidos = await leerPostventaCacheado(asignacion.licitacionCodigo);
    // Correcciones del equipo (migration-192): si hay una, manda sobre lo leído del documento.
    const [corr] = await pool.query(`SELECT clave, texto, actor_nombre FROM compras_postventa_correccion WHERE negocio_id = ?`, [id]).catch(() => [[]] as any) as any;
    const corregidoDe = new Map((corr as any[]).map(c => [String(c.clave), c]));
    const deDocumentos = leidos.map(d => {
      const clave = `${d.fuente}|${d.titulo}`;
      const c = corregidoDe.get(clave);
      return { ...d, clave, textoLeido: d.texto, texto: c ? String(c.texto) : d.texto, corregido: !!c, corregidoPor: c?.actor_nombre ?? null };
    });
    return NextResponse.json({
      success: true,
      deDocumentos,
      compromisos: compromisos.map((c: any) => ({ titulo: c.titulo, descripcion: c.descripcion ?? null, ...(resueltos.get(c.titulo) || { resuelto: false, resueltoPorNombre: null, resueltoAt: null, notas: null }) })),
      garantias,
    });
  } catch (error) {
    console.error('[compras/postventa][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la postventa.' }, { status: 500 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    if (body.accion === 'corregir') {
      const clave = String(body.clave || '').slice(0, 300);
      const texto = String(body.texto ?? '').trim().slice(0, 2000);
      if (!clave) return NextResponse.json({ error: 'Falta qué dato corregir.' }, { status: 400 });
      if (texto) await pool.query(
        `INSERT INTO compras_postventa_correccion (negocio_id, clave, texto, actor_id, actor_nombre) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE texto=VALUES(texto), actor_id=VALUES(actor_id), actor_nombre=VALUES(actor_nombre)`, [id, clave, texto, userId, nombre]);
      else await pool.query(`DELETE FROM compras_postventa_correccion WHERE negocio_id = ? AND clave = ?`, [id, clave]);
      return NextResponse.json({ success: true });
    }
    if (body.resuelto) await marcarPostventaResuelta(id, body.compromisoTexto, body.notas || null, userId, nombre);
    else await desmarcarPostventa(id, body.compromisoTexto);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/postventa][PATCH]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo actualizar.') }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');

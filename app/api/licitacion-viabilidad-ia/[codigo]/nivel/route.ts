// app/api/licitacion-viabilidad-ia/[codigo]/nivel/route.ts
// NIVEL DE ATRACTIVO v4.1 — confirmar un dato dudoso o recalcular el nivel (especificación 2, §8 y §10).
//
// Si un dato clave quedó dudoso (cómo se adjudica, presupuesto, cantidad de productos, causal de
// admisibilidad, informe reparado), la acción del asistente es "Confirma [dato] en el visor antes
// de decidir". Al confirmarlo (o corregirlo, para la adjudicación) el NIVEL SE RECALCULA y se
// aplica la acción normal. Si no logra confirmarlo, consulta a CA. Así a CA solo le llega lo que el
// asistente no pudo resolver.
//
// POST { accion: 'confirmar', clave, valor? }  → registra la confirmación y recalcula.
//      { accion: 'recalcular' }                 → recalcula con la configuración vigente.
// No llama a la IA: calcularNivel es una función de código.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { aplicarNivel, guardarColumnasNivel } from '@/app/lib/viabilidad-ia';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ codigo: string }> };

const CLAVES = new Set(['adjudicacion', 'presupuesto', 'productos', 'informe', 'causal_f4', 'causal_marca']);

export async function POST(request: NextRequest, { params }: Params) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const codigo = decodeURIComponent((await params).codigo);
  if (!(await puedeVerLicitacion(request, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const accion = body?.accion === 'recalcular' ? 'recalcular' : 'confirmar';
  const clave = String(body?.clave || '');
  if (accion === 'confirmar' && !CLAVES.has(clave)) return NextResponse.json({ error: 'Dato desconocido.' }, { status: 400 });

  const [rows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]) as any;
  const fila = (rows as any[])[0];
  let ie: any = null;
  try { ie = fila ? (typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : fila.informe_ejecutivo) : null; } catch { ie = null; }
  const inf = ie?._informe_ia_v3;
  if (!inf || inf._schema !== 'v4') return NextResponse.json({ error: 'Esta licitación no tiene un análisis v4: vuelve a analizarla.' }, { status: 409 });

  let detalle = '';
  if (accion === 'confirmar') {
    const valor = typeof body?.valor === 'string' ? body.valor.toUpperCase() : null;
    if (clave === 'adjudicacion' && valor) {
      if (valor !== 'GLOBAL' && valor !== 'POR_LINEAS') return NextResponse.json({ error: 'La adjudicación se confirma como GLOBAL o POR_LINEAS.' }, { status: 400 });
      const adj = inf.adjudicacion || (inf.adjudicacion = {});
      if (!adj.resultado_original) adj.resultado_original = adj.resultado;
      adj.resultado = valor;
      adj.regla_aplicada = 'CONFIRMADA';
      adj.motivo = `Confirmado por ${usuario.nombre || usuario.email} en el visor.`;
      adj.cotizar_100 = valor === 'GLOBAL' ? 'SI' : 'POR_LINEA';
      adj.cotizar_100_texto = valor === 'GLOBAL' ? 'Cotizar el 100 % de las líneas' : 'Completar cada línea que se oferte';
      adj.pregunta_foro = null;
      // El costeo por línea sigue a la adjudicación confirmada cuando es POR_LINEAS.
      if (inf.modalidad && typeof inf.modalidad === 'object') {
        if (valor === 'POR_LINEAS') inf.modalidad.tipo = 'por_linea';
        delete inf.modalidad.estado;   // ya no está "por confirmar"
      }
      detalle = `adjudicación ${valor === 'GLOBAL' ? 'global' : 'por línea'}`;
    } else {
      detalle = clave;
    }
    const conf: any[] = Array.isArray(inf.score_confirmaciones) ? inf.score_confirmaciones : [];
    inf.score_confirmaciones = [...conf.filter(c => c?.clave !== clave), { clave, valor, usuario_id: usuario.id, usuario: usuario.nombre || usuario.email, fecha: new Date().toISOString() }];
  }

  await aplicarNivel(inf, codigo);
  ie._informe_ia_v3 = inf;
  await pool.query(`UPDATE viabilidad_licitacion SET informe_ejecutivo = ? WHERE licitacion_codigo = ?`, [JSON.stringify(ie), codigo]);
  await guardarColumnasNivel(codigo, inf.score);
  registrarActividad({
    usuarioId: usuario.id, accion: 'viabilidad_nivel',
    entidadTipo: 'licitacion', entidadId: codigo,
    descripcion: accion === 'recalcular'
      ? `Recalculó el nivel de atractivo de ${codigo}: ${inf.score?.nivel}`
      : `Confirmó ${detalle} en ${codigo}; nivel ${inf.score?.nivel} · ${inf.score?.accion_texto}`,
    metadata: { licitacion_codigo: codigo, clave: clave || undefined, nivel: inf.score?.nivel },
  });
  return NextResponse.json({ success: true, score: inf.score, adjudicacion: inf.adjudicacion });
}

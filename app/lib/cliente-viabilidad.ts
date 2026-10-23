// app/lib/cliente-viabilidad.ts
// Viabilidad IA de las EMPRESAS-CLIENTE. Código y tablas propios: no toca el motor ni las tablas de Grupo ICA.
//
//   · Lo COMPARTIDO: la licitación (licitaciones_cache) y el texto ya leído de sus documentos OFICIALES (documentos_cache, cliente_id 0).
//   · Lo PROPIO de cada empresa: su perfil (qué vende), el dictamen por licitación (cliente_viabilidad) y su cupo mensual de dictámenes.
// LICITANK paga la IA: por eso cada empresa tiene un cupo (clientes.cupo_ia_mensual = dictámenes por mes; 0 = sin plan de viabilidad).
import pool from '@/app/lib/db';
import { crearChatIA, iaTextoConfigurada, MODELO_TEXTO } from '@/app/lib/gemini';
import { conModuloIA, conUsuarioIA } from '@/app/lib/ia-uso';

export interface PerfilCliente {
  descripcion: string; rubros: string; productos_si: string; productos_no: string;
  monto_min: number | null; monto_max: number | null; regiones: string; reglas: string;
}
export interface CriterioEvaluacion { criterio: string; ponderacion: string; como_cumplir: string }
export interface Dictamen {
  veredicto: 'POSTULAR' | 'EVALUAR' | 'NO_POSTULAR';
  puntaje: number;
  coincidencia_rubro: 'SI' | 'PARCIAL' | 'NO';
  coincidencia_detalle: string;
  resumen: string;
  razones: string[];
  riesgos: string[];
  requisitos: string[];
  criterios_evaluacion: CriterioEvaluacion[];
  multas_y_garantias: string;
  recomendacion: string;
}

export async function leerPerfil(clienteId: number): Promise<PerfilCliente | null> {
  const [rows] = await pool.query('SELECT * FROM cliente_perfil WHERE cliente_id = ?', [clienteId]);
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    descripcion: r.descripcion ?? '', rubros: r.rubros ?? '', productos_si: r.productos_si ?? '', productos_no: r.productos_no ?? '',
    monto_min: r.monto_min != null ? Number(r.monto_min) : null, monto_max: r.monto_max != null ? Number(r.monto_max) : null,
    regiones: r.regiones ?? '', reglas: r.reglas ?? '',
  };
}

export async function guardarPerfil(clienteId: number, p: Partial<PerfilCliente>): Promise<void> {
  const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const n = (v: unknown) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
  await pool.query(
    `INSERT INTO cliente_perfil (cliente_id, descripcion, rubros, productos_si, productos_no, monto_min, monto_max, regiones, reglas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), rubros = VALUES(rubros), productos_si = VALUES(productos_si), productos_no = VALUES(productos_no),
       monto_min = VALUES(monto_min), monto_max = VALUES(monto_max), regiones = VALUES(regiones), reglas = VALUES(reglas)`,
    [clienteId, t(p.descripcion, 3000), t(p.rubros, 2000), t(p.productos_si, 3000), t(p.productos_no, 3000), n(p.monto_min), n(p.monto_max), t(p.regiones, 500), t(p.reglas, 3000)]);
}

/** Dictámenes usados este mes y cupo del plan. */
export async function estadoCupo(clienteId: number): Promise<{ usados: number; cupo: number }> {
  const [[c]] = await pool.query('SELECT cupo_ia_mensual FROM clientes WHERE id = ?', [clienteId]) as any;
  const [[u]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM cliente_viabilidad WHERE cliente_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) + (SELECT COUNT(*) FROM cliente_viabilidad_v4 WHERE cliente_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) AS n`, [clienteId, clienteId]) as any;
  return { usados: Number(u?.n) || 0, cupo: Number(c?.cupo_ia_mensual) || 0 };
}

export async function leerDictamen(clienteId: number, codigo: string) {
  const [rows] = await pool.query(
    'SELECT veredicto, puntaje, dictamen, modelo, docs_leidos, created_at FROM cliente_viabilidad WHERE cliente_id = ? AND licitacion_codigo = ?', [clienteId, codigo]);
  const r = (rows as any[])[0];
  if (!r) return null;
  const d = typeof r.dictamen === 'string' ? JSON.parse(r.dictamen) : r.dictamen;
  return { ...d, veredicto: r.veredicto, puntaje: r.puntaje, docsLeidos: r.docs_leidos, creadoAt: r.created_at, modelo: r.modelo };
}

const MAX_CHARS_DOCS = 70_000;

function extraerJSON(txt: string): any {
  const limpio = txt.replace(/```json|```/gi, '').trim();
  const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('La IA no devolvió un dictamen legible');
  return JSON.parse(limpio.slice(i, j + 1));
}

export type ResultadoDictamen =
  | { ok: true; dictamen: Dictamen & { docsLeidos: number } }
  | { ok: false; codigo: 'SIN_PERFIL' | 'SIN_CUPO' | 'SIN_IA' | 'SIN_LICITACION' | 'ERROR'; mensaje: string };

/** Genera (o regenera) el dictamen de UNA licitación para UNA empresa. Cobra del cupo mensual de la empresa. */
export async function generarDictamen(clienteId: number, codigo: string, usuario: { id: number; nombre: string | null }): Promise<ResultadoDictamen> {
  if (!iaTextoConfigurada()) return { ok: false, codigo: 'SIN_IA', mensaje: 'La IA no está disponible en este momento.' };
  const perfil = await leerPerfil(clienteId);
  if (!perfil || (!perfil.descripcion.trim() && !perfil.productos_si.trim() && !perfil.rubros.trim()))
    return { ok: false, codigo: 'SIN_PERFIL', mensaje: 'Primero cuéntanos qué vende tu empresa (Perfil de tu empresa).' };

  const cupo = await estadoCupo(clienteId);
  const yaTiene = await leerDictamen(clienteId, codigo);
  if (!yaTiene && cupo.usados >= cupo.cupo)
    return { ok: false, codigo: 'SIN_CUPO', mensaje: cupo.cupo === 0 ? 'Tu plan no incluye dictámenes de viabilidad.' : `Usaste los ${cupo.cupo} dictámenes de este mes.` };

  const [lr] = await pool.query('SELECT * FROM licitaciones_cache WHERE codigo = ?', [codigo]);
  const lic = (lr as any[])[0];
  if (!lic) return { ok: false, codigo: 'SIN_LICITACION', mensaje: 'No encontramos esta licitación.' };

  // Texto ya leído de los documentos OFICIALES (compartido): no se vuelve a leer ni a pagar OCR.
  const [dr] = await pool.query(
    `SELECT documento_nombre, texto_extraido FROM documentos_cache
      WHERE licitacion_codigo = ? AND cliente_id = 0 AND texto_extraido IS NOT NULL AND LENGTH(texto_extraido) > 200
      ORDER BY (categoria = 'BASES') DESC, id LIMIT 12`, [codigo]);
  const docs = dr as Array<{ documento_nombre: string; texto_extraido: string }>;
  let presupuesto = MAX_CHARS_DOCS;
  const textoDocs = docs.map(d => {
    const t = d.texto_extraido.slice(0, Math.max(0, Math.min(presupuesto, 25_000)));
    presupuesto -= t.length;
    return t ? `### ${d.documento_nombre}\n${t}` : '';
  }).filter(Boolean).join('\n\n');

  let items = '';
  try { items = (JSON.parse(lic.items_json || '[]') as any[]).slice(0, 40).map(i => `- ${i.NombreProducto || ''} ${i.Descripcion || ''} (${i.Cantidad ?? ''} ${i.UnidadMedida || i.Unidad || ''})`).join('\n'); } catch { /* sin ítems */ }

  const sistema = 'Eres un analista experto en compras públicas de Chile (Mercado Público). Dictaminas si a UNA empresa le conviene postular a una licitación, ' +
    'según lo que la empresa vende y las condiciones de la licitación. No inventes datos: si algo no está en los documentos, dilo. Responde SOLO un objeto JSON.\n' +
    'REGLA PRINCIPAL: lo PRIMERO es comparar lo que se compra (nombre e ítems de la licitación) con lo que la empresa vende y NO vende. ' +
    'Si el producto o servicio licitado no está entre lo que la empresa ofrece, o está en lo que NO ofrece, o es de otro rubro, coincidencia_rubro es "NO", el veredicto es NO_POSTULAR y el puntaje máximo 25, ' +
    'AUNQUE el monto, la región o los plazos calcen. Que el monto esté en su rango no compensa un rubro distinto. Sé estricto: ante la duda entre "PARCIAL" y "NO", usa "NO" si el producto principal no se parece a nada de lo que vende.';
  const usuarioMsg =
`PERFIL DE LA EMPRESA
- Qué hace: ${perfil.descripcion || '—'}
- Rubros: ${perfil.rubros || '—'}
- Productos/servicios que SÍ ofrece: ${perfil.productos_si || '—'}
- Que NO ofrece: ${perfil.productos_no || '—'}
- Monto mínimo/máximo que le interesa: ${perfil.monto_min ?? '—'} / ${perfil.monto_max ?? '—'} (CLP)
- Regiones: ${perfil.regiones || 'todas'}
- Reglas propias: ${perfil.reglas || '—'}

LICITACIÓN ${codigo}
Nombre: ${lic.nombre}
Organismo: ${lic.organismo} · Región: ${lic.region || '—'} · Tipo: ${lic.tipo || '—'}
Monto estimado: ${lic.monto ?? 'no publicado'} · Cierre: ${lic.fecha_cierre ?? '—'}
Descripción: ${(lic.descripcion || '').slice(0, 3000)}
Ítems:\n${items || '—'}

DOCUMENTOS OFICIALES LEÍDOS (${docs.length}):\n${textoDocs || '(aún no hay documentos leídos; dictamina solo con la ficha y dilo en "plazos_y_garantias")'}

Devuelve este JSON: {"coincidencia_rubro":"SI|PARCIAL|NO","coincidencia_detalle":"1 frase: qué se compra vs qué vende la empresa","veredicto":"POSTULAR|EVALUAR|NO_POSTULAR","puntaje":0-100,"resumen":"2-3 frases","razones":["..."],"riesgos":["..."],"requisitos":["requisitos clave para postular"],"criterios_evaluacion":[{"criterio":"nombre del criterio de las bases","ponderacion":"p. ej. 40%","como_cumplir":"cómo obtener buen puntaje"}],"multas_y_garantias":"plazos, garantías, multas y vigencias relevantes","recomendacion":"qué hacer a continuación"}
En criterios_evaluacion lista TODOS los criterios y ponderaciones que aparezcan en las bases (precio, plazo de entrega, experiencia, etc.); si no aparecen, deja la lista vacía.`;

  let dictamen: Dictamen;
  try {
    const resp: any = await conUsuarioIA({ usuarioId: usuario.id, usuarioNombre: usuario.nombre, licitacion: codigo },
      () => conModuloIA('viabilidad', async () => crearChatIA({
        model: MODELO_TEXTO, temperature: 0.2,
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuarioMsg }],
      }, { soloGlm: true, deepSeekUltimoRecurso: true, timeoutMs: 120_000 }))());
    const raw = extraerJSON(String(resp?.choices?.[0]?.message?.content ?? ''));
    const ver = ['POSTULAR', 'EVALUAR', 'NO_POSTULAR'].includes(raw.veredicto) ? raw.veredicto : 'EVALUAR';
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x)).slice(0, 12) : []);
    const coin = ['SI', 'PARCIAL', 'NO'].includes(raw.coincidencia_rubro) ? raw.coincidencia_rubro : 'PARCIAL';
    let veredicto: Dictamen['veredicto'] = ver, puntaje = Math.max(0, Math.min(100, Math.round(Number(raw.puntaje) || 0)));
    // Garantía en código (no solo en el prompt): si el rubro no coincide, no puede salir «conviene postular».
    if (coin === 'NO') { veredicto = 'NO_POSTULAR'; puntaje = Math.min(puntaje, 25); }
    else if (coin === 'PARCIAL' && veredicto === 'POSTULAR') { veredicto = 'EVALUAR'; puntaje = Math.min(puntaje, 65); }
    const crit = Array.isArray(raw.criterios_evaluacion) ? raw.criterios_evaluacion.slice(0, 15).map((c: any) => ({ criterio: String(c?.criterio || ''), ponderacion: String(c?.ponderacion || ''), como_cumplir: String(c?.como_cumplir || '') })).filter((c: CriterioEvaluacion) => c.criterio) : [];
    dictamen = {
      veredicto, puntaje, coincidencia_rubro: coin, coincidencia_detalle: String(raw.coincidencia_detalle || ''),
      resumen: String(raw.resumen || ''), razones: arr(raw.razones), riesgos: arr(raw.riesgos), requisitos: arr(raw.requisitos),
      criterios_evaluacion: crit, multas_y_garantias: String(raw.multas_y_garantias || raw.plazos_y_garantias || ''), recomendacion: String(raw.recomendacion || ''),
    };
  } catch (e) {
    console.error('[cliente-viabilidad]', codigo, String(e).slice(0, 200));
    return { ok: false, codigo: 'ERROR', mensaje: 'No se pudo generar el dictamen. Intenta de nuevo en un momento.' };
  }

  await pool.query(
    `INSERT INTO cliente_viabilidad (cliente_id, licitacion_codigo, veredicto, puntaje, dictamen, modelo, docs_leidos, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE veredicto = VALUES(veredicto), puntaje = VALUES(puntaje), dictamen = VALUES(dictamen), modelo = VALUES(modelo),
       docs_leidos = VALUES(docs_leidos), creado_por = VALUES(creado_por), created_at = CURRENT_TIMESTAMP`,
    [clienteId, codigo, dictamen.veredicto, dictamen.puntaje, JSON.stringify(dictamen), MODELO_TEXTO, docs.length, usuario.id]);
  return { ok: true, dictamen: { ...dictamen, docsLeidos: docs.length } };
}

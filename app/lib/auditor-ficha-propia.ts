// app/lib/auditor-ficha-propia.ts
// Genera NUESTRA ficha técnica (PDF) desde el Auditor — ver auditor-ficha-propia-core.ts para el criterio.
// Una ficha por opción pedida (una por producto), con logo, firma y timbre de la empresa del negocio. Queda
// en Documentos Propios, caja «Anexos Técnicos» (no en «fichas_tecnicas»: esa caja es de las fichas de los
// PROVEEDORES y el Auditor las compararía como si fueran una más).
import pool from '@/app/lib/db';
import { armarPanelAuditor, cargarEstadoCosteo } from '@/app/lib/auditor-opciones';
import { motivoFichaNoLista, productoFichaDeOpcion, opcionesDeLaOferta, opcionesDeLaLinea } from '@/app/lib/auditor-ficha-propia-core';
import { cargarDocumentoBase } from '@/app/lib/anexos-datos';
import { abrirDocx } from '@/app/lib/anexos-docx';
import { construirFichaTecnicaHtml, especificacionesSinCompletar, productosSinConfirmar, type EmpresaFicha, type LineaFicha, type EspecificacionFicha } from '@/app/lib/ficha-tecnica';
import { crearChatIA as crearChatIABase } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { parseJsonIA } from '@/app/lib/json-ia';
const crearChatIA = conModuloIA('auditor', crearChatIABase);
import { extraerImagenesProducto } from '@/app/lib/ficha-imagen-extraer';
import { construirFichaTecnicaDocx } from '@/app/lib/ficha-tecnica-docx';
import { generarInformePdf } from '@/app/lib/generar-informe';
import { subirDocumentoR2 } from '@/app/lib/r2';

/** Imagen remota → data: URI (el motor del PDF no carga recursos externos). null si no se puede: mejor sin foto que sin ficha. */
async function comoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const tipo = r.headers.get('content-type') || 'image/png';
    if (!buf.length || buf.length > 4_000_000 || !tipo.startsWith('image/')) return null;
    return `data:${tipo};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const MAX_FOTOS = 4;   // una al lado de la otra

/** Fotos del producto: primero las que puso una persona (Auditor «Foto para la ficha», fila del costeo); después las que se sacan de los PDF del proveedor
 *  (sus fichas y, si no hay, su cotización), hasta MAX_FOTOS. La primera es la principal. */
async function fotosDeOpcion(fotosPuestas: (string | null | undefined)[], pdfsProveedor: string[]): Promise<{ principal: { dataUri: string; puestaPorPersona: boolean } | null; extra: string[] }> {
  const fotos: string[] = [];
  // Las que puso una persona: la subida en el Auditor para la ficha y la de la fila del costeo, en ese orden.
  for (const url of [...new Set(fotosPuestas.filter(Boolean))]) { const d = await comoDataUri(url); if (d) fotos.push(d); }
  const propia = fotos.length > 0;
  for (const url of pdfsProveedor) {
    if (fotos.length >= MAX_FOTOS) break;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      for (const img of await extraerImagenesProducto(Buffer.from(await r.arrayBuffer()), MAX_FOTOS - fotos.length))
        fotos.push(`data:image/png;base64,${img.png.toString('base64')}`);
    } catch { /* sigue con el próximo documento */ }
  }
  return { principal: fotos.length ? { dataUri: fotos[0], puestaPorPersona: !!propia } : null, extra: fotos.slice(1) };
}

const SISTEMA_NOMBRES = `Te doy requisitos técnicos de unas bases de licitación, numerados. Para cada uno escribe el NOMBRE CORTO de la característica que evalúa (1 a 4 palabras, en español, con mayúscula inicial), como el rótulo de una fila en la ficha técnica de un producto: «Procesador», «Memoria RAM», «Sistema operativo», «Resistencia al agua y polvo», «Garantía». Sin valores, sin cifras, sin «mínimo» ni «exigido».
Responde SOLO un JSON: {"nombres":["...","..."]} con un nombre por requisito y en el mismo orden.`;

/** Rótulo de las filas cuyo requisito no trae «Nombre:» (ver nombreDeCaracteristica). Una sola llamada por ficha; si la IA
 *  falla, la fila sale con el dato ofertado a todo el ancho, sin rótulo: nunca con el texto de las bases. */
async function nombrarCaracteristicasConIA(especificaciones: EspecificacionFicha[]): Promise<void> {
  const sinNombre = especificaciones.filter(e => !e.descripcion && e.valorRequeridoTexto);
  if (!sinNombre.length) return;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SISTEMA_NOMBRES },
        { role: 'user', content: sinNombre.map((e, i) => `${i + 1}. ${String(e.valorRequeridoTexto).replace(/\s+/g, ' ').slice(0, 400)}`).join('\n') }],
      temperature: 0, stream: false, max_tokens: 2_000, response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000, proveedorPreferido: 'kimi' });
    const nombres: unknown = parseJsonIA<any>(String(completion.choices?.[0]?.message?.content ?? ''))?.nombres;
    if (!Array.isArray(nombres)) return;
    sinNombre.forEach((e, i) => {
      const n = String(nombres[i] ?? '').replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim();
      if (n && n.length <= 50) e.descripcion = n;
    });
  } catch { /* sin rótulo, como dice arriba */ }
}

export interface FichaPropiaGenerada { url: string; nombre: string; productos: number; sinCompletar: number; fotoSinConfirmar: number; sinFoto: number }

type FichaArmada = Awaited<ReturnType<typeof armarFichaPropia>>;

// Nuestra ficha técnica va en WORD (27-oct-2026, pedido del dueño): es lo nuestro que se sube a Mercado Público y el equipo
// la edita antes. Los anexos (la oferta técnica de un anexo en blanco) siguen en PDF.
const TIPO = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' } as const;

/** Sube el archivo y lo deja en Documentos › Anexos Técnicos. Misma regla que los anexos generados: la caja se pone al
 *  crear; si alguien lo movió a mano, regenerar no se lo cambia. */
async function guardarEnAnexosTecnicos(licitacionCodigo: string, f: FichaArmada, usuarioId: number): Promise<FichaPropiaGenerada> {
  const tipo = TIPO[f.formato];
  const url = await subirDocumentoR2(licitacionCodigo, f.nombre, f.archivo, tipo);
  await pool.query(
    `INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, subcategoria, usuario_id, cliente_id)
     VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', 'Anexos Técnicos', ?, ?)
     ON DUPLICATE KEY UPDATE documento_url_local = VALUES(documento_url_local), size_bytes = VALUES(size_bytes), content_type = VALUES(content_type), updated_at = CURRENT_TIMESTAMP`,
    [licitacionCodigo, f.nombre, url, f.archivo.length, tipo, usuarioId, f.clienteId]);
  return { url, nombre: f.nombre, productos: f.productos, sinCompletar: f.sinCompletar, fotoSinConfirmar: f.fotoSinConfirmar, sinFoto: f.sinFoto };
}

export async function generarFichaPropia(negocioId: number, licitacionCodigo: string, opcionIds: number[], usuarioId: number): Promise<FichaPropiaGenerada> {
  return guardarEnAnexosTecnicos(licitacionCodigo, await armarFichaPropia(negocioId, licitacionCodigo, opcionIds, usuarioId), usuarioId);
}

/** El botón de una opción arma la ficha de TODA su línea (ver opcionesDeLaLinea); `faltan` = ítems de la línea que no entraron. */
export async function generarFichaPropiaDeLinea(negocioId: number, licitacionCodigo: string, opcionId: number, usuarioId: number): Promise<FichaPropiaGenerada & { faltan: string[] }> {
  const { ids, faltan } = opcionesDeLaLinea(await armarPanelAuditor(negocioId, licitacionCodigo), opcionId);
  return { ...(await generarFichaPropia(negocioId, licitacionCodigo, ids, usuarioId)), faltan };
}

// ── Anexo técnico EN BLANCO del organismo («ANEXO TÉCNICO 3 · OFERTA TÉCNICA», 4022-19-LE26) ─────────────────────────
// El organismo solo pone el título y espera que el oferente adjunte su oferta técnica. Se completa con nuestra ficha
// desde el Auditor, con el título de ESE anexo. Un anexo que trae su propio formulario (tablas, casillas) no es este
// caso: se rechaza para no perder su contenido, y se llena con el relleno normal.
const LARGO_MAX_ANEXO_EN_BLANCO = 400;

/** Títulos del anexo en blanco (primer párrafo y el resto como subtítulo), o el motivo por el que no es uno. */
export async function encabezadoDeAnexoEnBlanco(licitacionCodigo: string, documentoId: string): Promise<{ titulo: string; subtitulo: string | null; nombre: string } | { error: string }> {
  const { bufferOriginal, nombreOriginal } = await cargarDocumentoBase(licitacionCodigo, documentoId);
  let xml: string;
  try { ({ xml } = await abrirDocx(bufferOriginal)); }
  catch { return { error: 'Solo se completan anexos en Word (.docx).' }; }
  const parrafos = xml.split('</w:p>').map(p => p.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const texto = parrafos.join(' ');
  if (/<w:tbl[ >]/.test(xml) || texto.length > LARGO_MAX_ANEXO_EN_BLANCO || !/t[eé]cnic/i.test(texto))
    return { error: 'Este anexo trae su propio formulario: se llena con «Rellenar anexo», no con la oferta técnica del Auditor.' };
  return { titulo: parrafos[0] || 'Oferta técnica', subtitulo: parrafos.slice(1).join(' · ') || null, nombre: nombreOriginal };
}

export async function armarOfertaTecnicaDeAnexo(negocioId: number, licitacionCodigo: string, documentoId: string, usuarioId: number) {
  const enc = await encabezadoDeAnexoEnBlanco(licitacionCodigo, documentoId);
  if ('error' in enc) throw new Error(enc.error);
  const { ids, faltan } = opcionesDeLaOferta(await armarPanelAuditor(negocioId, licitacionCodigo));
  if (!ids.length) throw new Error(`Ninguna línea tiene todavía su opción lista en el Auditor (lo técnico todo cumplido)${faltan.length ? `: ${faltan.join('; ')}` : ''}.`);
  // Un ANEXO queda en PDF (dueño, 27-oct-2026): solo nuestra ficha técnica va en Word.
  const f = await armarFichaPropia(negocioId, licitacionCodigo, ids, usuarioId, { titulo: enc.titulo, subtitulo: enc.subtitulo }, 'pdf');
  return { ...f, nombre: `ANEXO_${enc.nombre.replace(/\.(docx?|pdf)$/i, '')}.pdf`, faltan };
}

export async function generarOfertaTecnicaDeAnexo(negocioId: number, licitacionCodigo: string, documentoId: string, usuarioId: number): Promise<FichaPropiaGenerada & { faltan: string[] }> {
  const f = await armarOfertaTecnicaDeAnexo(negocioId, licitacionCodigo, documentoId, usuarioId);
  return { ...(await guardarEnAnexosTecnicos(licitacionCodigo, f, usuarioId)), faltan: f.faltan };
}

/** Arma el Word sin guardarlo (lo usa generarFichaPropia y sirve para revisarlo antes). */
export async function armarFichaPropia(negocioId: number, licitacionCodigo: string, opcionIds: number[], usuarioId: number,
  encabezado?: { titulo: string; subtitulo: string | null }, formato: 'docx' | 'pdf' = 'docx') {
  if (!opcionIds.length) throw new Error('Elige al menos una opción.');
  const [panel, costeo] = await Promise.all([armarPanelAuditor(negocioId, licitacionCodigo), cargarEstadoCosteo(negocioId)]);
  const fotoPorFila = new Map<string, string>();
  for (const g of costeo?.grupos || []) for (const f of g.filas || []) if (f.imagenUrl) fotoPorFila.set(f.id, f.imagenUrl);

  const lineas: LineaFicha[] = [];
  for (const id of opcionIds) {
    const l = panel.lineas.find(x => x.opciones.some(o => o.id === id));
    const o = l?.opciones.find(x => x.id === id);
    if (!l || !o) throw new Error('Esa opción no está en el Auditor de este negocio.');
    const motivo = motivoFichaNoLista(o);
    if (motivo) throw new Error(`${[o.marca, o.modelo].filter(Boolean).join(' ') || 'La opción'}: ${motivo}`);
    const pdfs = (tipo: string) => o.respaldos.filter(r => r.tipo === tipo && r.vigente && r.documentoUrl && /\.pdf($|\?)/i.test(r.documentoUrl)).map(r => r.documentoUrl as string);
    const fichas = pdfs('ficha_tecnica');
    const fotos = await fotosDeOpcion([o.fotoFicha?.url, fotoPorFila.get(l.filaId)], fichas.length ? fichas : pdfs('cotizacion_formal'));
    const producto = productoFichaDeOpcion(o, l, fotos.principal, fotos.extra);
    const existente = lineas.find(x => x.linea === l.lineaReal && x.titulo === producto.nombre);
    if (existente) existente.productos.push(producto);
    else lineas.push({ linea: l.lineaReal, titulo: producto.nombre, productos: [producto] });
  }
  await nombrarCaracteristicasConIA(lineas.flatMap(x => x.productos.flatMap(p => p.especificaciones)));

  const [[neg]] = await pool.query(
    `SELECT n.empresa_id, n.cliente_id, lc.nombre AS licitacion_nombre, lc.organismo
       FROM negocios n LEFT JOIN licitaciones_cache lc ON lc.codigo = n.licitacion_codigo WHERE n.id = ? LIMIT 1`, [negocioId]) as any;
  if (!neg?.empresa_id) throw new Error('El negocio no tiene empresa asignada: asígnala en «Información Comercial».');
  const [[emp]] = await pool.query(
    `SELECT razon_social, rut, giro, direccion, email1, telefono1, representante_nombre, representante_rut, representante_cargo, logo_url, firma_url, timbre_url
       FROM empresas WHERE id = ? LIMIT 1`, [neg.empresa_id]) as any;
  if (!emp) throw new Error('No se encontró la empresa del negocio.');
  const [logo, firma, timbre] = await Promise.all([comoDataUri(emp.logo_url), comoDataUri(emp.firma_url), comoDataUri(emp.timbre_url)]);
  const empresa: EmpresaFicha = {
    razonSocial: String(emp.razon_social || ''), rut: emp.rut ?? null, giro: emp.giro ?? null, direccion: emp.direccion ?? null,
    email: emp.email1 ?? null, telefono: emp.telefono1 ?? null,
    representanteNombre: emp.representante_nombre ?? null, representanteRut: emp.representante_rut ?? null, representanteCargo: emp.representante_cargo ?? null,
    logoDataUri: logo, firmaDataUri: firma, timbreDataUri: timbre,
  };
  const [[u]] = await pool.query(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [usuarioId]) as any;

  const datos = {
    licitacionCodigo, licitacionNombre: neg.licitacion_nombre ?? null, organismo: neg.organismo ?? null,
    empresa, lineas, generadoPor: u?.nombre ?? null,
    fechaTexto: new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric' }),
    titulo: encabezado?.titulo, subtitulo: encabezado?.subtitulo,
  };
  const archivo = formato === 'docx' ? await construirFichaTecnicaDocx(datos) : await generarInformePdf(construirFichaTecnicaHtml(datos));
  const lineasTxt = [...new Set(lineas.map(x => x.linea).filter(n => n != null))].join('-');
  const nombre = `FICHA_TECNICA_${licitacionCodigo}${lineasTxt ? `_L${lineasTxt}` : ''}.${formato}`;
  return {
    archivo, nombre, formato, clienteId: Number(neg.cliente_id ?? 1), productos: lineas.reduce((n, x) => n + x.productos.length, 0),
    sinCompletar: especificacionesSinCompletar(lineas), fotoSinConfirmar: productosSinConfirmar(lineas),
    sinFoto: lineas.reduce((n, x) => n + x.productos.filter(pr => !pr.imagenDataUri).length, 0),
  };
}

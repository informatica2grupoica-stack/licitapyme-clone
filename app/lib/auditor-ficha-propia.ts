// app/lib/auditor-ficha-propia.ts
// Genera NUESTRA ficha técnica (PDF) desde el Auditor — ver auditor-ficha-propia-core.ts para el criterio.
// Una ficha por opción pedida (una por producto), con logo, firma y timbre de la empresa del negocio. Queda
// en Documentos Propios, caja «Anexos Técnicos» (no en «fichas_tecnicas»: esa caja es de las fichas de los
// PROVEEDORES y el Auditor las compararía como si fueran una más).
import pool from '@/app/lib/db';
import { armarPanelAuditor, cargarEstadoCosteo } from '@/app/lib/auditor-opciones';
import { motivoFichaNoLista, productoFichaDeOpcion } from '@/app/lib/auditor-ficha-propia-core';
import { construirFichaTecnicaHtml, especificacionesSinCompletar, productosSinConfirmar, type EmpresaFicha, type LineaFicha } from '@/app/lib/ficha-tecnica';
import { extraerImagenProducto } from '@/app/lib/ficha-imagen-extraer';
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

/** Foto del producto: la que una persona subió a la fila del costeo; si no hay, la que se saca de la ficha del proveedor. */
async function imagenDeOpcion(fotoCosteo: string | null, fichasPdf: string[]): Promise<{ dataUri: string; puestaPorPersona: boolean } | null> {
  const propia = await comoDataUri(fotoCosteo);
  if (propia) return { dataUri: propia, puestaPorPersona: true };
  for (const url of fichasPdf) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const img = await extraerImagenProducto(Buffer.from(await r.arrayBuffer()));
      if (img) return { dataUri: `data:image/png;base64,${img.png.toString('base64')}`, puestaPorPersona: false };
    } catch { /* sigue con la próxima ficha */ }
  }
  return null;
}

export interface FichaPropiaGenerada { url: string; nombre: string; productos: number; sinCompletar: number; fotoSinConfirmar: number }

export async function generarFichaPropia(negocioId: number, licitacionCodigo: string, opcionIds: number[], usuarioId: number): Promise<FichaPropiaGenerada> {
  const f = await armarFichaPropiaPdf(negocioId, licitacionCodigo, opcionIds, usuarioId);
  const url = await subirDocumentoR2(licitacionCodigo, f.nombre, f.pdf, 'application/pdf');
  // Misma regla que los anexos generados: la caja se pone al crear; si alguien lo movió a mano, regenerar no se lo cambia.
  await pool.query(
    `INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, subcategoria, usuario_id, cliente_id)
     VALUES (?, ?, ?, ?, 'application/pdf', 'DOCUMENTOS_PROPIOS', 'Anexos Técnicos', ?, ?)
     ON DUPLICATE KEY UPDATE documento_url_local = VALUES(documento_url_local), size_bytes = VALUES(size_bytes), updated_at = CURRENT_TIMESTAMP`,
    [licitacionCodigo, f.nombre, url, f.pdf.length, usuarioId, f.clienteId]);
  return { url, nombre: f.nombre, productos: f.productos, sinCompletar: f.sinCompletar, fotoSinConfirmar: f.fotoSinConfirmar };
}

/** Arma el PDF sin guardarlo (lo usa generarFichaPropia y sirve para revisarlo antes). */
export async function armarFichaPropiaPdf(negocioId: number, licitacionCodigo: string, opcionIds: number[], usuarioId: number) {
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
    const fichas = o.respaldos.filter(r => r.tipo === 'ficha_tecnica' && r.vigente && r.documentoUrl).map(r => r.documentoUrl as string);
    const producto = productoFichaDeOpcion(o, l, await imagenDeOpcion(fotoPorFila.get(l.filaId) ?? null, fichas));
    const existente = lineas.find(x => x.linea === l.lineaReal && x.titulo === producto.nombre);
    if (existente) existente.productos.push(producto);
    else lineas.push({ linea: l.lineaReal, titulo: producto.nombre, productos: [producto] });
  }

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

  const html = construirFichaTecnicaHtml({
    licitacionCodigo, licitacionNombre: neg.licitacion_nombre ?? null, organismo: neg.organismo ?? null,
    empresa, lineas, generadoPor: u?.nombre ?? null,
    fechaTexto: new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric' }),
  });
  const pdf = await generarInformePdf(html);
  const lineasTxt = [...new Set(lineas.map(x => x.linea).filter(n => n != null))].join('-');
  const nombre = `FICHA_TECNICA_${licitacionCodigo}${lineasTxt ? `_L${lineasTxt}` : ''}.pdf`;
  return {
    pdf, nombre, clienteId: Number(neg.cliente_id ?? 1), productos: lineas.reduce((n, x) => n + x.productos.length, 0),
    sinCompletar: especificacionesSinCompletar(lineas), fotoSinConfirmar: productosSinConfirmar(lineas),
  };
}

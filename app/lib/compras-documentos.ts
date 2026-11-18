// app/lib/compras-documentos.ts
// GESTIONAR DOCUMENTOS (pedido del dueño 13-nov-2026): en los negocios de una empresa que tenga plantillas (hoy Comercial MP) hay un
// paso «Documentos» donde se generan certificados, actas y otros documentos desde PLANTILLAS con campos que se llenan solos
// (licitación, organismo, empresa) y campos que se escriben (equipo, ciudad, fecha) + una página por persona cuando corresponde.
// Las plantillas son por empresa (empresa_rut): ninguna empresa nueva ve nada hasta que tenga plantillas. Las tablas se crean solas
// (misma regla que anexos_feedback) y el SQL queda en docs/migration-194-compras-documentos.sql.
// La guía de despacho (SimpleAPI) queda para cuando estén el certificado digital y los folios (ver docs/memoria/compras.md).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { generarInformePdf } from '@/app/lib/generar-informe';
import { logoDeEmpresaPorRut } from '@/app/lib/compras-oc-propia';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { clienteDeNegocio } from '@/app/lib/tenant';
import { listarProductosCompra } from '@/app/lib/compras';
import { esSubestadoFuera } from '@/app/lib/compras-no-adjudicadas';
import fs from 'fs';
import path from 'path';

import { armarHtml, fechaLarga, derivarCampos, HOJA_MM, type LayoutDoc, type ElementoLayout, type TipoElemento, type CampoPlantilla, type Plantilla, type DocumentoGenerado, type ContextoDocumento, type PersonaDoc } from '@/app/lib/compras-documentos-render';
export type { CampoPlantilla, Plantilla, DocumentoGenerado, ContextoDocumento, PersonaDoc };
export { fechaLarga, armarHtml };

const rutComparable = (r: string | null | undefined) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

let tablasListas = false;
async function asegurarTablas() {
  if (tablasListas) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_doc_plantilla (
    id INT AUTO_INCREMENT PRIMARY KEY, empresa_rut VARCHAR(20) NOT NULL, clave VARCHAR(60) NOT NULL, nombre VARCHAR(200) NOT NULL,
    descripcion VARCHAR(400) NULL, por_persona TINYINT(1) NOT NULL DEFAULT 0, campos_json TEXT NOT NULL, cuerpo_html MEDIUMTEXT NOT NULL,
    activa TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL, UNIQUE KEY uq_empresa_clave (empresa_rut, clave)
  ) DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_doc_generado (
    id INT AUTO_INCREMENT PRIMARY KEY, negocio_id INT NOT NULL, plantilla_id INT NOT NULL, titulo VARCHAR(300) NOT NULL,
    datos_json MEDIUMTEXT NOT NULL, creado_por INT NULL, creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, KEY ix_negocio (negocio_id)
  ) DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_doc_logo (
    id INT AUTO_INCREMENT PRIMARY KEY, cliente_id INT NOT NULL, nombre VARCHAR(120) NOT NULL, url VARCHAR(600) NOT NULL, archivo VARCHAR(200) NULL,
    creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, KEY ix_cliente (cliente_id)
  ) DEFAULT CHARSET=utf8mb4`);
  tablasListas = true;
}

// Plantilla base tomada del certificado de capacitación de Hualpén (4152-22-LE26). {{campo}} = lo escrito; {{nombre}}/{{rut}} = la persona.
const CERTIFICADO_CAPACITACION: Omit<Plantilla, 'id'> = {
  clave: 'certificado-capacitacion', nombre: 'Certificado de capacitación', porPersona: true,
  descripcion: 'Una página por persona capacitada, con los contenidos vistos y la licitación.',
  campos: [
    { clave: 'logo_izq', etiqueta: 'Logo de la izquierda', donde: 'Arriba a la izquierda.', tipo: 'logo', valorPorDefecto: 'empresa' },
    { clave: 'logo_der', etiqueta: 'Logo de la derecha (opcional)', donde: 'Arriba a la derecha, sobre el nombre de la empresa.', tipo: 'logo', valorPorDefecto: '' },
    { clave: 'titulo_equipo', etiqueta: 'Subtítulo', donde: 'Aparece bajo el título «CAPACITACIÓN».', tipo: 'texto', ayuda: 'Ej.: Rodillo Compactador Tecnomaq Modelo D75E-1' },
    { clave: 'equipo', etiqueta: 'Qué equipo se capacitó', donde: 'Va en la frase «ha recibido capacitación sobre …».', tipo: 'texto', ayuda: 'Ej.: el rodillo compactador Tecnomaq D75E-1' },
    { clave: 'nombre_licitacion', etiqueta: 'Nombre de la licitación', donde: 'Va entre comillas junto al ID de la licitación.', tipo: 'texto', ayuda: 'Ej.: Rodillo Compactador y Sonda Vibradora' },
    { clave: 'unidad', etiqueta: 'Quién compró (opcional)', donde: 'Cierra la frase: «… de la Municipalidad de …».', tipo: 'texto', ayuda: 'Ej.: la Municipalidad de Hualpén, Dirección de Tránsito' },
    { clave: 'contenidos', etiqueta: 'Contenidos vistos (uno por línea)', donde: 'Sale como lista con viñetas bajo la frase.', tipo: 'lista', valorPorDefecto: ['Reconocimiento general del equipo y sus componentes.', 'Procedimiento de encendido y apagado.', 'Uso y operación del equipo.', 'Explicación de sus funciones y controles operacionales.', 'Orientación sobre aspectos técnicos básicos y funcionamiento del equipo.', 'Recomendaciones para una correcta operación y uso del equipo.'].join('\n') },
    { clave: 'ciudad', etiqueta: 'Ciudad', donde: 'Va junto a la fecha, arriba de la firma.', tipo: 'texto', ayuda: 'Ej.: Hualpén' },
    { clave: 'fecha', etiqueta: 'Fecha de la capacitación', donde: 'Se escribe en letras: «9 de noviembre de 2026».', tipo: 'fecha' },
  ],
  cuerpoHtml: `<div class="marco">
<div class="cab"><div class="logo">{{logo_izq}}</div><div class="emp">{{logo_der}}{{emp_der}}RUT {{rut_empresa}}</div></div>
<div class="titulo"><span class="sup">Certificado de</span><span class="gran">CAPACITACIÓN</span><span class="sub">{{titulo_equipo}}</span></div>
<p class="otorga">Se certifica que</p>
<p class="nombre">{{nombre}}</p><p class="rutp">RUT {{rut}}</p>
<p class="cuerpo">ha recibido capacitación sobre {{equipo}}, en el marco de la licitación ID <b>{{licitacion_codigo}}</b> “{{nombre_licitacion}}”{{unidad_de}}. La capacitación abordó los siguientes contenidos:</p>
{{contenidos}}
<p class="lugar">{{ciudad}}, {{fecha_larga}}</p>
<div class="firma"><div class="fw">{{firma_img}}{{timbre_img}}</div><div class="linea"></div><b>{{representante}}</b><br>{{representante_cargo}}<br>{{empresa}}</div>
</div>`,
};
// Acta de entrega tomada del acta firmada por la Municipalidad de Concepción (2415-19-LE26, 9-nov-2026). Los logos se eligen del banco de logos
// (en el acta firmada: Tecnomaq a la izquierda, empresa al centro, Grupo ICA / logo de la empresa a la derecha). Recepción conforme (nombre, RUT, cargo, fecha, firma) queda en blanco: lo llena quien recibe.
const ACTA_ENTREGA: Omit<Plantilla, 'id'> = {
  clave: 'acta-entrega', nombre: 'Acta de entrega', porPersona: false,
  descripcion: 'Acta con el detalle de lo entregado, guía de despacho y recepción conforme para firmar.',
  campos: [
    { clave: 'logo_izq', etiqueta: 'Logo de la izquierda', donde: 'Arriba a la izquierda.', tipo: 'logo', valorPorDefecto: '' },
    { clave: 'logo_centro', etiqueta: 'Logo del centro (opcional)', donde: 'Arriba al centro, sobre el nombre de la empresa.', tipo: 'logo', valorPorDefecto: '' },
    { clave: 'logo_der', etiqueta: 'Logo de la derecha', donde: 'Arriba a la derecha.', tipo: 'logo', valorPorDefecto: 'empresa' },
    { clave: 'oc', etiqueta: 'Licitación OC', donde: 'Sale arriba a la izquierda, bajo «Licitación OC».', tipo: 'texto', ayuda: 'Ej.: 2415-283-SE26' },
    { clave: 'unidad_compra', etiqueta: 'Unidad de compra', donde: 'Segunda caja bajo el título «ACTA DE ENTREGA».', tipo: 'texto', ayuda: 'Ej.: IMUNI Concepción Adquisiciones' },
    { clave: 'fecha', etiqueta: 'Fecha del acta', donde: 'Sale arriba a la derecha.', tipo: 'fecha' },
    { clave: 'categoria', etiqueta: 'Tipo de artículos', donde: 'Título sobre la tabla.', tipo: 'texto', ayuda: 'Ej.: Materiales de construcción' },
    { clave: 'items', etiqueta: 'Artículos entregados (uno por línea)', donde: 'Cada línea es una fila: código | cantidad | formato | detalle. La columna «Recibido Sí/No» queda en blanco.', tipo: 'tabla', columnas: ['Items', 'Cantidad', 'Formato', 'Detalle producto', 'Recibido Sí/No'], filasMin: 5, ayuda: '60264231353 | 500 | SACOS | CEMENTO 25KG SECADO RÁPIDO' },
    { clave: 'guia_despacho', etiqueta: 'Guía de despacho N°', donde: 'Va bajo la tabla.', tipo: 'texto', ayuda: 'Ej.: 1910-1911' },
    { clave: 'pendiente', etiqueta: 'Pendiente de entrega (opcional)', donde: 'Va bajo el ID de licitación.', tipo: 'texto' },
  ],
  cuerpoHtml: `<div class="acta">
<div class="cab2"><div>{{logo_izq}}</div><div class="cen">{{logo_centro}}{{empresa}} {{rut_empresa}}</div><div>{{logo_der}}</div></div>
<div class="bloque1"><div class="izq"><u>Licitación OC</u>{{oc}}<br>Unidad de Compra</div>
<div class="med"><div class="tit">Acta de entrega</div><div class="caja">{{organismo}}</div><div class="caja">{{unidad_compra}}</div></div>
<div class="der">{{fecha_larga}}</div></div>
<div class="sec">A. &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Descripción Artículos :</div>
<div class="cat">{{categoria}}</div>
{{items}}
<div class="datos"><div><b class="k">Guía Despacho N° &nbsp;:</b><span class="val">{{guia_despacho}}</span></div><div><b class="k">ID de Licitación &nbsp;&nbsp;&nbsp;:</b><span class="val">{{licitacion_codigo}}</span></div><div><b class="k">Pendiente de Entrega:</b><span class="val">{{pendiente}}</span></div></div>
<div class="rec"><div style="color:#444">RECEPCIÓN CONFORME:</div>
<div class="fila"><span class="k">NOMBRE</span><span class="raya"></span></div>
<div class="fila"><span class="k">Rut</span><span class="raya" style="max-width:200px"></span></div>
<div class="fila"><span class="k">OBSERVACIONES:</span><span class="raya"></span></div>
<div class="fila"><span class="k">Cargo</span><span class="raya" style="max-width:260px"></span><span class="fr">Fecha Recepcion: ____/____/____</span></div></div>
</div>`,
};
const PLANTILLAS_BASE = [CERTIFICADO_CAPACITACION, ACTA_ENTREGA];
/** Empresas que reciben las plantillas base (por RUT, como EMISORES_PROPIOS). Las demás empiezan sin plantillas = sin el paso. */
const EMPRESAS_CON_BASE = new Set(['783881756', '769026592']); // Comercial MP e Inversiones Claro

/** Imagen como data URI para incrustarla en el HTML del PDF (el navegador que imprime no debe salir a internet). */
async function imagenComoUri(origen: string | null | undefined, local = false): Promise<string | null> {
  if (!origen) return null;
  try {
    let buf: Buffer; let ext = origen.split('?')[0].split('.').pop()?.toLowerCase() || 'png';
    if (local) buf = fs.readFileSync(path.join(process.cwd(), 'public', origen));
    else { const r = await fetch(origen, { signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 6_000_000) return null; }
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

/** Lo ya sabido de la entrega para llenar el acta: un artículo por línea (SKU | cantidad | formato | detalle) y el N° de la guía de despacho. */
async function entregaSugerida(negocioId: number): Promise<{ items: string; guiaDespacho: string }> {
  try {
    const productos = (await listarProductosCompra(negocioId)).filter(p => !esSubestadoFuera(p.subestado) && !p.esServicio);
    const [skus] = await pool.query('SELECT producto_id, sku_propio FROM compras_sku WHERE negocio_id = ? ORDER BY id', [negocioId]) as any;
    const skuDe = new Map<number, string>(); for (const r of skus as any[]) if (r.sku_propio && !skuDe.has(r.producto_id)) skuDe.set(r.producto_id, String(r.sku_propio));
    const limpia = (t: unknown) => String(t ?? '').replace(/[|\r\n]+/g, ' ').trim();
    const items = productos.map(p => [skuDe.get(p.id) || '', p.cantidad ?? '', limpia(p.unidad), limpia(p.descripcion)].join(' | ')).join('\n');
    const [g] = await pool.query('SELECT guia_despacho_numero FROM compras_entrega WHERE negocio_id = ? LIMIT 1', [negocioId]) as any;
    return { items, guiaDespacho: String((g as any[])[0]?.guia_despacho_numero || '') };
  } catch { return { items: '', guiaDespacho: '' }; }
}

async function empresaDelNegocio(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT e.razon_social, e.rut, e.logo_url, e.logo_nombre, e.firma_url, e.timbre_url, e.representante_nombre, e.representante_rut, e.representante_cargo, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo
       FROM negocios n JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0] as { razon_social: string; rut: string; logo_url: string | null; logo_nombre: string | null; firma_url: string | null; timbre_url: string | null; representante_nombre: string | null; representante_rut: string | null; representante_cargo: string | null; licitacion_codigo: string | null; licitacion_nombre: string | null; licitacion_organismo: string | null } | undefined;
}

function filaAPlantilla(r: any): Plantilla {
  let campos: CampoPlantilla[] = []; try { campos = JSON.parse(r.campos_json || '[]'); } catch { /* sin campos */ }
  // Plantilla hecha en el editor: el cuerpo es el JSON del diseño (las escritas a mano en el código guardan HTML).
  let layout: LayoutDoc | null = null;
  if (String(r.cuerpo_html || '').startsWith('{')) { try { layout = JSON.parse(r.cuerpo_html); } catch { layout = null; } }
  return { id: r.id, clave: r.clave, nombre: r.nombre, descripcion: r.descripcion, porPersona: !!r.por_persona, campos, cuerpoHtml: layout ? '' : r.cuerpo_html, layout, editable: String(r.clave).startsWith('custom-') && !!layout };
}

export async function plantillasDelNegocio(negocioId: number): Promise<{ habilitado: boolean; plantillas: Plantilla[]; contexto: ContextoDocumento | null }> {
  await asegurarTablas();
  const e = await empresaDelNegocio(negocioId);
  if (!e) return { habilitado: false, plantillas: [], contexto: null };
  const rut = rutComparable(e.rut);
  if (EMPRESAS_CON_BASE.has(rut)) {
    for (const p of PLANTILLAS_BASE) {
      await pool.query(
        `INSERT INTO compras_doc_plantilla (empresa_rut, clave, nombre, descripcion, por_persona, campos_json, cuerpo_html, created_at) VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), descripcion = VALUES(descripcion), por_persona = VALUES(por_persona), campos_json = VALUES(campos_json), cuerpo_html = VALUES(cuerpo_html)`,
        [rut, p.clave, p.nombre, p.descripcion, p.porPersona ? 1 : 0, JSON.stringify(p.campos), p.cuerpoHtml, ahoraChileSQL()]);
    }
  }
  const [rows] = await pool.query(`SELECT * FROM compras_doc_plantilla WHERE empresa_rut = ? AND activa = 1 ORDER BY id`, [rut]) as any;
  const plantillas = (rows as any[]).map(filaAPlantilla);
  const logoEmpresa = (/timbre/i.test(`${e.logo_nombre || ''} ${e.logo_url || ''}`) ? null : await imagenComoUri(e.logo_url)) || (await imagenComoUri(logoDeEmpresaPorRut(e.rut), true));
  const banco = await listarLogos(await clienteDeNegocio(negocioId));
  const logos: Record<string, string> = {}; if (logoEmpresa) logos.empresa = logoEmpresa;
  for (const l of banco) logos['b' + l.id] = l.url;
  const logosOpciones = [{ clave: '', nombre: 'Ninguno' }, { clave: 'empresa', nombre: `Logo de la empresa (${e.razon_social})` }, ...banco.map(l => ({ clave: 'b' + l.id, nombre: l.nombre }))];
  return {
    habilitado: plantillas.length > 0, plantillas,
    contexto: {
      logos, logosOpciones,
      representante: e.representante_nombre || '', representanteRut: e.representante_rut || '', representanteCargo: e.representante_cargo || '',
      // Logo, firma y timbre son los cargados en la ficha de la empresa (Mi empresa). Si el «logo» cargado es en realidad la foto del timbre
      // (pasó con Comercial MP) no sirve de encabezado: se usa el logo del sistema hasta que suban el verdadero.
      logoUri: (/timbre/i.test(`${e.logo_nombre || ''} ${e.logo_url || ''}`) ? null : await imagenComoUri(e.logo_url)) || (await imagenComoUri(logoDeEmpresaPorRut(e.rut), true)),
      timbreUri: await imagenComoUri(e.timbre_url),
      firmaUri: await imagenComoUri(e.firma_url),
      empresa: e.razon_social, rutEmpresa: e.rut, licitacionCodigo: e.licitacion_codigo || '', licitacionNombre: e.licitacion_nombre || '', organismo: e.licitacion_organismo || '', hoy: ahoraChileSQL().slice(0, 10), entregaSugerida: await entregaSugerida(negocioId) },
  };
}

export async function generarDocumento(negocioId: number, plantillaId: number, valores: Record<string, string>, personas: PersonaDoc[], user: { id: number | null; nombre: string | null }): Promise<number> {
  const { habilitado, plantillas, contexto } = await plantillasDelNegocio(negocioId);
  const p = plantillas.find(x => x.id === plantillaId);
  if (!habilitado || !p || !contexto) throw new Error('Esa plantilla no está disponible para este negocio.');
  const limpias = personas.map(x => ({ nombre: String(x.nombre || '').trim(), rut: String(x.rut || '').trim() })).filter(x => x.nombre);
  if (p.porPersona && limpias.length === 0) throw new Error('Agrega al menos una persona con su nombre.');
  const titulo = p.porPersona ? `${p.nombre} (${limpias.length} ${limpias.length === 1 ? 'persona' : 'personas'})` : p.nombre;
  const [res] = await pool.query(
    `INSERT INTO compras_doc_generado (negocio_id, plantilla_id, titulo, datos_json, creado_por, creado_por_nombre, created_at) VALUES (?,?,?,?,?,?,?)`,
    [negocioId, p.id, titulo, JSON.stringify({ valores, personas: limpias }), user.id, user.nombre, ahoraChileSQL()]) as any;
  return res.insertId as number;
}

// Los documentos generados no cambian: el PDF se guarda en memoria (hasta 40) porque cada miniatura de la pantalla lo pide y armarlo abre un navegador.
const cachePdf = new Map<string, { pdf: Buffer; nombre: string }>();
export async function pdfDeDocumento(negocioId: number, docId: number): Promise<{ pdf: Buffer; nombre: string }> {
  const clave = negocioId + ":" + docId;
  const hit = cachePdf.get(clave); if (hit) return hit;
  await asegurarTablas();
  const [rows] = await pool.query(`SELECT * FROM compras_doc_generado WHERE id = ? AND negocio_id = ? LIMIT 1`, [docId, negocioId]) as any;
  const r = (rows as any[])[0]; if (!r) throw new Error('Ese documento no es de este negocio.');
  const { plantillas, contexto } = await plantillasDelNegocio(negocioId);
  // Una plantilla que se quitó de la lista sigue sirviendo para regenerar los documentos que ya hizo.
  let p = plantillas.find(x => x.id === r.plantilla_id);
  if (!p) { const [pr] = await pool.query('SELECT * FROM compras_doc_plantilla WHERE id = ? LIMIT 1', [r.plantilla_id]) as any; if ((pr as any[])[0]) p = filaAPlantilla((pr as any[])[0]); }
  if (!p || !contexto) throw new Error('La plantilla de este documento ya no está disponible.');
  const datos = JSON.parse(r.datos_json) as { valores: Record<string, string>; personas: PersonaDoc[] };
  // El navegador que imprime no sale a internet: los logos del banco que usa este documento se incrustan.
  const logos = { ...(contexto.logos || {}) };
  for (const campo of p.campos) {
    if (campo.tipo !== 'logo') continue;
    const sel = datos.valores[campo.clave] ?? campo.valorPorDefecto ?? '';
    if (/^b\d+$/.test(sel) && logos[sel]) { const uri = await imagenComoUri(logos[sel]); if (uri) logos[sel] = uri; else delete logos[sel]; }
  }
  const pdf = await generarInformePdf(armarHtml(p, datos.valores, { ...contexto, logos }, datos.personas), { sinMargen: !!p.layout });
  const res = { pdf, nombre: `${p.clave}-${contexto.licitacionCodigo || negocioId}.pdf` };
  cachePdf.set(clave, res); if (cachePdf.size > 40) cachePdf.delete(cachePdf.keys().next().value as string);
  return res;
}

export async function historialDocumentos(negocioId: number): Promise<DocumentoGenerado[]> {
  await asegurarTablas();
  const [rows] = await pool.query(
    `SELECT g.id, g.plantilla_id, g.titulo, g.datos_json, g.creado_por_nombre, DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, p.nombre AS plantilla_nombre
       FROM compras_doc_generado g LEFT JOIN compras_doc_plantilla p ON p.id = g.plantilla_id WHERE g.negocio_id = ? ORDER BY g.id DESC`, [negocioId]) as any;
  return (rows as any[]).map(r => {
    let n = 0; try { n = (JSON.parse(r.datos_json).personas || []).length; } catch { /* sin personas */ }
    return { id: r.id, plantillaId: r.plantilla_id, plantillaNombre: r.plantilla_nombre || '', titulo: r.titulo, personas: n, creadoPor: r.creado_por_nombre, createdAt: String(r.created_at) };
  });
}

/** Borra un documento generado (solo del propio negocio) y suelta su PDF de la memoria. */
export async function eliminarDocumento(negocioId: number, docId: number): Promise<void> {
  await asegurarTablas();
  const [res] = await pool.query(`DELETE FROM compras_doc_generado WHERE id = ? AND negocio_id = ?`, [docId, negocioId]) as any;
  if (!res.affectedRows) throw new Error('Ese documento no es de este negocio.');
  cachePdf.delete(negocioId + ':' + docId);
}

// ── Banco de logos (por cliente): cualquier logo que el equipo quiera poner en certificados, actas y otros documentos ──────────────────
export interface LogoBanco { id: number; nombre: string; url: string }
const MIME_LOGO = /\.(png|jpe?g|webp)$/i;

export async function listarLogos(clienteId: number): Promise<LogoBanco[]> {
  await asegurarTablas();
  const [rows] = await pool.query('SELECT id, nombre, url FROM compras_doc_logo WHERE cliente_id = ? ORDER BY nombre, id', [clienteId]) as any;
  return rows as LogoBanco[];
}

export async function agregarLogo(clienteId: number, nombre: string, archivo: { name: string; type: string; buffer: Buffer }, userNombre: string | null): Promise<number> {
  await asegurarTablas();
  const limpio = nombre.trim().slice(0, 120); if (!limpio) throw new Error('Ponle un nombre al logo (por ejemplo: Tecnomaq).');
  if (!MIME_LOGO.test(archivo.name)) throw new Error('El logo debe ser una imagen PNG, JPG o WEBP.');
  if (archivo.buffer.length > 5_000_000) throw new Error('El logo pesa más de 5 MB.');
  const url = await subirDocumentoR2('logos-docs/c' + clienteId, archivo.name, archivo.buffer, archivo.type);
  const [res] = await pool.query('INSERT INTO compras_doc_logo (cliente_id, nombre, url, archivo, creado_por_nombre, created_at) VALUES (?,?,?,?,?,?)',
    [clienteId, limpio, url, archivo.name.slice(0, 200), userNombre, ahoraChileSQL()]) as any;
  return res.insertId as number;
}

export async function eliminarLogo(clienteId: number, id: number): Promise<void> {
  await asegurarTablas();
  const [res] = await pool.query('DELETE FROM compras_doc_logo WHERE id = ? AND cliente_id = ?', [id, clienteId]) as any;
  if (!res.affectedRows) throw new Error('Ese logo no es de tu empresa.');
}

// ── Editor de plantillas ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const TIPOS_ELEMENTO: TipoElemento[] = ['texto', 'logo', 'linea', 'caja', 'tabla', 'firma'];
const mm = (n: unknown, max: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v * 100) / 100)) : 0; };
const colorOk = (c: unknown) => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : undefined);

/** Deja solo lo que el editor sabe dibujar (nunca HTML ni estilos libres): el diseño viene del navegador y se vuelve a pintar en el PDF. */
export function limpiarLayout(entrada: any): LayoutDoc {
  const lista = Array.isArray(entrada?.elementos) ? entrada.elementos.slice(0, 80) : [];
  const ids = new Set<string>();
  const elementos: ElementoLayout[] = [];
  for (const e of lista) {
    if (!TIPOS_ELEMENTO.includes(e?.tipo)) continue;
    const id = /^[a-z0-9]{3,10}$/.test(String(e.id)) && !ids.has(e.id) ? String(e.id) : Math.random().toString(36).slice(2, 8);
    ids.add(id);
    const el: ElementoLayout = { id, tipo: e.tipo, x: mm(e.x, HOJA_MM.w), y: mm(e.y, HOJA_MM.h), w: Math.max(2, mm(e.w, HOJA_MM.w)), h: Math.max(0, mm(e.h, HOJA_MM.h)) };
    if (e.tipo === 'texto') {
      el.texto = String(e.texto ?? '').slice(0, 3000); el.tam = Math.min(60, Math.max(5, Number(e.tam) || 11));
      el.negrita = !!e.negrita; el.cursiva = !!e.cursiva; el.subrayado = !!e.subrayado; el.serif = !!e.serif;
      el.alinea = ['left', 'center', 'right'].includes(e.alinea) ? e.alinea : 'left'; el.color = colorOk(e.color);
    } else if (e.tipo === 'logo') {
      el.logo = /^(empresa|b\d+)?$/.test(String(e.logo ?? '')) ? String(e.logo ?? '') : ''; el.etiqueta = String(e.etiqueta || 'Logo').slice(0, 80);
    } else if (e.tipo === 'tabla') {
      el.etiqueta = String(e.etiqueta || 'Tabla').slice(0, 80);
      el.columnas = (Array.isArray(e.columnas) ? e.columnas : []).slice(0, 8).map((c: unknown) => String(c ?? '').slice(0, 40));
      if (!el.columnas?.length) el.columnas = ['Detalle']; el.filasMin = Math.min(40, Math.max(0, Math.round(Number(e.filasMin) || 0)));
    } else if (e.tipo === 'linea' || e.tipo === 'caja') {
      el.grosor = Math.min(3, Math.max(0.25, Number(e.grosor) || 0.5)); el.color = colorOk(e.color); if (e.tipo === 'caja') el.relleno = colorOk(e.relleno);
    }
    elementos.push(el);
  }
  return { v: 1, elementos };
}

export async function guardarPlantilla(negocioId: number, d: { id?: number; nombre: string; descripcion?: string; porPersona: boolean; layout: any }): Promise<number> {
  await asegurarTablas();
  const e = await empresaDelNegocio(negocioId); if (!e) throw new Error('Negocio no encontrado.');
  const rut = rutComparable(e.rut);
  const nombre = String(d.nombre || '').trim().slice(0, 200); if (!nombre) throw new Error('Ponle un nombre a la plantilla.');
  const layout = limpiarLayout(d.layout); if (!layout.elementos.length) throw new Error('La hoja está vacía: agrega al menos un elemento.');
  const campos = derivarCampos(layout);
  const descripcion = String(d.descripcion || '').trim().slice(0, 400) || null;
  if (d.id) {
    const [r] = await pool.query("UPDATE compras_doc_plantilla SET nombre = ?, descripcion = ?, por_persona = ?, campos_json = ?, cuerpo_html = ? WHERE id = ? AND empresa_rut = ? AND clave LIKE 'custom-%'",
      [nombre, descripcion, d.porPersona ? 1 : 0, JSON.stringify(campos), JSON.stringify(layout), d.id, rut]) as any;
    if (!r.affectedRows) throw new Error('Esa plantilla no se puede editar.');
    for (const k of [...cachePdf.keys()]) cachePdf.delete(k); // los PDF de esta plantilla se rehacen con el diseño nuevo
    return d.id;
  }
  const [r] = await pool.query('INSERT INTO compras_doc_plantilla (empresa_rut, clave, nombre, descripcion, por_persona, campos_json, cuerpo_html, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [rut, 'custom-' + Date.now().toString(36), nombre, descripcion, d.porPersona ? 1 : 0, JSON.stringify(campos), JSON.stringify(layout), ahoraChileSQL()]) as any;
  return r.insertId as number;
}

/** Se quita de la lista (activa = 0): los documentos que ya se hicieron con ella se pueden seguir viendo. */
export async function eliminarPlantilla(negocioId: number, id: number): Promise<void> {
  await asegurarTablas();
  const e = await empresaDelNegocio(negocioId); if (!e) throw new Error('Negocio no encontrado.');
  const [r] = await pool.query("UPDATE compras_doc_plantilla SET activa = 0 WHERE id = ? AND empresa_rut = ? AND clave LIKE 'custom-%'", [id, rutComparable(e.rut)]) as any;
  if (!r.affectedRows) throw new Error('Esa plantilla no se puede quitar.');
}

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
import fs from 'fs';
import path from 'path';

import { armarHtml, fechaLarga, type CampoPlantilla, type Plantilla, type DocumentoGenerado, type ContextoDocumento, type PersonaDoc } from '@/app/lib/compras-documentos-render';
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
  tablasListas = true;
}

// Plantilla base tomada del certificado de capacitación de Hualpén (4152-22-LE26). {{campo}} = lo escrito; {{nombre}}/{{rut}} = la persona.
const CERTIFICADO_CAPACITACION: Omit<Plantilla, 'id'> = {
  clave: 'certificado-capacitacion', nombre: 'Certificado de capacitación', porPersona: true,
  descripcion: 'Una página por persona capacitada, con los contenidos vistos y la licitación.',
  campos: [
    { clave: 'titulo_equipo', etiqueta: 'Subtítulo', donde: 'Aparece bajo el título «CAPACITACIÓN».', tipo: 'texto', ayuda: 'Ej.: Rodillo Compactador Tecnomaq Modelo D75E-1' },
    { clave: 'equipo', etiqueta: 'Qué equipo se capacitó', donde: 'Va en la frase «ha recibido capacitación sobre …».', tipo: 'texto', ayuda: 'Ej.: el rodillo compactador Tecnomaq D75E-1' },
    { clave: 'nombre_licitacion', etiqueta: 'Nombre de la licitación', donde: 'Va entre comillas junto al ID de la licitación.', tipo: 'texto', ayuda: 'Ej.: Rodillo Compactador y Sonda Vibradora' },
    { clave: 'unidad', etiqueta: 'Quién compró (opcional)', donde: 'Cierra la frase: «… de la Municipalidad de …».', tipo: 'texto', ayuda: 'Ej.: la Municipalidad de Hualpén, Dirección de Tránsito' },
    { clave: 'contenidos', etiqueta: 'Contenidos vistos (uno por línea)', donde: 'Sale como lista con viñetas bajo la frase.', tipo: 'lista', valorPorDefecto: ['Reconocimiento general del equipo y sus componentes.', 'Procedimiento de encendido y apagado.', 'Uso y operación del equipo.', 'Explicación de sus funciones y controles operacionales.', 'Orientación sobre aspectos técnicos básicos y funcionamiento del equipo.', 'Recomendaciones para una correcta operación y uso del equipo.'].join('\n') },
    { clave: 'ciudad', etiqueta: 'Ciudad', donde: 'Va junto a la fecha, arriba de la firma.', tipo: 'texto', ayuda: 'Ej.: Hualpén' },
    { clave: 'fecha', etiqueta: 'Fecha de la capacitación', donde: 'Se escribe en letras: «9 de noviembre de 2026».', tipo: 'fecha' },
  ],
  cuerpoHtml: `<div class="marco">
<div class="cab"><div class="logo">{{logo_img}}</div><div class="emp">{{emp_der}}RUT {{rut_empresa}}</div></div>
<div class="titulo"><span class="sup">Certificado de</span><span class="gran">CAPACITACIÓN</span><span class="sub">{{titulo_equipo}}</span></div>
<p class="otorga">Se certifica que</p>
<p class="nombre">{{nombre}}</p><p class="rutp">RUT {{rut}}</p>
<p class="cuerpo">ha recibido capacitación sobre {{equipo}}, en el marco de la licitación ID <b>{{licitacion_codigo}}</b> “{{nombre_licitacion}}”{{unidad_de}}. La capacitación abordó los siguientes contenidos:</p>
{{contenidos}}
<p class="lugar">{{ciudad}}, {{fecha_larga}}</p>
<div class="firma"><div class="fw">{{firma_img}}{{timbre_img}}</div><div class="linea"></div><b>{{representante}}</b><br>{{representante_cargo}}<br>{{empresa}}</div>
</div>`,
};
const PLANTILLAS_BASE = [CERTIFICADO_CAPACITACION];
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

async function empresaDelNegocio(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT e.razon_social, e.rut, e.logo_url, e.logo_nombre, e.firma_url, e.timbre_url, e.representante_nombre, e.representante_rut, e.representante_cargo, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo
       FROM negocios n JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0] as { razon_social: string; rut: string; logo_url: string | null; logo_nombre: string | null; firma_url: string | null; timbre_url: string | null; representante_nombre: string | null; representante_rut: string | null; representante_cargo: string | null; licitacion_codigo: string | null; licitacion_nombre: string | null; licitacion_organismo: string | null } | undefined;
}

function filaAPlantilla(r: any): Plantilla {
  let campos: CampoPlantilla[] = []; try { campos = JSON.parse(r.campos_json || '[]'); } catch { /* sin campos */ }
  return { id: r.id, clave: r.clave, nombre: r.nombre, descripcion: r.descripcion, porPersona: !!r.por_persona, campos, cuerpoHtml: r.cuerpo_html };
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
  return {
    habilitado: plantillas.length > 0, plantillas,
    contexto: {
      representante: e.representante_nombre || '', representanteRut: e.representante_rut || '', representanteCargo: e.representante_cargo || '',
      // Logo, firma y timbre son los cargados en la ficha de la empresa (Mi empresa). Si el «logo» cargado es en realidad la foto del timbre
      // (pasó con Comercial MP) no sirve de encabezado: se usa el logo del sistema hasta que suban el verdadero.
      logoUri: (/timbre/i.test(`${e.logo_nombre || ''} ${e.logo_url || ''}`) ? null : await imagenComoUri(e.logo_url)) || (await imagenComoUri(logoDeEmpresaPorRut(e.rut), true)),
      timbreUri: await imagenComoUri(e.timbre_url),
      firmaUri: await imagenComoUri(e.firma_url),
      empresa: e.razon_social, rutEmpresa: e.rut, licitacionCodigo: e.licitacion_codigo || '', licitacionNombre: e.licitacion_nombre || '', organismo: e.licitacion_organismo || '', hoy: ahoraChileSQL().slice(0, 10) },
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
  const p = plantillas.find(x => x.id === r.plantilla_id); if (!p || !contexto) throw new Error('La plantilla de este documento ya no está disponible.');
  const datos = JSON.parse(r.datos_json) as { valores: Record<string, string>; personas: PersonaDoc[] };
  const pdf = await generarInformePdf(armarHtml(p, datos.valores, contexto, datos.personas));
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

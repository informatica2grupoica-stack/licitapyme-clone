// app/lib/compras-oc-envio.ts
// «Enviar al proveedor»: manda por correo la OC (la de Obuma o la propia de Comercial MP) en PDF para que el proveedor emita la factura.
// El correo sale con el nombre de quien envía y le responde a esa persona (ver enviarOcAlProveedor en email.ts). Cada envío queda en
// historial_eventos (COMPRAS_OC_ENVIADA_PROVEEDOR, sin destinatario: no va a la campana) y de ahí sale «Enviada el … a …».
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { enviarOcAlProveedor } from '@/app/lib/email';
import { documentoOcObuma, type OcDocumento } from '@/app/lib/compras-oc-documento';
import { documentoOcPropia } from '@/app/lib/compras-oc-propia';
import { generarPdfOc } from '@/app/lib/compras-oc-pdf';

const TIPO = 'COMPRAS_OC_ENVIADA_PROVEEDOR';
const MAX_CORREOS = 6;

/** Cuál OC: por folio (Obuma) o por id (propia de Comercial MP). */
export type FuenteOc = { folio: string } | { ocPropiaId: number };

export interface EnvioOc { fecha: string; por: string | null; para: string[]; cc: string[] }

async function codigoDeNegocio(negocioId: number): Promise<string | null> {
  const [r] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (r as any[])[0]?.licitacion_codigo ?? null;
}

async function cargar(negocioId: number, fuente: FuenteOc): Promise<{ doc: OcDocumento; pdf: () => Promise<Uint8Array>; codigo: string | null }> {
  const codigo = await codigoDeNegocio(negocioId);
  if ('folio' in fuente) {
    const doc = codigo ? await documentoOcObuma(codigo, fuente.folio) : null;
    if (!doc) throw new Error('Esa orden de compra no está en Obuma para esta licitación.');
    return { doc, pdf: () => generarPdfOc(doc), codigo };
  }
  const { doc, logo } = await documentoOcPropia(negocioId, fuente.ocPropiaId);
  return { doc, pdf: () => generarPdfOc(doc, { logo, firma: null }), codigo };
}

/** Separa una lista de correos escrita a mano (comas, punto y coma o espacios) y revisa cada uno. Lanza si alguno está malo. */
export function separarCorreos(texto: string, campo: string): string[] {
  const lista = [...new Set(String(texto || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  const malos = lista.filter(c => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(c));
  if (malos.length) throw new Error(`Correo no válido en «${campo}»: ${malos.join(', ')}`);
  if (lista.length > MAX_CORREOS) throw new Error(`Máximo ${MAX_CORREOS} correos en «${campo}».`);
  return lista;
}

async function enviosAnteriores(codigo: string | null, folio: string): Promise<EnvioOc[]> {
  if (!codigo) return [];
  const [rows] = await pool.query(
    `SELECT created_at, actor_nombre, metadata FROM historial_eventos
      WHERE tipo = ? AND licitacion_codigo = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.folio')) = ?
      ORDER BY id DESC LIMIT 20`,
    [TIPO, codigo, folio],
  ) as any[];
  return (rows as any[]).map(r => {
    let m: any = {};
    try { m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {}); } catch { /* sin detalle */ }
    return { fecha: new Date(r.created_at).toISOString(), por: r.actor_nombre ?? null, para: m.para ?? [], cc: m.cc ?? [] };
  });
}

// Al 05-nov-2026 ningún proveedor tenía correo en compras_proveedor (0 de 139 con OC): el primer envío lo escribe a mano y queda
// guardado en la ficha (solo si estaba vacía), así la próxima vez se propone solo. Se busca por RUT sin puntos ni guion.
const RUT_SQL = `REPLACE(REPLACE(UPPER(rut), '.', ''), '-', '')`;
const rutLimpio = (rut: string | null) => (rut || '').replace(/[.\-\s]/g, '').toUpperCase();

async function correoDeFicha(proveedorRut: string | null): Promise<string | null> {
  if (!rutLimpio(proveedorRut)) return null;
  const [rows] = await pool.query(`SELECT correo FROM compras_proveedor WHERE ${RUT_SQL} = ? AND correo <> '' LIMIT 1`, [rutLimpio(proveedorRut)]) as any[];
  return (rows as any[])[0]?.correo ?? null;
}

async function guardarCorreoEnFicha(proveedorRut: string | null, para: string[]): Promise<void> {
  if (!rutLimpio(proveedorRut)) return;
  await pool.query(`UPDATE compras_proveedor SET correo = ? WHERE ${RUT_SQL} = ? AND (correo IS NULL OR correo = '')`,
    [para.join(', ').slice(0, 250), rutLimpio(proveedorRut)]).catch(e => console.error('[compras-oc-envio] no se guardó el correo en la ficha:', String(e)));
}

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

/** Lo que precarga la ventana: para, asunto y mensaje sugeridos + los envíos anteriores de esta OC. */
export async function borradorEnvioOc(negocioId: number, fuente: FuenteOc, remitente: { nombre: string | null; email: string | null }) {
  const { doc, codigo } = await cargar(negocioId, fuente);
  const emisor = doc.emisor?.razonSocial || 'nuestra empresa';
  const para = doc.proveedor.email || (await correoDeFicha(doc.proveedor.rut)) || '';
  const mensaje = [
    `Estimados ${doc.proveedor.nombre || ''}:`.replace(' :', ':'),
    '',
    `Adjuntamos la orden de compra N° ${doc.folio} por un total de ${pesos(doc.total)} (IVA incluido).`,
    '',
    `Les pedimos emitir la factura a nombre de ${emisor}${doc.emisor?.rut ? `, RUT ${doc.emisor.rut}` : ''}, indicando en la referencia la orden de compra N° ${doc.folio} (tipo 801), y enviarla respondiendo este correo.`,
    '',
    'Saludos,',
    remitente.nombre || '',
    emisor,
  ].join('\n').trim();
  return {
    folio: doc.folio, estado: doc.estado, proveedor: doc.proveedor.nombre, proveedorRut: doc.proveedor.rut,
    para, cc: remitente.email || '', asunto: `Orden de compra N° ${doc.folio} — ${emisor}`, mensaje,
    remitente, envios: await enviosAnteriores(codigo, doc.folio),
  };
}

export interface DatosEnvioOc { para: string; cc: string; asunto: string; mensaje: string }

/** Manda la OC en PDF al proveedor y anota el envío. Devuelve los envíos de esta OC (el nuevo primero). */
export async function enviarOc(negocioId: number, fuente: FuenteOc, d: DatosEnvioOc,
  actor: { id: number; nombre: string | null; email: string | null }): Promise<EnvioOc[]> {
  const para = separarCorreos(d.para, 'Para');
  if (!para.length) throw new Error('Falta el correo del proveedor.');
  const cc = separarCorreos(d.cc, 'Con copia').filter(c => !para.includes(c));
  const asunto = String(d.asunto || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const mensaje = String(d.mensaje || '').trim().slice(0, 5000);
  if (!asunto) throw new Error('Falta el asunto.');
  if (!mensaje) throw new Error('Falta el mensaje.');

  const { doc, pdf, codigo } = await cargar(negocioId, fuente);
  if (String(doc.estado || '').toUpperCase() === 'ANULADA') throw new Error(`La orden de compra ${doc.folio} está anulada: no se envía.`);
  const bytes = await pdf();
  try {
    await enviarOcAlProveedor({
      para, cc, asunto, mensaje, remitente: { nombre: actor.nombre, email: actor.email },
      pdf: { nombre: `orden-de-compra-${doc.folio.replace(/[^\w-]/g, '')}.pdf`, contenido: Buffer.from(bytes) },
    });
  } catch (e: any) {
    console.error('[compras-oc-envio] no salió el correo:', String(e));
    throw new Error(String(e?.message || '').includes('SMTP') ? e.message : 'El servidor de correo no aceptó el envío. Revisa los correos o inténtalo de nuevo.');
  }
  await guardarCorreoEnFicha(doc.proveedor.rut, para);
  await registrarEvento({
    tipo: TIPO, licitacionCodigo: codigo, actorId: actor.id, actorNombre: actor.nombre,
    mensaje: `${actor.nombre || 'Alguien'} envió la orden de compra ${doc.folio} a ${doc.proveedor.nombre} (${para.join(', ')}).`,
    metadata: { negocio_id: negocioId, folio: doc.folio, ...('ocPropiaId' in fuente ? { oc_propia_id: fuente.ocPropiaId } : {}), proveedor_rut: doc.proveedor.rut, para, cc },
  });
  return enviosAnteriores(codigo, doc.folio);
}

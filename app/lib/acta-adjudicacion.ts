// app/lib/acta-adjudicacion.ts
// Los ANEXOS DE LA ADJUDICACIÓN de una licitación ganada: acta de evaluación, resolución que
// adjudica, declaraciones juradas de los evaluadores.
//
// La sección "Resultado" solo tenía un link que sacaba al usuario a Mercado Público. Esto trae
// esos documentos adentro, con el mismo gesto que la Competencia y que los documentos propios:
// ver sin descargar, o bajar.
//
// ── CÓMO SE LLEGA (verificado en vivo, 1006-15-LE26) ─────────────────────────
// La URL del acta YA la entrega la API de MP y está cacheada en `adjudicacion_cache.url_acta`:
//     PreviewAwardAct.aspx?qs=…   <title>Resolución de Acta de Adjudicación</title>
// Es UNA sola página (sin frames, sin JS de por medio: mucho más simple que la apertura), con la
// tabla "Anexos a la Adjudicación":
//     Sel. | Anexo | Tipo | Descripción | Tamaño | Fecha de Adjunto | Acciones
// y el botón de cada archivo es el MISMO ImageButton `DWNL$grdId$ctlNN$search` de los anexos de
// oferta → se reusa descargarAnexoPorPostback() tal cual.
//
// Requiere IP CHILENA (WAF de MP), igual que todo lo que toca el portal.

import pool from '@/app/lib/db';
import { subirDocumentoR2, mimeDeNombre } from '@/app/lib/r2';
import { ahoraChileSQL } from '@/app/lib/tz';
import { MP_UA, fetchMPConReintentos, combinarCookies, extraerCookies, obtenerFichaHTML } from '@/app/lib/mp-adjuntos';
import { descargarAnexoPorPostback } from '@/app/lib/mp-ofertas';

const MAX_DOCS = 15;

// ── Tipos de MP → castellano ─────────────────────────────────────────────────
// MP mezcla rótulos legibles con códigos internos. Mostrar
// "DOCUMENT_TYPE_DJ_ABSENCE_CONFLICTS_OF_INTEREST" en pantalla no le sirve a nadie, pero el
// código CRUDO se guarda igual en la base: si mañana aparece uno nuevo, se ve tal cual en vez
// de desaparecer traducido a "Otro".
const TIPOS: { re: RegExp; label: string }[] = [
  { re: /ACTA_EVALUACION|ACTA\s*DE\s*EVALUACI/i, label: 'Acta de evaluación' },
  { re: /RESOLUCION|RESOLUCIÓN|DECRETO/i,        label: 'Resolución de adjudicación' },
  { re: /DJ_ABSENCE_CONFLICTS_OF_INTEREST/i,     label: 'Declaración jurada de conflictos de interés' },
  { re: /DJ_|DECLARACION_JURADA|DECLARACIÓN\s*JURADA/i, label: 'Declaración jurada' },
  { re: /INFORME/i,                              label: 'Informe' },
  { re: /ANEXO/i,                                label: 'Anexo' },
];

export function rotuloTipo(tipoMp: string | null): string {
  if (!tipoMp) return 'Documento';
  for (const t of TIPOS) if (t.re.test(tipoMp)) return t.label;
  // Rótulo humano de MP (no un código): se muestra como viene.
  return /^[A-Z_]+$/.test(tipoMp) ? 'Documento' : tipoMp;
}

/** El acta de evaluación es EL documento que explica por qué ganamos o perdimos. */
export function esActaEvaluacion(tipoMp: string | null, nombre: string): boolean {
  return /ACTA_EVALUACION/i.test(tipoMp || '') || /acta\s*de\s*evaluaci/i.test(nombre);
}

// ── Utilidades de parseo ─────────────────────────────────────────────────────

const limpiar = (h: string) => h
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function tamanoEnKb(texto: string): number | null {
  const m = texto.match(/([\d.,]+)\s*(KB|MB|GB)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const f = m[2].toUpperCase() === 'MB' ? 1024 : m[2].toUpperCase() === 'GB' ? 1024 * 1024 : 1;
  return Math.round(n * f);
}

export interface DocumentoActa {
  nombre: string;
  tipoMp: string | null;
  descripcion: string | null;
  tamanoKb: number | null;
  fechaAdjunto: string | null;
  controlPostback: string | null;
}

// ── Lectura del acta ─────────────────────────────────────────────────────────

/** URL del acta desde la cache de adjudicación (la entrega la API de MP, no se descubre). */
async function urlActaDe(codigo: string): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT url_acta FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo],
    ) as any;
    const u = (rows as any[])[0]?.url_acta;
    // MP publica el link en http; forzar https evita que el redirect pierda las cookies.
    return u ? String(u).replace(/^http:/i, 'https:') : null;
  } catch (e) {
    console.error(`[acta] no se pudo leer url_acta de ${codigo}:`, String(e).slice(0, 200));
    return null;
  }
}

export interface LecturaActa {
  documentos: DocumentoActa[];
  urlActa: string;
  cookies: string;
  referer: string;
  diagnostico: string;
}

/**
 * Lee la página del acta y devuelve sus anexos.
 * null = no se pudo entrar (sin acta cacheada, portal caído o sin IP chilena).
 */
export async function leerActa(codigo: string): Promise<LecturaActa | null> {
  const urlActa = await urlActaDe(codigo);
  if (!urlActa) return null;

  // La ficha primero: da las cookies de sesión que el portal exige para servir el acta.
  let cookies = '';
  let referer = urlActa;
  try {
    const ficha = await obtenerFichaHTML(codigo);
    cookies = ficha.cookies;
    referer = ficha.referer;
  } catch {
    // Sin ficha se puede intentar igual: el acta a veces se sirve sin sesión previa.
  }

  let html = '';
  try {
    const res = await fetchMPConReintentos(urlActa, {
      method: 'GET',
      headers: {
        'User-Agent': MP_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Referer': referer,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    cookies = combinarCookies(cookies, extraerCookies(res));
    if (!res.ok) return null;
    html = await res.text();
  } catch (e) {
    console.error(`[acta] ${codigo}: no se pudo abrir el acta:`, String(e).slice(0, 200));
    return null;
  }
  if (!html) return null;

  const documentos: DocumentoActa[] = [];
  let filasVistas = 0;

  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const bruto = tr[1];
    if (!/DWNL\$grdId/.test(bruto)) continue;   // solo las filas de la grilla de anexos
    filasVistas++;

    const celdas = [...bruto.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => limpiar(c[1]));
    // El nombre del archivo es la primera celda CON EXTENSIÓN: la primera columna es el checkbox
    // de selección y viene vacía.
    const nombre = celdas.find(c => /\.[a-z0-9]{2,5}$/i.test(c) && c.length > 4);
    if (!nombre) continue;
    const i = celdas.indexOf(nombre);

    // El control de descarga es el ImageButton `$search`, NO el checkbox `$chk` que aparece
    // primero en la fila. Tomar el primer name= de la fila bajaría siempre el control equivocado.
    const control = bruto.match(/name="(DWNL\$grdId\$ctl\d+\$search)"/i)?.[1]
      || bruto.match(/<input[^>]*type="image"[^>]*name="([^"]+)"/i)?.[1]
      || bruto.match(/name="([^"]+)"[^>]*type="image"/i)?.[1]
      || null;

    documentos.push({
      nombre: nombre.slice(0, 400),
      tipoMp: (celdas[i + 1] || '').slice(0, 160) || null,
      descripcion: (celdas[i + 2] || '').slice(0, 400) || null,
      tamanoKb: tamanoEnKb(celdas.join(' ')),
      fechaAdjunto: (celdas.find(c => /^\d{2}-\d{2}-\d{4}/.test(c)) || '').slice(0, 40) || null,
      controlPostback: control,
    });
  }

  const sinControl = documentos.filter(d => !d.controlPostback).length;
  return {
    documentos, urlActa, cookies, referer,
    diagnostico: [
      `${Math.round(html.length / 1024)} KB`,
      `${filasVistas} filas`,
      `${documentos.length} docs`,
      ...(sinControl ? [`${sinControl} sin botón de descarga`] : []),
    ].join(' · ').slice(0, 400),
  };
}

// ── Persistencia ─────────────────────────────────────────────────────────────

/**
 * Guarda SOLO el acta de evaluación.
 *
 * El acta publica además la resolución que adjudica y una declaración jurada por cada evaluador
 * (5 archivos de trámite en un caso real). Nada de eso se trae: lo que se lee para entender por
 * qué ganamos o perdimos es el acta de evaluación, y el resto solo llena R2 y la pantalla.
 *
 * Los demás SÍ se detectan y se devuelven en `otros` — así el usuario sabe qué más hay en el
 * acta sin que el sistema decida por él que no existe. Con `soloActa: false` se traen todos.
 */
export async function guardarActaDocumentos(
  codigo: string, lectura: LecturaActa, opts: { soloActa?: boolean } = {},
): Promise<{ guardados: number; otros: { nombre: string; tipo: string }[] }> {
  const soloActa = opts.soloActa !== false;
  const objetivo = soloActa
    ? lectura.documentos.filter(d => esActaEvaluacion(d.tipoMp, d.nombre))
    : lectura.documentos;
  const otros = lectura.documentos
    .filter(d => !objetivo.includes(d))
    .map(d => ({ nombre: d.nombre, tipo: rotuloTipo(d.tipoMp) }));

  let n = 0;
  for (const d of objetivo) {
    try {
      await pool.query(
        `INSERT INTO acta_documento
           (licitacion_codigo, nombre, tipo_mp, descripcion, tamano_kb, fecha_adjunto,
            control_postback, url_acta, detectado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           tipo_mp          = COALESCE(VALUES(tipo_mp), tipo_mp),
           descripcion      = COALESCE(VALUES(descripcion), descripcion),
           tamano_kb        = COALESCE(VALUES(tamano_kb), tamano_kb),
           fecha_adjunto    = COALESCE(VALUES(fecha_adjunto), fecha_adjunto),
           -- El ctlNN se mueve si el organismo agrega un anexo: siempre se refresca.
           control_postback = VALUES(control_postback),
           url_acta         = VALUES(url_acta)`,
        [codigo, d.nombre, d.tipoMp, d.descripcion, d.tamanoKb, d.fechaAdjunto,
         d.controlPostback, lectura.urlActa, ahoraChileSQL()],
      );
      n++;
    } catch (e) {
      console.error(`[acta] doc de ${codigo} no se registró:`, String(e).slice(0, 200));
    }
  }
  return { guardados: n, otros };
}

export async function leerYGuardarActa(codigo: string): Promise<{
  ok: boolean; documentos: number; diagnostico: string;
}> {
  const lectura = await leerActa(codigo);
  if (!lectura) return { ok: false, documentos: 0, diagnostico: 'no se pudo abrir el acta' };
  const { guardados, otros } = await guardarActaDocumentos(codigo, lectura);
  // El resto (resolución, declaraciones juradas) no se guarda, pero se dice que existe: el
  // usuario no debe creer que el acta solo tenía un documento si en verdad tenía seis.
  const diagnostico = otros.length
    ? `${lectura.diagnostico} · ${otros.length} más sin traer (${otros.map(o => o.tipo).join(', ')})`
    : lectura.diagnostico;
  return { ok: true, documentos: guardados, diagnostico };
}

// ── Descarga ─────────────────────────────────────────────────────────────────

export async function descargarActaDocumentos(codigo: string, max = MAX_DOCS): Promise<{
  descargados: number; fallidos: number;
}> {
  const stats = { descargados: 0, fallidos: 0 };

  let filas: any[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, control_postback, url_acta
         FROM acta_documento
        WHERE licitacion_codigo = ? AND descargado_at IS NULL
        ORDER BY detectado_at ASC
        LIMIT ${Math.max(1, Math.min(max, 50))}`,
      [codigo],
    ) as any;
    filas = rows as any[];
  } catch (e) {
    console.error(`[acta] pendientes de ${codigo}:`, String(e).slice(0, 200));
    return stats;
  }
  if (filas.length === 0) return stats;

  // Sesión fresca: el __VIEWSTATE se pide de nuevo dentro de descargarAnexoPorPostback, pero las
  // cookies del portal se consiguen abriendo la ficha una vez para todo el lote.
  let cookies = '';
  let referer = String(filas[0].url_acta || '');
  try {
    const ficha = await obtenerFichaHTML(codigo);
    cookies = ficha.cookies; referer = ficha.referer;
  } catch { /* se intenta igual */ }

  for (const d of filas) {
    const contenedor = String(d.url_acta || '');
    const control = String(d.control_postback || '');
    if (!contenedor || !control) {
      stats.fallidos++;
      await pool.query(`UPDATE acta_documento SET error = ? WHERE id = ?`,
        ['definitivo: MP no expone botón de descarga para este anexo', d.id]).catch(() => {});
      continue;
    }

    const bin = await descargarAnexoPorPostback(contenedor, control, cookies, referer);
    if (!bin) {
      stats.fallidos++;
      await pool.query(`UPDATE acta_documento SET error = ? WHERE id = ?`,
        ['Mercado Público no entregó el archivo (sesión vencida o portal caído)', d.id]).catch(() => {});
      continue;
    }

    try {
      const nombre = String(d.nombre).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'acta';
      const urlR2 = await subirDocumentoR2(
        `${codigo}/acta`, nombre, bin.buffer,
        bin.contentType === 'application/octet-stream' ? mimeDeNombre(nombre, bin.contentType) : bin.contentType,
      );
      await pool.query(
        `UPDATE acta_documento
            SET url_r2 = ?, bytes = ?, content_type = ?, descargado_at = ?, error = NULL
          WHERE id = ?`,
        [urlR2, bin.buffer.length, bin.contentType, ahoraChileSQL(), d.id],
      );
      stats.descargados++;
    } catch (e) {
      stats.fallidos++;
      console.error(`[acta] subida R2 de ${codigo}/${d.nombre}:`, String(e).slice(0, 200));
      await pool.query(`UPDATE acta_documento SET error = ? WHERE id = ?`,
        [String(e).slice(0, 300), d.id]).catch(() => {});
    }
  }
  return stats;
}

// ── Vista para la UI ─────────────────────────────────────────────────────────

export interface DocumentoActaVista {
  id: number;
  nombre: string;
  tipo: string;              // rótulo ya traducido
  esActaEvaluacion: boolean;
  descripcion: string | null;
  tamanoKb: number | null;
  fechaAdjunto: string | null;
  url: string | null;        // copia propia en R2
  error: string | null;
}

export interface ActaVista {
  codigo: string;
  tieneActa: boolean;
  urlActa: string | null;
  documentos: DocumentoActaVista[];
  descargados: number;
  leida: boolean;
}

export async function obtenerActaVista(codigo: string): Promise<ActaVista> {
  const base: ActaVista = { codigo, tieneActa: false, urlActa: null, documentos: [], descargados: 0, leida: false };
  base.urlActa = await urlActaDe(codigo);
  base.tieneActa = !!base.urlActa;

  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, tipo_mp, descripcion, tamano_kb, fecha_adjunto, url_r2, error
         FROM acta_documento WHERE licitacion_codigo = ? ORDER BY id`,
      [codigo],
    ) as any;
    base.documentos = (rows as any[]).map(r => ({
      id: Number(r.id),
      nombre: String(r.nombre),
      tipo: rotuloTipo(r.tipo_mp ? String(r.tipo_mp) : null),
      esActaEvaluacion: esActaEvaluacion(r.tipo_mp ? String(r.tipo_mp) : null, String(r.nombre)),
      descripcion: r.descripcion ? String(r.descripcion) : null,
      tamanoKb: r.tamano_kb == null ? null : Number(r.tamano_kb),
      fechaAdjunto: r.fecha_adjunto ? String(r.fecha_adjunto) : null,
      url: r.url_r2 ? String(r.url_r2) : null,
      error: r.error ? String(r.error) : null,
    }));
    // El acta de evaluación primero: es EL documento que explica por qué ganamos o perdimos.
    base.documentos.sort((a, b) => Number(b.esActaEvaluacion) - Number(a.esActaEvaluacion));
    base.descargados = base.documentos.filter(d => d.url).length;
    base.leida = base.documentos.length > 0;
  } catch (e) {
    // Migración 61 pendiente → lista vacía, pero DICHO en el log (no un silencio).
    console.error(`[acta] lectura de documentos de ${codigo}:`, String(e).slice(0, 200));
  }

  return base;
}

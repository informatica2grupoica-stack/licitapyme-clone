// app/lib/mp-descarga-orquestador.ts
// Orquestador reusable de descarga automática de adjuntos de Mercado Público.
//
// Flujo:
//   1. Lee la ficha pública y extrae los pop-ups de adjuntos (cheerio).
//   2. Por cada pop-up intenta el camino rápido (fetch + __VIEWSTATE).
//   3. Para los que no entreguen binario, cae al navegador headless (puppeteer).
//   4. Sube cada archivo a Cloudflare R2 y lo registra en MySQL (saltando los ya cacheados).
//
// Requiere ejecutarse desde una IP chilena (el WAF de MP bloquea datacenters
// extranjeros como los de Vercel). Por eso corre en local/Docker o un VPS chileno.
import { subirDocumentoR2 } from '@/app/lib/r2';
import {
  guardarDocumentoEnCache,
  obtenerDocumentosCache,
} from '@/app/services/documentosService.server';
import { listarAdjuntos, ArchivoDescargado } from '@/app/lib/mp-adjuntos';
import { descargarViaPopup } from '@/app/lib/mp-descarga-fetch';

export interface ResultadoDescarga {
  exito: boolean;
  nuevos: number;
  omitidos: number;
  totalEncontrados: number;
  error?: string;
  fichaUrl?: string;
  /** Errores por paso: ayuda a diagnosticar dónde falló exactamente */
  pasos?: {
    paso1_listar?: string;
    paso2_fetch?: string;
    paso3_browser?: string;
  };
  /** true si hay archivos de tipo poco común (ni PDF/Word/Excel) → revisar a mano */
  revisarManual?: boolean;
  /** Extensiones poco comunes encontradas (zip, rar, dwg, kmz, …) */
  tiposNoComunes?: string[];
  /** Mensaje listo para mostrar al usuario cuando revisarManual = true */
  mensajeRevision?: string;
}

/** Tipos que el sistema procesa con normalidad (descarga + análisis IA). */
const EXTENSIONES_COMUNES = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx']);

/**
 * Descarga todos los adjuntos disponibles de una licitación, los sube a R2 y
 * los registra en `documentos_cache`, saltando los que ya estaban guardados.
 */
export async function descargarDocumentosLicitacion(codigo: string): Promise<ResultadoDescarga> {
  const pasos: NonNullable<ResultadoDescarga['pasos']> = {};

  // 1) Leer la ficha pública y extraer los pop-ups de adjuntos.
  console.log(`[1] Listando adjuntos de la ficha: ${codigo}`);
  let cookies = '';
  let referer = '';
  let adjuntos: import('@/app/lib/mp-adjuntos').AdjuntoLink[] = [];

  try {
    const resultado = await listarAdjuntos(codigo);
    cookies = resultado.cookies;
    referer = resultado.referer;
    adjuntos = resultado.adjuntos;
    console.log(`[1] ${adjuntos.length} pop-up(s) de adjuntos detectados por fetch`);
    if (adjuntos.length === 0) {
      pasos.paso1_listar = 'Ficha accesible pero sin pop-ups de adjuntos detectados (el HTML puede haber cambiado)';
    }
  } catch (e: any) {
    console.error(`[1] listarAdjuntos falló: ${e.message}`);
    pasos.paso1_listar = e.message;
    // Sin ficha no podemos continuar con fetch; el navegador lo intenta directamente.
    referer = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  }

  const archivos: ArchivoDescargado[] = [];

  // 2) Camino rápido (fetch) por cada pop-up detectado en el HTML.
  //    `yaTenemos` se comparte entre pop-ups: las bases (grilla LC) y los anexos
  //    (VerAntecedentes) se solapan, así no bajamos el mismo archivo dos veces.
  const yaTenemos = new Set<string>();
  const erroresFetch: string[] = [];
  for (const adj of adjuntos) {
    try {
      const obtenidos = await descargarViaPopup(adj.url, cookies, referer, yaTenemos);
      if (obtenidos.length > 0) {
        console.log(`[2] fetch OK (${obtenidos.length}) en "${adj.nombre}"`);
        archivos.push(...obtenidos);
      }
    } catch (e: any) {
      console.log(`[2] fetch no logró "${adj.nombre}": ${e.message}`);
      erroresFetch.push(`${adj.nombre}: ${e.message}`);
    }
  }
  if (erroresFetch.length > 0) {
    pasos.paso2_fetch = erroresFetch.join(' | ');
  }

  // 3) Si fetch no consiguió nada, ir al navegador headless desde la ficha.
  //    (El token enc está atado a la sesión: hay que derivarlo dentro del navegador.)
  if (archivos.length === 0) {
    console.log(`[3] fetch no entregó binarios → navegador headless desde la ficha...`);
    try {
      const { descargarDesdeFicha } = await import('@/app/lib/mp-descarga-browser');
      const porNavegador = await descargarDesdeFicha(codigo);
      console.log(`[3] navegador entregó ${porNavegador.length} archivo(s)`);
      archivos.push(...porNavegador);
    } catch (e: any) {
      console.error(`[3] navegador headless falló: ${e.message}`);
      pasos.paso3_browser = e.message;
    }
  }

  if (archivos.length === 0) {
    const resumen = [
      pasos.paso1_listar && `Listar: ${pasos.paso1_listar}`,
      pasos.paso2_fetch  && `Fetch: ${pasos.paso2_fetch}`,
      pasos.paso3_browser && `Browser: ${pasos.paso3_browser}`,
    ].filter(Boolean).join(' → ');

    return {
      exito: false,
      nuevos: 0,
      omitidos: 0,
      totalEncontrados: 0,
      error: resumen || 'No se pudo extraer ningún binario (ni por fetch ni por navegador).',
      fichaUrl: referer,
      pasos,
    };
  }

  // 4) Subir a R2 + guardar en MySQL, saltando los que ya estaban cacheados.
  const cacheados = await obtenerDocumentosCache(codigo);
  const yaExisten = new Set(cacheados.map(d => d.documento_nombre));

  let nuevos = 0;
  let omitidos = 0;

  for (const archivo of archivos) {
    if (yaExisten.has(archivo.nombre)) {
      omitidos++;
      continue;
    }
    const url = await subirDocumentoR2(codigo, archivo.nombre, archivo.buffer, archivo.contentType);
    await guardarDocumentoEnCache(codigo, archivo.nombre, url, archivo.buffer.length);
    yaExisten.add(archivo.nombre);
    nuevos++;
  }

  console.log(`[4] Listo: ${nuevos} nuevo(s), ${omitidos} ya existían`);

  // 5) Detectar archivos de tipo poco común (ni PDF/Word/Excel): el sistema los
  //    descarga igual, pero conviene avisar al usuario para que revise las bases
  //    a mano (p.ej. .zip/.rar/.dwg/.kmz que el análisis IA no procesa).
  const tiposNoComunes = Array.from(
    new Set(
      archivos
        .map(a => a.nombre.split('.').pop()?.toLowerCase() || '')
        .filter(ext => ext && !EXTENSIONES_COMUNES.has(ext)),
    ),
  );
  const revisarManual = tiposNoComunes.length > 0;
  const mensajeRevision = revisarManual
    ? `Esta licitación incluye archivo(s) de tipo poco común (${tiposNoComunes.join(', ')}). ` +
      `Se descargaron, pero revisa las bases en Mercado Público por si requieren atención manual.`
    : undefined;

  return {
    exito: true,
    nuevos,
    omitidos,
    totalEncontrados: archivos.length,
    fichaUrl: referer,
    pasos,
    revisarManual,
    tiposNoComunes,
    mensajeRevision,
  };
}

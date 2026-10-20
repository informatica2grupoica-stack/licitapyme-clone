// app/lib/leer-documento-subido.ts
// Lectura en segundo plano de los documentos que sube una persona (Documentos Propios, cajas
// manuales, anexos rellenados, OC). Antes quedaban sin texto hasta que alguien corría la
// viabilidad o una auditoría de Compras, y el chat de la burbuja no los veía.
// Deja el texto en documentos_cache.texto_extraido; texto_extraido_at = NOW() invalida solo el
// contexto cacheado del chat (ver construirContextoChat).

import pool from './db';
import { descargarYExtraerTexto } from './document-extraction';
import { esFormatoLegible } from './lectura-documentos';

// Siempre RE-lee (no reusa caché): si la persona reemplaza un archivo con el mismo nombre, el
// texto viejo ya no vale. Nunca lanza: corre sin esperar y no debe tumbar la subida.
export async function leerDocumentoSubido(codigo: string, nombre: string, url: string): Promise<void> {
  try {
    if (!esFormatoLegible(nombre) || /^COSTEO_/i.test(nombre)) return; // el costeo ya entra por el editor
    // Sin IA: omitirOCR deja pasar solo lectura directa (PDF con texto, Word, Excel). Un PDF
    // escaneado vuelve como 'pdf-sin-ocr' y no se guarda como si estuviera leído.
    const r = await descargarYExtraerTexto(url, nombre, { omitirOCR: true }).catch(() => null);
    const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
    const legible = texto.replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, '').trim().length >= 50;
    if (legible && r?.metodo !== 'pdf-sin-ocr') {
      await pool.query(
        `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
          WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [texto, r?.metodo || 'subida', codigo, nombre],
      );
    } else {
      // Deja escrito que se intentó y falló (mismo criterio que viabilidad-ia): visible y contable.
      await pool.query(
        `UPDATE documentos_cache SET texto_extraido = NULL, metodo_extraccion = ?, texto_extraido_at = NOW()
          WHERE licitacion_codigo = ? AND documento_nombre = ?`,
        [r?.metodo || 'error', codigo, nombre],
      );
    }
  } catch (e) {
    console.error('[leer-documento-subido] falló (no crítico):', codigo, nombre, String(e).slice(0, 200));
  }
}
